# 8. Grant a machine

Alice's CI runs at night with nobody watching. It needs a deploy token.

```bash
pnpm run 08
```

## What happens

Alice grants `ci.rewall-test-2.eth` with the same call she used for Bob in
example 2. Rewall has no idea one of them is a person and the other is a
build server. A participant is an ENS name with a published key, and that is
the whole definition.

The machine then reads the token without signing anything.

```ts
const ci = new Rewall({ publicClient, name: CI, universalResolver, identity });
```

No `walletClient`, no `account`. The identity was derived once by a human and
handed to the process, which is the only part that needed a wallet. From then
on the process reads and cannot do anything else. Watch it try to grant the
secret to a third name and get a `ReadOnlyError` instead.

That refusal matters more than it looks. A token on a build server usually
comes with whatever else that server can reach. Here the machine holds exactly
one capability, reading, and holds it for exactly the secrets it was granted.
It cannot widen its own access or anyone else's.

## The honest part

Read the last lines of output.

The machine's key had to come from somewhere. A human derived it and put it on
the runner, so it now lives in that process and in whatever backs it up. And
read access in Rewall is cryptographic, so it can never be taken back from
whoever holds that key. Revoking stops the next value, exactly as in example 3.

So this example improves the blast radius and nothing else. If the runner is
compromised, the attacker holds `ci.rewall-test-2.eth`'s key permanently, and
can pull every value it was ever granted out of an archive node. Scoping the
machine to its own name is worth doing. It is not a fix.

**The key on the machine is the problem, and no amount of scoping removes it.**

## Where that gets solved

The key has to live somewhere. The one place that is not a machine anybody logs
into is a hardware enclave.

[`cre/`](../../cre) is a Chainlink CRE Confidential Workflow that is granted a
secret exactly like the machine above, using the same `grant` call, and opens it
inside an AWS Nitro enclave. Its key is released by the Vault DON into the
enclave for the length of one handler and exists nowhere between runs. Revoking
it is the ordinary rotation you just watched.

That is the same story as this example with the last problem removed, which is
why it is worth reading the two together.

## One thing to know

`ci.rewall-test-2.eth` is a subname, so its parent writes its records and could
republish its `rewall.pubkey` at any time. Alice's next rotation would then seal
the fresh data key to whoever the parent chose.

That is why the signed list binds a fingerprint to every name and not just the
name. A rotation that resolves a different key than the one Alice approved stops
rather than sealing to it. SPEC section 2 covers the record it writes.
