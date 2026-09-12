# Rewall

Secret storage with no server. A secret is encrypted on your machine and stored under your ENS name.
You share it by naming who may read it. You take it back by rotating. Nobody but the names you chose
can read it, and there is no account, no login and no company in the middle.

Everything runs on ENSv2 Sepolia. `SPEC.md` is the source of truth for how the protocol works.

## How it fits together

Every person, agent or team is an ENS name. Each name publishes one public key. A secret lives at
`<secret>.rewall.<name>.eth`, for example `openai.rewall.alice.eth`. The value is encrypted once, and
the key that opens it is sealed to each reader's public key. Giving someone access means sealing one
more copy. Taking it away means encrypting again with a new key, so old copies open nothing.

The private half of a name's key is never stored. It is derived from one wallet signature each time
it is needed.

## What is in this repo

| Folder       | What it does                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `sdk/`       | The core library. Everything else is built on it. Encrypts, seals to names, reads and writes ENS. |
| `tools/`     | Scripts that set up the test names on Sepolia and prove each feature against the real chain.      |
| `examples/`  | Short runnable programs, one per feature, each with its own README.                               |
| `web/`       | The dashboard. Store, share, revoke, recover, hold 2FA accounts, and send private payments.       |
| `mcp/`       | An MCP server. Lets an AI agent use a secret without ever seeing it.                              |
| `extension/` | A browser extension that fills sign-in codes from 2FA secrets stored under your name.             |
| `ledger/`    | Puts a server into a Ledger Key Ring with no USB port, using Rewall to deliver the credential.    |
| `cre/`       | A Chainlink workflow that reads a Rewall secret inside a secure enclave.                          |
| `rail/`      | A local copy of the private payment service, for testing only. Not part of Rewall.                |

Each folder owns its own dependencies. There is no root `package.json`. `sdk/` must be built before
anything that uses it, because the others import its `dist` folder.

## Running it

```bash
cd sdk && pnpm install && pnpm run build && pnpm test
```

Then pick a folder and read its README. Most need `tools/.env`, which holds the test wallet phrase
and is never committed. Copy `tools/.env.example` to start.

The test names on Sepolia, each held by its own wallet:

```
rewall-test-1.eth   the owner
rewall-test-2.eth   someone the owner shares with
rewall-test-3.eth   the recovery holder
```

## Rules the code follows

- Nothing is mocked. Every check runs against real Sepolia.
- Nothing is guessed. Contract addresses, signatures and package versions are read from a primary
  source or from the chain.
- Plaintext secrets and private keys are never logged, printed or written to disk.
- All cryptography comes from libsodium and WebCrypto. No custom primitives.

`CLAUDE.md` holds the working rules and the verified contract addresses.
