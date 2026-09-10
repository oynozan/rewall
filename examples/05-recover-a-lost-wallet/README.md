# 5. Recover after losing your wallet

Alice loses her laptop. Her secrets are still readable, but only if enough
friends agree.

```bash
pnpm run 05
```

## The problem

Alice's key is derived from her wallet. No wallet, no key. The encrypted value
sits on chain forever and nobody can open it.

Example 1 solved this by naming a second wallet. That works, but now Alice has
two things to lose instead of one, and whoever holds the second wallet can read
everything on their own.

## What guardians do instead

Alice picks four people. She sets a threshold of three.

A recovery key is generated and split into four pieces. Each piece is sealed to
one guardian. Then the recovery key is destroyed.

That last part matters. Nobody holds the recovery key, not even Alice. It only
exists again when three guardians agree to bring it back.

Every secret Alice creates is wrapped for that recovery key.

## Getting back in

Alice sets up a new wallet. It reads nothing, because it is a different key.

She asks her guardians. Each one takes their sealed piece, opens it, and seals
it again to her new key. No piece is ever exposed.

Three pieces are enough. The recovery key comes back, and it opens everything.

## Two guardians is not enough

Try it. Change `THRESHOLD` to 4 and run again with only three pieces. The SDK
refuses and tells you how many are missing.

It does not hand back a key that quietly fails later. That distinction matters,
because with the wrong number of pieces the underlying maths returns a
plausible-looking key rather than an error, and you would not know why nothing
opened.

## Forged pieces

A guardian, or anyone who knows Alice's new public key, can send a piece that is
not a real share. Left unchecked, one such piece can override every honest one
and dictate the result.

The SDK checks the rebuilt key against the public half Alice published on chain
when she set the guardians up. A forged piece fails that check. If one honest
group of three exists among the pieces supplied, it is found and used.

## Choosing a threshold

Two is the minimum the SDK allows, because one would mean a single guardian
could act alone.

Higher is safer against a dishonest guardian and riskier against an unreachable
one. Three of five is a reasonable place to start.
