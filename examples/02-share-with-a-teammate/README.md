# 2. Share a secret with one person

Alice has a Stripe key. She wants Bob to have it too.

```bash
pnpm run 02
```

## What happens

Bob does nothing. He does not accept an invite. He does not send Alice a key.
He does not even need to be online.

Alice knows his ENS name, `rewall-test-2.eth`. That name has a public key
published on it. She looks it up, wraps the data key for him, and writes one
extra record.

That is the whole grant. One record.

## Why Bob is refused before the grant

Read access is not a permission that gets checked. There is no access list that
a server consults. Bob simply has no wrapped copy of the data key, so there is
nothing for him to decrypt.

The error says so directly. It is `NoWrapError`, not "denied". Nothing rejected
Bob. There was just nothing there for him.

## What granting does not do

Granting does not re-encrypt anything. The blob stays exactly as it was. Only a
new wrapped key is added.

That makes granting cheap, and it makes an important point: adding a reader
never touches the data other readers rely on.

## Try it

Run it twice. The second run creates the secret again with a fresh data key, so
Bob's old wrap stops working and Alice grants him again. That is normal. Every
`create` is a new secret in the same place.
