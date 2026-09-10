# 3. Take access away

Bob leaves. Alice revokes him.

```bash
pnpm run 03
```

## What happens

Revoking is not a flag being flipped. It is a rotation.

Alice generates a brand new data key, re-encrypts the token under it, wraps the
new key for everyone who stays, and clears Bob's wrap. All in one transaction.

Bob's old wrapped key still exists on his laptop. It still opens the old data
key. The old data key still decrypts the old blob. But the old blob is gone,
replaced by one Bob cannot touch.

## The honest part

Read the last lines of output. This is the most important page in these examples.

Bob already read the token, so revoking cannot reach into his notes. That much is
true of every secret manager.

Rewall has a sharper version of it. Bob did not need to write anything down. The
transaction that granted him access is still in chain history, and it contains
his wrap. The block that held the old blob is still there too. His key opens
both. He can walk away, read nothing, come back in a year, and pull the value
out of an archive node.

**Once a name has been granted, it can read that version of the secret forever.**
Rotation replaces the current value. It cannot unpublish the old one.

So when someone leaves, rotate the real credential as well. Change the deploy
token at GitHub. Rewall protects the next value, not the last one.

Decide what goes into Rewall with this in mind. Granting access is closer to
handing someone a copy than to lending them a key.

## Why a rotation and not a delete

You could imagine just deleting Bob's record. That would be worse. It would look
like the door closed while the blob his key opens sat there untouched.

Changing the data key is the only thing that closes the door on future values.

## One thing to know

A name can hold three separate kinds of access to one secret. An individual
grant, a subtree grant through its parent, and a recovery entry. They use
different keys, so `revoke` needs to know which one you mean.

```ts
await alice.revoke(SECRET, BOB); // the individual grant
await alice.revoke(SECRET, TEAM, { subtree: true }); // the subtree grant
await alice.revoke(SECRET, VAULT, { recovery: true }); // the recovery entry
```

If a name is both a grantee and a recovery holder, revoking the grant alone
leaves them reading. The SDK refuses that instead of quietly succeeding, and
tells you to take the recovery entry first.

Revoking the last recovery entry is also refused. A secret only its owner can
open is one lost wallet away from gone.
