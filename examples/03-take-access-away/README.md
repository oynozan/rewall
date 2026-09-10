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

Read the last two lines of output.

Bob already read the token. He wrote it down. Revoking cannot reach into his
notes. All revoking does is stop him reading the _next_ value.

So when someone leaves, rotate the real credential as well. Change the deploy
token at GitHub. Rewall protects storage, not memory.

Every secret manager has this property. Most do not say it out loud.

## Why a rotation and not a delete

You could imagine just deleting Bob's record. That would be worse. Anyone
watching the chain already saw his wrap, and the blob it opens would still be
sitting there.

Changing the data key is the only thing that actually closes the door.

## One thing to know

If a name is both a grantee and a recovery holder, revoking the grant alone
leaves them reading, because both use the same key. The SDK refuses that instead
of quietly succeeding, and tells you which one to remove first.
