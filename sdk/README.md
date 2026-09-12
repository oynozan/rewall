# @rewall/sdk

The core library. Every other part of Rewall is built on it.

It does three things. It turns a wallet signature into an encryption key. It encrypts a secret and
seals the key to each reader's ENS name. It reads and writes the ENS records that hold all of that.

## The key

A name's private key is never stored. To get it, the wallet signs one fixed EIP-712 message. The
signature is reduced to 64 bytes, hashed with SHA-256, and the result is the X25519 secret key. The
same wallet always gives the same key, so nothing has to be saved.

The public half is published under the name as `rewall.pubkey`. Anyone can read it, and that is what
lets them share a secret with you.

Two things follow from this and both matter. The signature is the key, so anyone who gets that
signature can read every secret ever shared with you, forever. And a wallet that does not sign the
same way twice cannot be used. MetaMask is the supported wallet.

## A secret on chain

A secret is a set of ENS text records on `<secret>.rewall.<name>.eth`. The value is encrypted with
AES-256-GCM under a random key. That key is sealed once per reader with a libsodium sealed box, and
each sealed copy is its own record, `rewall.key.<fingerprint>`. The names of everyone with access are
written too, signed by the owner, because a rotation has to know who to re-seal for.

Sharing adds one sealed copy. Revoking encrypts again with a new key and re-seals for everyone who
stays. The old copies then open nothing.

## Using it

```ts
const rewall = new Rewall({ publicClient, walletClient, account, name: "alice.eth", universalResolver });

await rewall.publishIdentity();
await rewall.create("openai.rewall.alice.eth", plaintext, {
    type: "apikey",
    grantees: ["bob.eth"],
    recovery: ["vault.alice.eth"],
    allow: ["api.openai.com"],
});

const value = await rewall.get("openai.rewall.alice.eth");
await rewall.grant("openai.rewall.alice.eth", "carol.eth");
await rewall.revoke("openai.rewall.alice.eth", "bob.eth");
await rewall.list();
```

A client built with an `identity` and no `walletClient` can read but not write. That is how the MCP
server and the extension run, holding only the derived key.

`rewall.subtree` shares one key with every subname under a name. `rewall.guardians` splits a recovery
key across several names so a lost wallet can be recovered by a threshold of them.

`@rewall/sdk/2fa` is a separate import that reads TOTP setup keys and computes codes. It does not
pull in viem or libsodium, so a browser background script can use it on its own.

## Building and testing

```bash
pnpm install
pnpm run build     # writes dist/, which every other folder imports
pnpm test          # unit tests, no network
```

The tests prove things the docs cannot. They recover a signer from `N - s` to show the curve order is
right. They show that `crypto_box_seed_keypair` gives a different key from the same seed, which is
why the SDK never uses it. They show that moving a blob to another name makes it refuse to open.

## What it never does

It never writes a secret to disk. It never logs one. It never uses a crypto primitive that is not
libsodium or WebCrypto. And it never reads anything from a Rewall server, because there is none.
