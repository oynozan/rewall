# 7. Share a treasury

Alice and Bob want a shared wallet. Neither of them wants to email a private
key.

```bash
pnpm run 07
```

This one needs a running transfer rail. See [rail/README.md](../../rail/README.md).

## What happens

There is a seventh wallet nobody uses directly. Alice funds it, then stores its
signing key as a Rewall secret and grants Bob.

Bob reads the secret, rebuilds the account in memory, and spends from it. He
never had the key before and it is never written to his disk.

## Why this is different from sending someone a key

A key you send is a key you cannot take back. It sits in a chat log or a
password manager forever, and you have no idea how many copies exist.

Here the key lives in one place, encrypted, wrapped for exactly the people who
should have it. Adding a signer is a grant. Removing one is a rotation: a fresh
key, a fresh secret, and the old wraps stop working.

That does not unlearn the key from anyone who already opened it, which is the
same caveat as example 3. What it gives you is a list you control and can
change, rather than a secret you have lost track of.

## Why the treasury never needs gas

It only ever signs, off chain, to authorise transfers on the rail. The one leg
that costs gas is redeeming a withdrawal ticket, and whoever redeems pays that
themselves.

So a shared wallet can hold a balance without anyone having to keep it topped
up with ether.

## Try it

Run example 6 first so Alice has something to fund it with. Then run this one
twice: the second run finds the secret already there and reuses it, because
rewriting it would hand every reader a new key for no reason.
