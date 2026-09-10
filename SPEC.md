# Rewall

Rewall is permissionless secret infrastructure. Secrets are encrypted on the user's device and stored under the owner's ENS name. Access is granted to other ENS names, or to every subname under a name, and revoked by rotation. There is no server, no account system, and no party that can read a secret except the names it was encrypted to.

Clients:

- TypeScript SDK (core; everything else is built on it)
- CLI
- MCP server for agents
- Browser extension for OTP codes

---

## 1. Identity keys

Every participant (human, agent, org) is an ENS name with an X25519 public key published in its records under `rewall.pubkey`.

The private key is not stored. It is derived on demand:

1. The wallet signs the fixed message `Rewall identity v1` (EIP-191 personal_sign).
2. The 65-byte signature is reduced to canonical form. The recovery byte `v` is discarded and `s` is normalized to the low half of the curve order, leaving 64 bytes of `r || s`.
3. Those 64 bytes are hashed with SHA-256 to produce a 32-byte seed.
4. The seed is the X25519 secret scalar directly. The public key is `crypto_scalarmult_base(seed)`.

Step 4 is normative. `crypto_box_seed_keypair` hashes the seed before deriving and produces a different keypair from the same input, so a client using it cannot read secrets written by a client using scalarmult. Only `crypto_scalarmult_base` agrees with noble, stablelib and tweetnacl. Every Rewall client must derive the same way or the same wallet silently becomes two identities.

Step 2 exists so that clients disagreeing about the recovery byte, or wallets returning a high-s signature, still derive one identity.

MetaMask is the supported wallet. Its `personal_sign` is deterministic, so the same account always yields the same key. Other EOA wallets are expected to behave identically but are unverified. Smart-contract and MPC wallets are not deterministic and must use a generated key stored by the client instead, which forfeits the property that the key is never stored.

Key fingerprint: the first 8 bytes of `keccak256(pubkey)`, rendered as 16 lowercase hex characters. Used as the suffix in wrap record names. Case is significant, because ENS text record keys are compared as raw bytes and `rewall.key.DEADBEEF` is a different record from `rewall.key.deadbeef`.

---

## 2. Storage layout

One secret is one ENSv2 subname under the owner's namespace, for example `openai.rewall.acme.eth`, deployed on ENSv2 Sepolia with its own permissioned resolver to store an OpenAI API key.

Records on the secret subname:

```
rewall.v          schema version, "1"
rewall.type       "generic" | "apikey" | "privkey" | "totp" | "receipt"
rewall.enc        "aes-256-gcm"
rewall.blob       base64 ciphertext (nonce || ciphertext || tag) if under 1 KB
rewall.cid        IPFS CID of the ciphertext if 1 KB or larger (blob is then empty)
rewall.key.<fp>   wrapped data key for grantee with fingerprint fp, base64
rewall.site       hostname pattern, totp type only
rewall.allow      comma-separated allowed hosts, enforced by the MCP tool process
rewall.created    unix timestamp
```

Records on a participant name:

```
rewall.pubkey            X25519 public key, base64
rewall.subtree.pubkey    subtree public key (on parent names that enable subtree grants)
rewall.subtree.key       subtree private key sealed to this subname's pubkey (on subnames)
rewall.guardian.<fp>     Shamir share of the recovery key sealed to guardian fp
rewall.shielded          shielded address for private transfers (optional)
```

### Permissions

- **Write permission** is ENSv2 Enhanced Access Control on the subname's resolver. The owner holds the admin role. Any name given the record-setter role can rotate the secret and edit grants.
- **Read permission** is purely cryptographic. A name can read a secret if and only if a `rewall.key.<fp>` exists for its fingerprint, or for a subtree key it holds.

---

## 3. Encryption mechanism

### Create

1. Generate a random 32-byte data key `DEK`.
2. Encrypt plaintext with AES-256-GCM under `DEK` with a random 12-byte nonce. Store as `rewall.blob` if under 1 KB, otherwise upload to IPFS and store `rewall.cid`.
3. For each grantee (always including the owner and at least one recovery key), wrap `DEK` to the grantee's X25519 public key using libsodium `crypto_box_seal` (ephemeral X25519 + XSalsa20-Poly1305). Store as `rewall.key.<fp>`.
4. Write all records in one multicall.

### Read

1. Resolve the subname via the ENSv2 universal resolver and read all records in one call.
2. Find `rewall.key.<fp>` for the caller's fingerprint, or for any subtree key the caller holds.
3. Unseal to recover `DEK`. Fetch ciphertext (inline, or from IPFS cached by CID forever). Decrypt. Plaintext stays in memory only.

### Grant

Wrap `DEK` to the new name's public key and write one record.

### Revoke / Rotate

Same operation:

1. Generate a new `DEK`.
2. Re-encrypt the plaintext.
3. Re-wrap for every remaining grantee.
4. Overwrite records; delete the revoked wrap.

Document clearly: a revoked party may already have read the old value. Rotate the underlying credential (the real API key, etc.) as well.

---

## 4. Subtree grants

