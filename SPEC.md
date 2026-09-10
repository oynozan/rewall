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

1. The wallet signs a fixed EIP-712 typed data payload, `IDENTITY_TYPED_DATA` in the SDK.
2. The 65-byte signature is reduced to canonical form. The recovery byte `v` is discarded and `s` is normalized to the low half of the curve order, leaving 64 bytes of `r || s`.
3. Those 64 bytes are hashed with SHA-256 to produce a 32-byte seed.
4. The seed is the X25519 secret scalar directly. The public key is `crypto_scalarmult_base(seed)`.

The payload is normative in full, because changing any byte changes every identity:

```
domain      { name: "Rewall", version: "1" }
primaryType Identity
types       Identity(string purpose,string warning)
message     purpose  "Derive the X25519 key that unseals secrets shared with this wallet"
            warning  "Sign this only in Rewall, whoever collects it reads every secret shared with you forever"
```

Typed data rather than a bare string for two reasons. The wallet renders the fields, so the user sees what the signature is for instead of an opaque line, and the EIP-712 domain separates Rewall from any other application asking for a signature. Neither prevents a targeted phishing site from requesting this exact payload. A signature over it **is** the identity key, and read access can never be revoked, so anyone who obtains it reads every secret ever shared with that wallet, permanently. `domain` deliberately carries no `chainId` or `verifyingContract`, so one wallet has one identity on every network.

Step 4 is normative. `crypto_box_seed_keypair` hashes the seed before deriving and produces a different keypair from the same input, so a client using it cannot read secrets written by a client using scalarmult. Only `crypto_scalarmult_base` agrees with noble, stablelib and tweetnacl. Every Rewall client must derive the same way or the same wallet silently becomes two identities.

Step 2 exists so that clients disagreeing about the recovery byte, or wallets returning a high-s signature, still derive one identity.

MetaMask is the supported wallet. Its `eth_signTypedData_v4` is deterministic, so the same account always yields the same key. Other EOA wallets are expected to behave identically but are unverified. Smart-contract and MPC wallets are not deterministic and must use a generated key stored by the client instead, which forfeits the property that the key is never stored.

The SDK, CLI and MCP server hold the derived key in memory for the life of the process and re-derive it on the next run. The browser extension is the one exception and stores it, encrypted under a passphrase, because a page action cannot prompt for a wallet signature on every use. Section 8 covers that trade.

Key fingerprint: the first 8 bytes of `keccak256(pubkey)`, rendered as 16 lowercase hex characters. Used as the suffix in wrap record names. Case is significant, because ENS text record keys are compared as raw bytes and `rewall.key.DEADBEEF` is a different record from `rewall.key.deadbeef`.

---

## 2. Storage layout

One secret is one ENSv2 subname under the owner's namespace, for example `openai.rewall.alice.eth`, deployed on ENSv2 Sepolia to store an OpenAI API key.

Every account has exactly one `PermissionedResolver`, deployed once through the `VerifiableFactory` and reused for every name that account owns. A secret subname points at its owner's resolver. There is no resolver per secret. Records inside a resolver are keyed by the namehash of the full name, so one resolver holds every secret without them colliding.

Clients always look up a name's configured resolver at write time. Never hardcode a resolver address and never cache one, because an owner can repoint a name at a different resolver at any time.

Records on the secret subname:

```
rewall.v          schema version, "3"
rewall.type       "generic" | "apikey" | "privkey" | "totp" | "receipt"
rewall.enc        "aes-256-gcm", checked on read
rewall.blob       base64 ciphertext (nonce || key commitment || padded ciphertext || tag)
rewall.cid        reserved for offchain ciphertext, unimplemented
rewall.key.<fp>   wrapped data key for grantee with fingerprint fp, base64
rewall.owner      the ENS name that owns this secret
rewall.grantees   comma-separated ENS names granted directly
rewall.subtrees   comma-separated ENS names whose subtree was granted
rewall.recovery   comma-separated recovery entries, each a name or "guardians:<owner name>"
rewall.holders    comma-separated fingerprints that currently have a wrap
rewall.auth.n     authorization counter, incremented on every list change
rewall.auth.sig   owner's signature over the lists, checked before any rotation
rewall.site       hostname pattern, totp type only
rewall.allow      comma-separated allowed hosts, enforced by the MCP tool process
rewall.created    unix timestamp
```

