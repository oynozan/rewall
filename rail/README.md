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

Put your mnemonic in `.env`, then deploy. It prints the vault and the policy engine to copy back in,
alongside the token it registered, which is Circle's Sepolia USDC unless `TOKEN_ADDRESS` names another.

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

Then put tokens in and use them. The deployer needs a USDC balance first, since nothing here mints it.

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
    api: "http://127.0.0.1:8788",
    vault: process.env.VAULT_ADDRESS,
});
```

## Running behind the dApp

A browser cannot call this server. It sends no `Access-Control-Allow-Origin` header, and it answers
anything that is not a POST with a 404, so the preflight the SDK's `Content-Type` triggers fails
before the real request is ever sent. The dApp therefore posts to its own `/api/rail/<endpoint>`,
which forwards the already signed body here and relays the answer back untouched. That proxy holds no
key, signs nothing, decrypts nothing, caches nothing and reads no field, and it refuses any path
outside the five. It is a hop, not a party to the transfer, and the signature this server checks is
still the only thing that authorises a spend.

Deploy first, then leave the server running.

```bash
pnpm run deploy
pnpm run serve
```

The token is Circle's Sepolia USDC, which nothing here can mint. The dApp's faucet hands a new wallet
one of it out of the sponsor's own balance, so send that wallet some USDC from Circle's faucet before
anybody tries to deposit. A redeploy does not change this, since the token is not redeployed with it.

The dApp needs `NEXT_PUBLIC_REWALL_VAULT` and `REWALL_RAIL_URL` in `web/.env.local`. `pnpm run deploy`
prints the vault ready to paste, and the token address is fixed in `web/src/lib/rail.ts` rather than
configured. If every call comes back `request authentication failed`, the vault address there is from
a previous deploy, because the vault is the EIP-712 `verifyingContract` and a stale one recovers to a
different signer.

## Running it on a VPS

`RAIL_HOST` defaults to `127.0.0.1`, which is the only default worth having. If the dApp and this
server share a host, leave it and let the proxy reach it over loopback.

If they do not share a host, bind the private interface the two of them share and firewall the port
to the web host's address. Do not publish it. Setting `RAIL_HOST` to `0.0.0.0` puts every balance in
this process behind nothing but a signature check, and the caveat below is not a figure of speech.

There is no TLS here and none is planned. If the hop between the dApp and this server crosses
anything public it belongs in a tunnel or behind a reverse proxy that terminates TLS, and note what
that does and does not buy, the signature protects the payer from a forged spend, not the ledger from
being read.

## Layout

| Path                            | Role                                                                       |
| ------------------------------- | -------------------------------------------------------------------------- |
| `contracts/RewallTestVault.sol` | Custody, ACE policy calls and withdraw ticket verification                 |
| `contracts/script/Deploy.s.sol` | Deploys the policy engine and the vault, and registers the token with them |
| `src/config.ts`                 | Every setting, all overridable from the environment                        |
| `src/db.ts`                     | SQLite ledger, amounts stored as decimal strings                           |
| `src/indexer.ts`                | Credits deposits, settles withdrawals, refunds expired tickets             |
| `src/server.ts`                 | The five endpoints, EIP-712 authentication, ticket signing                 |

The wire format itself lives in the SDK at `transfer.ts`, so the client and this server cannot drift.

## Caveats

The vault's ticket signer is immutable, set at deployment. Changing `TICKET_SIGNER_INDEX` means
deploying a new vault, and tokens left in the old one cannot be withdrawn. Delete `rail.db` when you
redeploy, or the ledger will describe a vault that no longer holds the tokens.

Balances are held in one process with no authentication beyond the request signature. Anyone who can
reach the port can spend what they can sign for, and anyone who can read `rail.db` sees every
balance. Bind it to localhost and treat it as what it is, a development fixture.
