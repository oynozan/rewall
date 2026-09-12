# Enclave grantee

A Chainlink CRE Confidential Workflow that is granted a Rewall secret like any other participant,
opens it inside an AWS Nitro enclave, and returns only a digest of what it found.

## Why this exists

Every Rewall read needs the identity key, which comes from a wallet signature. That is fine while a
human is at the keyboard. It is not fine for anything unattended, because the only way to run a
nightly job today is to leave an identity key on the machine, and read access in Rewall can never be
revoked. Every key placed on a machine is a permanent liability.

An enclave closes that. It gets its own ENS name, publishes `rewall.pubkey` like any participant, and
is granted a secret with an ordinary `grant`. Revoking it is an ordinary rotation. The key lives in
the Vault DON and materialises only inside an attested enclave, for the length of one handler.

Nothing in the SDK knows an enclave exists. That is the claim worth checking.

## What the workflow does

One `handlerInTee` on a cron trigger, in four steps.

1. Crosses to the DON with `usingTheDons()` and reads `rewall.v`, `rewall.enc`, `rewall.blob` and its
   own wrap in one batched `resolve`. Chain reads never execute inside a TEE, and every record here
   is public ciphertext, so the crossover discloses nothing a chain observer does not already have.
2. Back inside the enclave, fetches its X25519 scalar from the Vault DON.
3. Opens the libsodium sealed box, checks the key commitment, decrypts the blob with AES-256-GCM
   using `namehash(secretName)` as additional data, and unpads strictly.
4. Returns a SHA-256 digest of the plaintext. The plaintext itself never crosses the boundary.

The QuickJS runtime has no WebCrypto and no libsodium, so step 3 is rebuilt from `@noble` primitives.
It also has no `atob`, which the Chainlink docs get wrong in both directions, so base64 goes through
`Buffer`.

## What is real and what is not

Real:

- The secret, its records and the grant, all on ENSv2 Sepolia
- The enclave's ENS name, `enclave.rewall-test-2.eth`, with a generated key it does not derive from a wallet
- The read, which is a live `eth_call` through `UniversalResolverV2`
- The crypto, verified byte for byte against libsodium and WebCrypto before it went near the runtime

Not real:

- The enclave. `cre workflow simulate` runs the handler locally and says so on every run. Deploying to
  a Nitro enclave needs private beta enrollment, which gates deployment only.

## Requirements

- The CRE CLI at v1.29.0 or newer, since `handlerInTee` does not exist below it
- [Bun](https://bun.sh/), which is what the CRE toolchain compiles with
- A funded Sepolia wallet in `tools/.env`, for the two provisioning scripts

On Windows, install the CLI inside WSL and run every `cre` command there. `cre update` downloads the
new binary and then refuses to replace itself, and `cre init` ignores `--non-interactive` and opens a
full screen prompt that never returns.

## Setup

```bash
cd enclave-grantee && bun install && cd ..
node --env-file=../tools/.env --experimental-strip-types provision.ts
node --env-file=../tools/.env --experimental-strip-types grant.ts
```

`provision.ts` registers the enclave's name and publishes its key, writing the scalar straight into
`.env` without printing it. `grant.ts` stores a secret, grants the enclave, and writes the workflow
config that points at it.

## Running

```bash
cre workflow simulate enclave-grantee --target staging-settings --non-interactive --trigger-index 0
```

A cold run takes about ninety seconds, nearly all of it compilation. Build once and reuse the binary
to get that to three:

```bash
cre workflow build enclave-grantee -o enclave-grantee.wasm
cre workflow simulate enclave-grantee --target staging-settings --non-interactive \
    --trigger-index 0 --wasm $PWD/enclave-grantee.wasm
```

`--wasm` needs an absolute path. Rebuild after editing the workflow.

## Watching a revocation land

```bash
node --env-file=../tools/.env --experimental-strip-types access.ts revoke
```

The wrap is cleared, the grantee list empties and the approved keys drop the enclave. Simulate again
and the same binary refuses with `no wrap at rewall.key.<fingerprint>, this enclave is not a grantee`.
`access.ts grant` puts it back.

Nothing about the workflow changes between those runs. The only thing that changed is a record on
Ethereum saying whether this name may still read.

## Layout

| Path                          | Role                                                               |
| ----------------------------- | ------------------------------------------------------------------ |
| `enclave-grantee/workflow.ts` | The TEE handler, the ENS read and the Rewall read path in QuickJS  |
| `enclave-grantee/main.ts`     | The runner, unchanged from the Chainlink template                  |
| `enclave-grantee/config.json` | Which secret to open, written by `grant.ts`                        |
| `provision.ts`                | Registers the enclave's name and publishes its key                 |
| `grant.ts`                    | Stores a secret and grants the enclave                             |
| `access.ts`                   | Revokes or re-grants, for showing a revocation take effect         |
| `check-batched-read.mjs`      | Checks the batched ENS read against the per key reads the SDK does |
| `secrets.yaml`                | Maps `ENCLAVE_SCALAR` to the environment variable holding it       |

## Caveats

The enclave's key is generated on an operator machine and uploaded to the Vault DON, so the honest
claim is that an operator plus an attested enclave holds it, not the enclave alone. Nothing published
binds `rewall.pubkey` to a measured enclave image, and the CRE docs expose no attestation document to
workflow authors, so a grantor cannot check what is behind that name.

The enclave's name is a subname of `rewall-test-2.eth`, so the parent can rewrite its published key.
That is the exact attack `rewall.auth.keys` exists to stop, and binding the key at grant time is what
stops it.