`rewall.grantees`, `rewall.subtrees` and `rewall.recovery` exist because a fingerprint is a hash. Nothing can turn `rewall.key.<fp>` back into a public key, and ENS text records cannot be enumerated, so without the names on chain a rotation has no way to re-wrap for the people who should keep access.

`rewall.holders` exists for the opposite direction. A rotation must clear the wraps of everyone dropped, and it cannot enumerate them either. Re-deriving fingerprints from the names does not work, because a name whose key changed since the last write now resolves to a different fingerprint and the old wrap would be left behind, alive, on an unchanged data key.

`rewall.owner` exists so a rotation performed by anyone other than the owner still keeps the owner as a holder. All of these are written on every create and every rotation, including when empty, so dropping the last grantee clears the list.

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

### Why the grantee list is signed

Read access cannot be taken directly, but without a signature it could be obtained by waiting. `rewall.grantees`, `rewall.subtrees` and `rewall.recovery` are ordinary text records, and a rotation rebuilds the wrap set from them. A write delegate could add a name they control and let the owner's next rotation seal the data key to it.

So the lists are signed. The owner signs a canonical payload over the secret name, a counter, the owner name and all three lists, and stores it as `rewall.auth.sig` with the counter in `rewall.auth.n`. Before any rotation a client recovers the signer and compares it to the address that holds the name in its registry, found with `UniversalResolverV2.findParentRegistry`. That address is the one thing about a secret a write delegate cannot rewrite. A tampered list fails to verify and the rotation refuses.

One limit remains, worth stating plainly. A delegate can still roll the records back to an **older list the owner did sign**, because nothing on chain orders the counters. That can reinstate a grantee who was revoked. It cannot introduce a party the owner never authorized.

A second limit used to sit here and is now closed. A ciphertext is bound to the name it sits on, so copying a blob and its wraps onto another name produces something that refuses to open. Section 3 covers how. A delegate with write on `rewall.blob` can still overwrite the value in place with a fresh secret of their own, which no cryptography can prevent, so delegate write only to a party you would trust with the secret's contents.

### What is public

Everything in this section except the plaintext. A public chain has no private records, so the layout above is also a disclosure list, and it needs reading as one.

Public and unavoidable:

- **That the secret exists**, and its label. `stripe-key.rewall.alice.eth` announces that alice uses Stripe before anyone decrypts anything. Owners who care should register an opaque label.
- **The owner's address**, and the timing of every change. Each grant, revoke and rotation is a timestamped transaction. "alice.eth revoked bob.eth at 14:05" is public and permanent.
- **Creation time**, which the block timestamp gives regardless of `rewall.created`.

Public today, closable later:

- **The access graph.** `rewall.grantees`, `rewall.subtrees`, `rewall.recovery`, `rewall.guardians` and `rewall.owner` are plaintext ENS names. Who can read what, and who is trusted to recover it, is fully legible. These records exist only so a rotation can re-wrap, and only a party who can already read needs them, so they could be encrypted under the `DEK` with `rewall.auth.sig` signing their hash instead of their contents.
- **The reader set.** A fingerprint is `keccak256(pubkey)`, so anyone can take a list of candidate names, read each `rewall.pubkey`, hash it, and test whether that `rewall.key.<fp>` record exists. `rewall.holders` states the same thing outright. Hiding this needs fixed wrap slots (`rewall.key.0` through `rewall.key.N`) that readers trial-decrypt, with unused slots filled by random bytes indistinguishable from a real 80-byte seal. That hides both who and how many, at the cost of a fixed maximum reader count.
- **The type and policy.** `rewall.type`, `rewall.allow` and `rewall.site` are only ever used after decryption, so they belong inside the encrypted payload.

