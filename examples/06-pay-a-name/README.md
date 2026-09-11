# 6. Pay a name

Alice owes Bob a payment. She knows his ENS name and nothing else. Afterwards
she decides who is allowed to know it happened.

```bash
pnpm run 06
```

This one needs a running transfer rail. See [rail/README.md](../../rail/README.md).

## What happens

Bob asks the rail for a shielded address and publishes it on his own name as
`rewall.shielded`. It looks like an ordinary Ethereum address. It has no code,
no balance, and has never sent a transaction. Nothing on chain connects it to
him.

Alice resolves his name, gets that address, and pays it. The payment settles off
chain, so no transaction is written and no event is emitted. Someone watching
the chain sees nothing at all.

Then Alice writes a receipt, and grants it to the people she wants to know.

## Being paid is not the same as knowing

Bob's balance moves, so he knows a payment arrived. That is all he knows. The
amount is in his balance, but who sent it, and against what, is not.

So when the example runs, Bob cannot read his own payment's receipt. Neither can
`ci.rewall-test-2.eth`, a machine on his team that had nothing to do with it.
Alice then grants both, and both can read every field.

That is the whole idea. The list is Alice's, chosen per payment. Bob is on it
because she put him there, not because he was the one paid. She could have told
his bookkeeping system and not him, or a third party and neither of them.

## Why this is semi confidential and not anonymous

Two things stay visible no matter who you grant.

The vault is not a mixer. Putting tokens in and taking them out are ordinary
transactions with visible amounts. What is hidden is everything between: who
paid whom, how often, and for how much. With few users the deposits and
withdrawals are easy to line up by timing and amount.

The reader list is also public. `rewall.type` says a receipt exists, and one
`rewall.key.<fingerprint>` record sits there per reader. Nobody can read the
receipt, but anyone can count how many people can, and fingerprints match the
public keys names publish. Hiding that needs fixed wrap slots with random
filler, which is not built yet.

## One name that can always read

`rewall-test-3.eth` is Alice's own backup wallet, and it is the recovery name on
every secret in these examples. Recovery is a wrap like any other, so it can read
everything she owns. That is the point of a backup, not a leak, but it is worth
knowing before you read the grant list as the complete audience.

## Try it

Run it twice. Bob publishes a different shielded address each time, so two
payments to him cannot be linked by the address alone. That is what a fresh
address per payment buys, and why `publishShielded` is meant to be called often
rather than once.
