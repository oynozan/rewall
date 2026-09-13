# The SDK

`@rewall/sdk` is the core. Every other part of Rewall is a call into it. It is not published to npm.
It lives in `sdk/` in the repository and is shared by relative link.

```bash
cd sdk && pnpm install && pnpm run build && pnpm test
```

A consumer lists it as `"@rewall/sdk": "link:../sdk"` and imports `dist`, so `sdk/` must be built
first. Use a forward slash in the link even on Windows, or a Linux deploy breaks.

## The key

The wallet signs one fixed EIP-712 message, `IDENTITY_TYPED_DATA` in `sdk/src/identity.ts`:

```
domain      { name: "Rewall", version: "1" }
primaryType Identity
types       Identity(string purpose,string warning)
message     purpose  "Derive the X25519 key that unseals secrets shared with this wallet"
            warning  "Sign this only in Rewall, whoever collects it reads every secret shared with you forever"
```

The 65 byte signature is reduced to 64 bytes of `r || s` with low `s`, hashed with SHA-256, and the
32 byte hash is the X25519 secret key. The public key is `crypto_scalarmult_base(seed)`. Never
`crypto_box_seed_keypair`, which hashes again and yields a different key.

The signature is the identity. Anyone who collects it reads every secret ever shared with that
wallet, forever. `identityFromSeed(seed)` builds an identity from a bare 32 byte scalar, which is
how a machine with no wallet holds one.

## Constructor

```ts
const rewall = new Rewall({
    publicClient, // viem, reads
    walletClient, // viem, optional, writes and signatures
    account, // the wallet, local or injected, optional with walletClient
    name: "alice.eth", // which of the caller's names it acts as
    universalResolver, // 0x4a1817d13e9cf196f471725176355c1234b63c70 on Sepolia
    identity, // optional, a key derived elsewhere, never wiped by the SDK
});
```

`name` is a namespace choice, not an identity. It says where `publishIdentity` writes, which
namespace `list` reads, and what goes into `rewall.owner`. With `identity` and no `walletClient` the
client is read only.

## Methods

```ts
await rewall.identity(); // derives the X25519 key, memory only
await rewall.publishIdentity(); // writes rewall.pubkey on rewall.name

await rewall.create("openai.rewall.alice.eth", plaintext, {
    type: "apikey", // generic | apikey | privkey | totp | receipt
    grantees: ["ci.alice.eth"],
    subtreeGrantees: ["team.eth"],
    recovery: ["vault.alice.eth"], // required, at least one
    allow: ["api.openai.com"], // hosts the MCP server may send it to
    site: "github.com", // totp only, one exact hostname
    overwrite: false, // default, refuses to replace a live secret
});

await rewall.setSite("github.rewall.alice.eth", "accounts.github.com"); // no rotation

const value = await rewall.get("openai.rewall.alice.eth"); // Uint8Array, memory only

await rewall.grant("openai.rewall.alice.eth", "bob.eth");
await rewall.grant("openai.rewall.alice.eth", "team.eth", { subtree: true });

await rewall.revoke("openai.rewall.alice.eth", "bob.eth"); // rotates
await rewall.revoke("openai.rewall.alice.eth", "team.eth", { subtree: true });
await rewall.revoke("openai.rewall.alice.eth", "old.eth", { recovery: true });

await rewall.rotate("openai.rewall.alice.eth", newPlaintext); // newPlaintext is optional
await rewall.reauthorize("openai.rewall.alice.eth", { recovery: [...] }); // re-signs the lists
await rewall.reauthorize("openai.rewall.alice.eth", undefined, {
    accept: [{ role: "grantee", name: "bob.eth", fingerprint }], // required when a key changed
});

await rewall.subtree.init(); // publishes the subtree pubkey on rewall.name
await rewall.subtree.distribute(["ci.alice.eth"]); // seals the subtree key to each member
await rewall.subtree.rotate(); // bumps the version, locking every member out
await rewall.subtree.version();

await rewall.guardians.init(["a.eth", "b.eth", "c.eth"], 2); // returns the recovery grantee
rewall.guardians.entry(); // "guardians:alice.eth"
await rewall.guardians.of("alice.eth");
await rewall.guardians.reshare("alice.eth", newOwnerPublicKey); // run by a guardian
await rewall.guardians.recover(resealedShares, "alice.eth"); // run by the new owner

await rewall.list(); // labels under rewall.<name>
await rewall.unindex("openai.rewall.alice.eth");
```

Things the SDK refuses, on purpose:

- Creating a secret with only the owner's sealed copy. At least one recovery entry is required.
- Revoking the last recovery entry.
- Rotating when the signed grantee lists do not verify, or when a name on them now resolves to a
  different key than the one approved. `reauthorize` with `accept` is the deliberate way through.
- Creating at a name that already holds a secret, unless `overwrite: true`.

## What it never does

It never writes a secret to disk. It never logs one. All cryptography is libsodium and WebCrypto.
It never reads anything from a Rewall server, because there is none. It never hardcodes a resolver
address. `list` reads one `rewall.index` record rather than enumerating the chain, because ENSv2
has no way to list a registry's children.

## The 2FA subpath

`@rewall/sdk/2fa` reads `otpauth://` setup keys and computes TOTP codes. It pulls in neither viem
nor libsodium, so a browser background script can import it on its own. A `totp` secret stores the
`otpauth://` URI as its value and one exact lowercase hostname in `rewall.site`.