Already closed:

- **Plaintext length**, hidden by the padding in section 3. Everything under 252 bytes looks identical.
- **Which plaintext a blob holds**, and **which name it belongs to**, both bound by the commitment and the AEAD context.

---

## 3. Encryption mechanism

### Create

Two values feed every blob. `DEK` is a fresh random 32-byte data key. `context` is `namehash(secretName)`, 32 bytes, which binds the blob to the name it sits on.

1. Generate `DEK`.
2. Pad the plaintext. Four bytes of big-endian length, then the plaintext, then zeros, out to a multiple of 256 bytes. Every credential under 252 bytes therefore produces an identical blob length. Unpadding is strict and rejects a non-canonical block count, a length longer than the buffer, or padding that is not zero filled.
3. Encrypt the padded plaintext with AES-256-GCM under `DEK`, with a random 12-byte nonce and `context` as additional authenticated data. Store as `rewall.blob`. There is no size threshold and no offchain path. The only ceiling is roughly 22 KB of record value per transaction, set by the EIP-7825 gas clamp, which no credential approaches.

   The blob carries a key commitment, `SHA-256("Rewall dek v1" || context || DEK || nonce)`, between the nonce and the ciphertext, and readers check it before decrypting. It does two jobs. AES-GCM is not a committing AEAD, and given two chosen keys it is solvable to produce a single ciphertext that authenticates under both, which would let whoever wrote the blob hand two grantees different plaintexts from one record with neither seeing an error. The commitment fixes exactly one key per blob. Including `context` also fixes exactly one name, so a blob copied to a different name fails the commitment check and reports which problem it hit rather than failing opaquely inside GCM.
4. For each grantee (always including the owner and at least one recovery key), wrap `DEK` to the grantee's X25519 public key using libsodium `crypto_box_seal` (ephemeral X25519 + XSalsa20-Poly1305). Store as `rewall.key.<fp>`.
5. Write all records in one multicall.

Creating a secret at a name that already holds one is refused unless the caller passes `overwrite: true`. When it does overwrite, wraps listed in the previous `rewall.holders` that the new secret does not keep are cleared in the same multicall, so a stale wrap cannot turn a clean denial into a decryption failure.

### Read

1. Resolve the subname via the ENSv2 universal resolver and read the records the caller needs.
2. Refuse the secret if `rewall.v` is not the current schema version or `rewall.enc` is not `aes-256-gcm`.
3. Find `rewall.key.<fp>` for the caller's fingerprint, or for any subtree key the caller holds.
4. Unseal to recover `DEK`. Check the commitment, decrypt `rewall.blob`, unpad. Plaintext stays in memory only.

### Grant

Wrap `DEK` to the new name's public key and write one record. Granting a name that is already on the list routes through a rotation instead, because a bare re-grant would leave the old key's wrap live on an unchanged data key.

### Revoke / Rotate

Same operation:

1. Generate a new `DEK`.
2. Re-encrypt the plaintext.
3. Re-wrap for every remaining grantee.
4. Overwrite records; clear the revoked wrap.

`revoke` takes which kind of access to remove, because one name can hold three at once on different keys. No flag removes an individual grant, `{ subtree: true }` removes a subtree grant, `{ recovery: true }` removes a recovery entry. Revoking an individual grant from a name that is also a recovery entry is refused, since the recovery entry uses the same key and would keep reading. Revoking the last recovery entry is refused, since section 5 requires one.

**Revocation is forward only, and on a public chain that is stronger than it sounds.** The transaction that granted a name is permanently in chain history and contains its wrap. The block that carried the old blob is permanently there too. Anyone holding that key can decrypt the old value from an archive node at any point in the future, whether or not they ever read it while granted. Rotation replaces the current value and cannot unpublish the previous one. Treat granting access as handing over a copy of the value as it stands, not as lending a revocable key, and rotate the underlying credential when someone leaves.

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

   The recovery private key is destroyed the moment the shares are made. Nobody holds it, and no fewer than k guardians can bring it back. Below k, Shamir reconstruction is unauthenticated and returns a key that is simply wrong rather than an error, so recovery never trusts a reconstruction. It rejects a share whose x coordinate is zero or that duplicates another's, tries each exact-threshold subset in turn, and accepts only a candidate whose public half matches the published `rewall.recovery.pubkey`. A threshold below 2 is refused, because it would let one guardian recover alone, and a set below 2 guardians for the same reason.

