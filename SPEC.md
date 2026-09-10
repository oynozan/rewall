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

The private key is never written to disk in plaintext. It is derived on demand:

1. The wallet signs the fixed message `Rewall identity v1` (EIP-191 personal_sign).
2. The 65-byte signature is reduced to canonical form. The recovery byte `v` is discarded and `s` is normalized to the low half of the curve order, leaving 64 bytes of `r || s`.
3. Those 64 bytes are hashed with SHA-256 to produce a 32-byte seed.
4. The seed is the X25519 secret scalar directly. The public key is `crypto_scalarmult_base(seed)`.

Step 4 is normative. `crypto_box_seed_keypair` hashes the seed before deriving and produces a different keypair from the same input, so a client using it cannot read secrets written by a client using scalarmult. Only `crypto_scalarmult_base` agrees with noble, stablelib and tweetnacl. Every Rewall client must derive the same way or the same wallet silently becomes two identities.

Step 2 exists so that clients disagreeing about the recovery byte, or wallets returning a high-s signature, still derive one identity.

MetaMask is the supported wallet. Its `personal_sign` is deterministic, so the same account always yields the same key. Other EOA wallets are expected to behave identically but are unverified. Smart-contract and MPC wallets are not deterministic and must use a generated key stored by the client instead, which forfeits the property that the key is never stored.

The SDK, CLI and MCP server hold the derived key in memory for the life of the process and re-derive it on the next run. The browser extension is the one exception and stores it, encrypted under a passphrase, because a page action cannot prompt for a wallet signature on every use. Section 8 covers that trade.

Key fingerprint: the first 8 bytes of `keccak256(pubkey)`, rendered as 16 lowercase hex characters. Used as the suffix in wrap record names. Case is significant, because ENS text record keys are compared as raw bytes and `rewall.key.DEADBEEF` is a different record from `rewall.key.deadbeef`.

---

## 2. Storage layout

One secret is one ENSv2 subname under the owner's namespace, for example `openai.rewall.alice.eth`, deployed on ENSv2 Sepolia to store an OpenAI API key.

Every account has exactly one `PermissionedResolver`, deployed once through the `VerifiableFactory` and reused for every name that account owns. A secret subname points at its owner's resolver. There is no resolver per secret. Records inside a resolver are keyed by the namehash of the full name, so one resolver holds every secret without them colliding.

Clients always look up a name's configured resolver at write time. Never hardcode a resolver address and never cache one, because an owner can repoint a name at a different resolver at any time.

Records on the secret subname:

```
rewall.v          schema version, "1"
rewall.type       "generic" | "apikey" | "privkey" | "totp" | "receipt"
rewall.enc        "aes-256-gcm"
rewall.blob       base64 ciphertext (nonce || ciphertext || tag)
rewall.cid        reserved for offchain ciphertext, unimplemented
rewall.key.<fp>   wrapped data key for grantee with fingerprint fp, base64
rewall.grantees   comma-separated ENS names granted directly
rewall.subtrees   comma-separated ENS names whose subtree was granted
rewall.recovery   comma-separated recovery entries, each a name or "guardians:<owner name>"
rewall.site       hostname pattern, totp type only
rewall.allow      comma-separated allowed hosts, enforced by the MCP tool process
rewall.created    unix timestamp
```

`rewall.grantees`, `rewall.subtrees` and `rewall.recovery` exist because a fingerprint is a hash. Nothing can turn `rewall.key.<fp>` back into a public key, and ENS text records cannot be enumerated, so without the names on chain a rotation has no way to re-wrap for the people who should keep access. They are written on every create and every rotation, including when empty, so dropping the last grantee clears the list.

Records on a participant name:

```
rewall.pubkey            X25519 public key, base64
rewall.index             comma-separated secret labels, read by list
rewall.subtree.pubkey    subtree public key (on parent names that enable subtree grants)
rewall.subtree.v         subtree key version, bumped to remove a member
rewall.subtree.key       subtree private key sealed to this subname's pubkey (on subnames)
rewall.guardians         comma-separated guardian names
rewall.guardian.<fp>     Shamir share of the recovery key sealed to guardian fp
rewall.recovery.pubkey   public half of the guardian backed recovery key
rewall.recovery.k        guardian threshold
rewall.shielded          shielded address for private transfers (optional)
```

### Permissions

- **Write permission** is ENSv2 Enhanced Access Control inside the owner's resolver, scoped to the secret's name rather than to the resolver as a whole. The owner holds the admin role on the root resource. Delegating write on one secret means granting a role on that secret's name, with `authorizeNameRoles(bytes toName, uint256 roleBitmap, address account, bool grant)` for the whole name, or `authorizeTextRoles(bytes toName, string key, address account, bool grant)` for a single key. Delegations are scoped to `rewall.*` keys. Both take a DNS-encoded name.
- **Read permission** is purely cryptographic. A name can read a secret if and only if a `rewall.key.<fp>` exists for its fingerprint, or for a subtree key it holds. No role grants read access, and no role can be revoked to remove it.

---

## 3. Encryption mechanism

### Create

1. Generate a random 32-byte data key `DEK`.
2. Encrypt plaintext with AES-256-GCM under `DEK` with a random 12-byte nonce. Store as `rewall.blob`. There is no size threshold and no offchain path. The only ceiling is roughly 22 KB of record value per transaction, set by the EIP-7825 gas clamp, which no credential approaches.
3. For each grantee (always including the owner and at least one recovery key), wrap `DEK` to the grantee's X25519 public key using libsodium `crypto_box_seal` (ephemeral X25519 + XSalsa20-Poly1305). Store as `rewall.key.<fp>`.
4. Write all records in one multicall.

### Read

