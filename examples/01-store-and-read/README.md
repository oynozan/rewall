# 1. Store a secret and read it back

Alice keeps her database connection string in Rewall instead of a `.env` file.

```bash
pnpm run 01
```

## What happens

Alice calls `create`. Four things happen on her machine before anything is sent:

1. A random 32 byte key is generated. This is the data key.
2. The connection string is encrypted with that key.
3. The data key is wrapped separately for every person who should read it.
4. All of it is written to ENS in one transaction.

The connection string is never sent anywhere in the clear. Only the encrypted
form goes on chain.

Then Alice calls `get`. Her wallet signs one message. That signature becomes her
private key in memory. She uses it to unwrap the data key, and the data key
decrypts the connection string.

## Why recovery is required

Look at the `recovery` option. It is not optional and the SDK will refuse without it.

If Alice loses her wallet, her key is gone. The encrypted value stays on chain
forever, readable by nobody. Naming a second holder is the only thing that
prevents that. Example 5 shows a stronger version of this.

## What is on chain now

Go and look. The records are public:

```
https://sepolia.etherscan.io/address/0x1A0578825afDf388F5107117F81A57375cf7060f
```

You will see the encrypted blob and one wrapped key per reader. You will not see
the connection string, because it is not there.

## The important part

Nobody had to trust a server. There is no Rewall backend. The encryption happened
on Alice's laptop and the storage is ENS, which anyone can read and nobody can
read _through_.
