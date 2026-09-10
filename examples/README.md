# Rewall examples

Five short programs. Each one is a real scenario, runs against real Sepolia, and
fits on one screen.

Read them in order. Each README explains what happened and why.

|                                                      | What it shows                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| [1. Store and read](01-store-and-read)               | Keep a database connection string somewhere other than a `.env` file |
| [2. Share with a teammate](02-share-with-a-teammate) | Give one person access, using only their ENS name                    |
| [3. Take access away](03-take-access-away)           | Revoke someone, and what revoking cannot do                          |
| [4. Share with a team](04-share-with-a-team)         | Grant to a whole group without naming anyone in it                   |
| [5. Recover a lost wallet](05-recover-a-lost-wallet) | Get back in when your key is gone                                    |

## What Rewall is

A secret manager with no server.

Your secret is encrypted on your machine and stored in ENS records. Access is
granted to ENS names. There is no account to make, no company to trust, and
nobody who can read your secrets except the names you encrypted them to.

## Setup

You need Node 22 or newer.

```bash
pnpm install
cp .env.example .env
```

Put a twelve word phrase in `.env`. Use a throwaway one. Every example derives
its wallets from it.

The first wallet needs a little Sepolia ETH, about 0.05 is plenty. Everything
else costs nothing, because the test tokens mint freely.

Then register the names the examples write to:

```bash
pnpm run setup
```

Now run them:

```bash
pnpm run 01
pnpm run 02
pnpm run 03
pnpm run 04
pnpm run 05
```

## The cast

Everyone here is an ENS name with a wallet behind it.

| Who          | Name                       | Their part                          |
| ------------ | -------------------------- | ----------------------------------- |
| Alice        | `rewall-test-1.eth`        | Owns the secrets                    |
| Bob          | `rewall-test-2.eth`        | A teammate, and later a team        |
| Cold storage | `rewall-test-3.eth`        | A backup wallet Alice keeps offline |
| CI           | `ci.rewall-test-2.eth`     | A machine on Bob's team             |
| Deploy       | `deploy.rewall-test-2.eth` | Another machine on Bob's team       |

## Three ideas that explain everything else

**A secret is encrypted once, for many people.** One random key encrypts the
value. That key is then wrapped separately for each reader. Adding a reader adds
one small record and leaves the encrypted value untouched.

**Reading is not a permission.** Nothing checks whether you are allowed. You
either hold a wrapped copy of the key or you do not. There is no list to be on
and no server to ask.

**Revoking means re-encrypting.** Since there is no permission to withdraw, the
only way to shut someone out is to change the key and not give them the new one.
This is why revoke and rotate are the same operation.

## What this does not protect you from

Worth knowing before you trust it with anything real.

- Someone who already read a secret still knows it. Revoking is not amnesia.
- If you let someone write your records, they can swap the encrypted value for
  one of their own. Only delegate writes to someone you would trust with the
  contents.
- Everything is public except the plaintext. Who granted what, and when, is
  visible to anyone reading the chain.
- This runs on Sepolia, a test network. Do not put a real credential in it.
