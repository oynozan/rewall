# web

The Rewall dashboard. A Next.js app where you store secrets, share them by ENS name, take them back,
hold 2FA accounts, and send private payments. Recovering a lost wallet is done with the SDK.

It reads and writes Sepolia directly from the browser. There is no Rewall backend. The few server
routes it has exist to pay for a new user's setup, not to hold or see any secret.

## Pages

| Route                  | What it shows                                                         |
| ---------------------- | --------------------------------------------------------------------- |
| `/`                    | The landing page.                                                     |
| `/dashboard`           | Your vault at a glance.                                               |
| `/dashboard/secrets`   | Every secret under your name. Store, reveal, share, revoke, rotate.   |
| `/dashboard/2fa`       | Your authenticator accounts with live codes. Pair the extension here. |
| `/dashboard/transfers` | Pay a name privately and see receipts shared with you.                |
| `/dashboard/setup`     | A four step wizard for a wallet that has never used Rewall.           |

Connect a wallet through Privy. The first time, you sign one message and that signature becomes your
key. The dashboard keeps it in memory for the tab and never stores it.

## Server routes

| Route            | What it does                                                             |
| ---------------- | ------------------------------------------------------------------------ |
| `/api/account`   | Says whether a wallet has been seen before, so the wizard knows to open. |
| `/api/faucet`    | Sends a new wallet a little Sepolia ETH and USDC, once, with a cap.      |
| `/api/provision` | Registers a name and its resolver for a new user, paid by the project.   |
| `/api/rail`      | Forwards payment calls to the private transfer service.                  |

These use a sponsor wallet and a local MongoDB. Both are set in `.env.local`. The sponsor is its own
wallet, not the funder in `tools/.env`, because this one faces the internet.

## Running it

```bash
cd ../sdk && pnpm run build
cd ../web && pnpm install
cp .env.template .env.local     # fill in the Privy ids and the sponsor key
pnpm run dev                    # http://localhost:3000
```

Privy needs an app id and client id from its console. MongoDB must be running on `127.0.0.1:27017`
for the faucet and the wizard. Everything else works without either.

## Checking it

The `check:*` scripts drive a real browser against a running dev server with a real wallet behind a
headless provider. They sign real messages and send real Sepolia transactions.

```bash
pnpm run build && pnpm run start
pnpm run check:dashboard        # in another shell
pnpm run check:create
pnpm run check:sharing
```

There are more. `pnpm run` with no argument lists them. The wallet they use comes from `tools/.env`.

## Notes

- Fonts and icons are credited in `ATTRIBUTIONS.md`.
- The transfer pages need the rail running. See `rail/README.md`.
- `check:*` scripts write screenshots to a temp folder, never into the repo.
