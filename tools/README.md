# tools

Scripts that set up Rewall on Sepolia and prove each feature works against the real chain. Every
script runs a real transaction or a real read. None of them mock anything.

This folder also holds `.env`, the one file with the test wallet phrase. Copy `.env.example` to make
it. It is never committed.

## The test names

Four wallets come from one phrase, each at a fixed index. Three of them hold a name.

```
rewall-test-1.eth   index 0   the owner, sends most transactions
rewall-test-2.eth   index 1   someone the owner shares with
(no name)           index 2   a stranger, used to prove denial
rewall-test-3.eth   index 3   the recovery holder
(no name)           index 4   the sponsor, pays for new users on the web
```

`participants.ts` is the single source for these. Never invent a placeholder name.

## Setup, run once

```bash
pnpm run wallets     # makes the wallets and funds them from the funder key
pnpm run bootstrap   # registers the three names, one shared 60 second wait
pnpm run deploy      # deploys one resolver per name and the owner's registry tree
pnpm run verify      # writes one record and reads it back through the Universal Resolver
pnpm run status      # shows what is on chain for each name
```

`deploy` records addresses in `deployments.json`. The factory refuses a repeated salt, so running it
again without that file would fail instead of skipping.

## Proofs, run any time

Each one is a small program that checks one part of the SPEC against Sepolia and fails loudly if
the chain disagrees.

```bash
pnpm run e2e          # the whole surface: create, get, grant, revoke, rotate, list
pnpm run guardians    # a lost wallet recovered by a threshold of guardians
pnpm run escalation   # a write delegate tries to add itself as a reader and is refused
pnpm run subtree      # one key shared with every subname under a name
pnpm run rotate       # a revoked reader keeps its old copy and still cannot open the new value
pnpm run delegate     # per record write access on the resolver
pnpm run sponsor      # a new user gets a whole vault with zero transactions of their own
pnpm run totp         # stores a real 2FA account and checks the code it gives
pnpm run identity     # publishes each name's public key
pnpm run secret       # creates one secret and reads it back
```

They share wallets, so run them one at a time. Two at once collide on the nonce and waste gas.

## Other

```bash
pnpm run sponsor-key   # writes the sponsor key into web/.env.local without printing it
pnpm run format
pnpm run format:check
```

`chain.ts` builds clients for the test wallets. The scripts import it rather than each building
their own.
