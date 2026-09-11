# Private transfer rail

A local stand in for Chainlink's Compliant Private Transfer service, which SPEC section 9 builds on.
It speaks the same wire format and the same vault semantics, so a client drives either one by
changing two environment variables.

## Why this exists

The deployed service at `convergence2026-token-api.cldev.cloud` authenticates requests but no longer
credits deposits. Verified across two finalised deposits, with the vault holding the tokens on chain
and every ACE policy check passing. The indexer that turns a `Deposit` event into a spendable
balance is not running, and only Chainlink can restart it.

Rather than stub the rail, this folder runs the missing half. Everything the client sees is real.

## This is not part of Rewall

It is a test harness that simulates somebody else's architecture. It must never become a component
of Rewall, for two reasons.

The server holds every balance in plaintext and holds the key that mints withdraw tickets. SPEC
section 10 rules out a Rewall operated server, and this is exactly one.

Rewall also has to stay portable back to Chainlink's service if it returns. So Rewall may use only
the five endpoints Chainlink documents, `/balances`, `/transactions`, `/shielded-address`,
`/private-transfer` and `/withdraw`, and may depend on nothing else this server does. Anything
Rewall wants to add goes in a receipt secret, never in the rail.

## What is real and what is not

Real, on Sepolia:

- The vault, the ACE policy engine and the token are deployed contracts
- `checkPrivateTransferAllowed` and `checkWithdrawAllowed` are `eth_call`s into Chainlink ACE
- Deposits and withdrawals move real ERC-20 balances
- Withdraw tickets are EIP-712 signatures the vault verifies by recovering the signer

Local, in this process:

- The balance ledger, the shielded address mapping and the transfer history

Private transfers never touch the chain, which is the point. Deposits and withdrawals do, and are
public with their amounts, so the vault's entry and exit are visible even though the transfers
between are not.

## Requirements

- Node 22 or newer, for `node:sqlite` and type stripping
- [Foundry](https://book.getfoundry.sh/getting-started/installation), to build and deploy the contracts
- A wallet with Sepolia ETH, about 0.02 covers a deploy

## Setup

`--no-git` keeps the contracts out of the parent repository's submodules, which is what `lib/` being
ignored expects.

```bash
forge install --no-git \
    foundry-rs/forge-std \
    OpenZeppelin/openzeppelin-contracts \
    OpenZeppelin/openzeppelin-contracts-upgradeable \
    smartcontractkit/chainlink-ace
pnpm install
cp .env.example .env
```

Put your mnemonic in `.env`, then deploy. It writes the three addresses to copy back in.

```bash
pnpm run deploy
```

Set `DEPLOYER_INDEX` to a wallet nothing else is using. A deploy is seven transactions in a row, so
any other process sending from the same account will take a nonce out from under it and the run
fails part way, leaving orphaned contracts behind. If that happens, a transaction is usually left
stuck in the mempool, and the next deploy reports `replacement transaction underpriced` until it
clears.

## Running

The server watches the chain and serves the API. Leave it running.

```bash
pnpm run serve
```

Then put tokens in and use them.

```bash
pnpm run deposit
pnpm run redeem <ticket>
```

`pnpm run verify` checks the privacy claims against the chain rather than taking them on trust, that
a private transfer moves no tokens through the vault, that a shielded address is unlinkable, and
that one account cannot read another's ledger.

`CONFIRMATIONS` defaults to 1 so the loop stays fast. Raise it to reproduce the roughly thirteen
minute finality delay the real service has, which is the window a dashboard has to render as
pending.

## Pointing a client at it

The SDK's transfer client targets Chainlink's deployment by default. Pass `api` and `vault` to
target this one instead.

```ts
import { Transfers } from "@rewall/sdk";

const transfers = new Transfers({
    account,
    api: "http://127.0.0.1:8787",
    vault: process.env.VAULT_ADDRESS,
});
```

## Layout

| Path                            | Role                                                                   |
| ------------------------------- | ---------------------------------------------------------------------- |
| `contracts/RewallTestVault.sol` | Custody, ACE policy calls and withdraw ticket verification             |
| `contracts/DemoToken.sol`       | A test ERC-20, since the vault moves tokens rather than ether          |
| `contracts/script/Deploy.s.sol` | Deploys the token, the policy engine and the vault, and registers them |
| `src/config.ts`                 | Every setting, all overridable from the environment                    |
| `src/db.ts`                     | SQLite ledger, amounts stored as decimal strings                       |
| `src/indexer.ts`                | Credits deposits, settles withdrawals, refunds expired tickets         |
| `src/server.ts`                 | The five endpoints, EIP-712 authentication, ticket signing             |

The wire format itself lives in the SDK at `transfer.ts`, so the client and this server cannot drift.

## Caveats

The vault's ticket signer is immutable, set at deployment. Changing `TICKET_SIGNER_INDEX` means
deploying a new vault, and tokens left in the old one cannot be withdrawn. Delete `rail.db` when you
redeploy, or the ledger will describe a vault that no longer holds the tokens.

Balances are held in one process with no authentication beyond the request signature. Anyone who can
reach the port can spend what they can sign for, and anyone who can read `rail.db` sees every
balance. Bind it to localhost and treat it as what it is, a development fixture.