1. Resolve the subname via the ENSv2 universal resolver and read all records in one call.
2. Find `rewall.key.<fp>` for the caller's fingerprint, or for any subtree key the caller holds.
3. Unseal to recover `DEK`. Decrypt `rewall.blob`. Plaintext stays in memory only.

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

1. The owner of `alice.eth` derives a subtree X25519 keypair and publishes the public half as `rewall.subtree.pubkey` on `alice.eth`, with the version in `rewall.subtree.v`.

The subtree key is derived, not generated and stored: `SHA-256("Rewall subtree v1:" || version || ":" || parentSecretKey)` used directly as the X25519 scalar. The parent can always re-derive it to seal for a new subname, so it keeps no secret state of its own, and the only thing that has to persist is a public counter.
2. When a subname is created under `alice.eth`, the parent seals the subtree private key to that subname's `rewall.pubkey` and writes it on the subname as `rewall.subtree.key`.
3. Granting a secret to "alice.eth and all subnames" means wrapping `DEK` to the subtree public key, stored as `rewall.key.<subtree-fp>`.
4. Every current subname unseals `rewall.subtree.key` to get the subtree private key, then unseals the secret's wrap.
5. Future subnames receive the subtree key when the parent creates them.
6. Removing one subname: bump `rewall.subtree.v`, which changes the derived key and invalidates every copy already distributed, then re-distribute to the remaining subnames and re-grant each affected secret to the new subtree key.

Step 6 has a cost worth stating. Bumping the version locks out every member at once, not just the one being removed, until the parent redistributes. That is the trade for keeping no state.

`rewall.subtree.init`, `rewall.subtree.distribute` and `rewall.subtree.rotate` in the SDK perform these steps.

---

## 5. Recovery

The SDK refuses to create a secret with only the owner's wrap. At least one recovery grantee is required.

Supported recovery grantees, in implementation priority:

1. **Recovery name.** A second ENS name backed by a cold wallet. Auto-wrapped on every create.
2. **Guardians.** A recovery keypair whose private key is split with Shamir (k of n). Each share is sealed to a guardian's ENS name and stored on the owner's name as `rewall.guardian.<fp>`, alongside `rewall.guardians`, `rewall.recovery.pubkey` and `rewall.recovery.k`. Every secret is wrapped to the recovery public key, referenced in `rewall.recovery` as `guardians:<owner name>`. Recovery: new wallet and key, k guardians re-seal their share to the new key, reconstruct, decrypt, re-wrap.

   The recovery private key is destroyed the moment the shares are made. Nobody holds it, and no fewer than k guardians can bring it back. Below k, Shamir reconstruction is unauthenticated and returns a key that is simply wrong rather than an error, so the failure shows up as a decryption that does not work. A threshold below 2 is refused, because it would let one guardian recover alone.
3. **Org recovery.** Anything created under a parent name is also wrapped to the parent's recovery key.

After any recovery: publish a new `rewall.pubkey`, then run rotate on every secret.

Because every stored blob is encrypted, key loss can never cause a leak. The only failure mode is loss of access, which the required recovery wrap prevents.

---

## 6. SDK surface

```ts
const rewall = await Rewall.fromSigner(signer, { chain: "sepolia" });

await rewall.publishIdentity();                       // writes rewall.pubkey on caller's name

await rewall.create("openai.rewall.alice.eth", plaintext, {
  type: "apikey",
  grantees: ["ci.alice.eth"],
  recovery: ["vault.alice.eth"],                       // required, at least one
  allow: ["api.openai.com"],
});

const value = await rewall.get("openai.rewall.alice.eth");   // Uint8Array, memory only

await rewall.grant("openai.rewall.alice.eth", "bob.eth");
await rewall.grant("openai.rewall.alice.eth", "alice.eth", { subtree: true });
await rewall.revoke("openai.rewall.alice.eth", "bob.eth");   // rotates
await rewall.rotate("openai.rewall.alice.eth", newPlaintext?);

await rewall.subtree.init("alice.eth");                 // parent publishes subtree pubkey
await rewall.subtree.distribute("alice.eth");           // seals subtree key to each subname
await rewall.subtree.rotate("alice.eth");

await rewall.list("alice.eth");                          // reads the rewall.index record
```

`list` does not enumerate the chain. ENSv2 exposes no way to list a registry's children, its tokens are not enumerable, and no subgraph exists for it. Instead every create and revoke rewrites a `rewall.index` text record on the namespace name, holding a comma-separated list of secret labels, in the same multicall the operation already sends. `list` reads that one record. The index is a convenience, not the source of truth, and a secret stays readable whether or not it is listed.

CLI mirrors the SDK. `rewall run -- <cmd>` passes secrets to a child process through its environment. That keeps them off disk, out of shell history, and gone when the child exits. It is not confidentiality against the local machine: on Linux any process with the same user id can read `/proc/<pid>/environ`, and on Windows the child inherits a descriptor derived from the creator's token. Anyone who can run code as this user can already read the secret.

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
- The extension holds the user's identity key after one wallet connection, encrypted under a passphrase in extension storage, unlocked per session. This is the documented exception to section 1. Filling a code is a page action that cannot prompt for a wallet signature every time, so the extension trades the never-stored property for usability. Anyone who reads extension storage and knows the passphrase gets the identity key and every secret it can unseal.
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
- Ciphertext lives inline in `rewall.blob`. There is no offchain storage and no content addressing. ENS record reads are cached with a short TTL, resolver addresses are never cached.
- Encryption uses platform WebCrypto for AES-256-GCM and libsodium for the sealed-box wraps and X25519. Guardian shares use an audited zero-dependency Shamir implementation. No hand-rolled primitives, and no algorithm not named in this document.