1. The owner of `acme.eth` generates a subtree X25519 keypair and publishes the public half as `rewall.subtree.pubkey` on `acme.eth`.
2. When a subname is created under `acme.eth`, the parent seals the subtree private key to that subname's `rewall.pubkey` and writes it on the subname as `rewall.subtree.key`.
3. Granting a secret to "acme.eth and all subnames" means wrapping `DEK` to the subtree public key, stored as `rewall.key.<subtree-fp>`.
4. Every current subname unseals `rewall.subtree.key` to get the subtree private key, then unseals the secret's wrap.
5. Future subnames receive the subtree key when the parent creates them.
6. Removing one subname: rotate the subtree key and re-distribute to the remaining subnames.

For the hackathon, a CLI command run by the parent performs distribution and rotation.

---

## 5. Recovery

The SDK refuses to create a secret with only the owner's wrap. At least one recovery grantee is required.

Supported recovery grantees, in implementation priority:

1. **Recovery name.** A second ENS name backed by a cold wallet. Auto-wrapped on every create.
2. **Guardians.** A recovery keypair whose private key is split with Shamir (k of n). Each share is sealed to a guardian's ENS name and stored on the owner's name as `rewall.guardian.<fp>`. Every secret is wrapped to the recovery public key. Recovery: new wallet and key, k guardians re-seal their share to the new key, reconstruct, decrypt, re-wrap.
3. **Org recovery.** Anything created under a parent name is also wrapped to the parent's recovery key.

After any recovery: publish a new `rewall.pubkey`, then run rotate on every secret.

Because every stored blob is encrypted, key loss can never cause a leak. The only failure mode is loss of access, which the required recovery wrap prevents.

---

## 6. SDK surface

```ts
const rewall = await Rewall.fromSigner(signer, { chain: "sepolia" });

await rewall.publishIdentity();                       // writes rewall.pubkey on caller's name

await rewall.create("openai.rewall.acme.eth", plaintext, {
  type: "apikey",
  grantees: ["ci.acme.eth"],
  recovery: ["vault.acme.eth"],                       // required, at least one
  allow: ["api.openai.com"],
});

const value = await rewall.get("openai.rewall.acme.eth");   // Uint8Array, memory only

await rewall.grant("openai.rewall.acme.eth", "bob.eth");
await rewall.grant("openai.rewall.acme.eth", "acme.eth", { subtree: true });
await rewall.revoke("openai.rewall.acme.eth", "bob.eth");   // rotates
await rewall.rotate("openai.rewall.acme.eth", newPlaintext?);

await rewall.subtree.init("acme.eth");                 // parent publishes subtree pubkey
await rewall.subtree.distribute("acme.eth");           // seals subtree key to each subname
await rewall.subtree.rotate("acme.eth");

await rewall.list("acme.eth");                          // secrets under a namespace
```

CLI mirrors the SDK. `rewall run -- <cmd>` injects secrets into a child process environment only.

---

## 7. MCP server (agents)

Runs on the agent owner's machine or server. Holds the agent's identity key in its own process. Exposes tools:

- `http_with_secret(secretName, request)`: decrypts, attaches the secret to the request, sends it, returns the response with the secret value scrubbed.
- `sign_with_secret(secretName, payload)`: signs with a stored private key, returns the signature.
- `otp_code(secretName)`: returns the current TOTP code.

The model never receives plaintext. The tool process enforces `rewall.allow` (host allowlist), scrubs the secret value and common encodings from responses, and rate-limits.

---

## 8. OTP extension

- TOTP seeds are secrets of type `totp`, stored as the standard `otpauth://` URI, with `rewall.site` set to the hostname.
- The extension holds the user's identity key after one wallet connection, encrypted under a passphrase in extension storage, unlocked per session.
- Plan A: on click, read the active tab hostname, find the matching secret, compute the code, fill the field with `autocomplete="one-time-code"` or a six-digit input.
- Plan B (build first): popup listing every decryptable TOTP secret with live codes and countdowns, one click to fill or copy.

---

## 9. Semi-confidential transfers

Rail: Chainlink's private transfer service on Sepolia (deposit to vault, signed off-chain transfers, shielded addresses, withdrawal tickets). ERC-20 only. Demo service, labeled as-is.

- **Pay a name:** recipient publishes a shielded address as `rewall.shielded`. Senders resolve the name and pay it privately.
- **Visibility by name:** after each transfer, the sender writes an encrypted receipt secret (`type: "receipt"`, containing amount, counterparty name, transaction id) and grants it to the names that should see it, subtree included.
- **Shared treasury:** the account's signing key is itself a Rewall secret granted to specific names.

---

## 10. Non-goals and constraints

- No Rewall-operated server or gateway. Anything that decrypts runs on the participant's own machine.
- Target ENSv2 on Sepolia. Read via the universal resolver. Use ENSv2 registry and permissioned resolver contracts, not ENSv1.
- Secrets are never written to disk in plaintext by any client.
- Ciphertext is content-addressed and immutable; cache by CID forever. ENS record reads are cached with a short TTL.
- All wrap and encryption primitives come from libsodium (or a well-known port); no custom crypto.