Not implemented: automatically wrapping anything created under a parent name to that parent's recovery key. A parent that wants recovery on a child's secrets is named explicitly in `recovery` like any other entry.

After any recovery: publish a new `rewall.pubkey`, then run rotate on every secret.

Because every stored blob is encrypted, key loss can never cause a leak. The only failure mode is loss of access, which the required recovery wrap prevents.

---

## 6. SDK surface

```ts
const rewall = new Rewall({
  publicClient,        // viem, reads
  walletClient,        // viem, writes and signatures
  account,             // the wallet, local or injected
  name: "alice.eth",   // which of the caller's names it acts as
  universalResolver,
});

await rewall.identity();                              // derives the X25519 key, memory only
await rewall.publishIdentity();                       // writes rewall.pubkey on rewall.name

await rewall.create("openai.rewall.alice.eth", plaintext, {
  type: "apikey",
  grantees: ["ci.alice.eth"],
  subtreeGrantees: ["team.eth"],
  recovery: ["vault.alice.eth"],                      // required, at least one
  allow: ["api.openai.com"],
  overwrite: false,                                   // default, refuses to replace a live secret
});

const value = await rewall.get("openai.rewall.alice.eth");   // Uint8Array, memory only

await rewall.grant("openai.rewall.alice.eth", "bob.eth");
await rewall.grant("openai.rewall.alice.eth", "team.eth", { subtree: true });

await rewall.revoke("openai.rewall.alice.eth", "bob.eth");                      // rotates
await rewall.revoke("openai.rewall.alice.eth", "team.eth", { subtree: true });
await rewall.revoke("openai.rewall.alice.eth", "old.eth", { recovery: true });

await rewall.rotate("openai.rewall.alice.eth", newPlaintext?);
await rewall.reauthorize("openai.rewall.alice.eth", { recovery: [...] });       // re-signs the lists

await rewall.subtree.init();                          // publishes subtree pubkey on rewall.name
await rewall.subtree.distribute(["ci.alice.eth"]);    // seals the subtree key to each member
await rewall.subtree.rotate();                        // bumps the version, locking every member out
await rewall.subtree.version();

await rewall.guardians.init(["a.eth", "b.eth", "c.eth"], 2);   // returns the recovery grantee
rewall.guardians.entry();                                       // "guardians:alice.eth"
await rewall.guardians.of("alice.eth");
await rewall.guardians.reshare("alice.eth", newOwnerPublicKey); // run by a guardian
await rewall.guardians.recover(resealedShares, "alice.eth");    // run by the new owner

await rewall.list();                                  // labels under rewall.<name>
await rewall.unindex("openai.rewall.alice.eth");
```

`name` is a constructor argument rather than something looked up, because it is a namespace choice and not an identity. The identity is the key derived in section 1, which is the same for every name a wallet holds. `name` says where `publishIdentity` writes, where a subtree key sealed to the caller is looked for, which namespace `list` reads, and what goes into `rewall.owner`. One address can hold several names, and nothing in the protocol picks between them.

Reads go through `UniversalResolverV2.resolve` once per record key. ENSv2 also supports batching them as `resolve(dnsEncodedName, multicall(bytes[]))`, which the SDK does not yet use.

`list` does not enumerate the chain. ENSv2 exposes no way to list a registry's children, its tokens are not enumerable, and no subgraph exists for it. Instead every create rewrites a `rewall.index` text record on the namespace name, holding a comma-separated list of secret labels. `list` reads that one record and `unindex` removes an entry. The index is a convenience, not the source of truth, and a secret stays readable whether or not it is listed.

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