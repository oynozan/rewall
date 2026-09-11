# @rewall/ledger

Enrolling an agent into a Ledger Key Ring when the agent's machine has no USB port.

The Key Ring can encrypt for many members, and a member is only a keypair, so a server can be one.
What the Key Ring has no answer for is how a member reaches a machine you are not sitting at.
`wallet-cli ring` has five verbs, `init`, `encrypt`, `decrypt`, `keys` and `destroy`, and none of
them enrol anything. That gap is what this fills.

## The split

**Ledger answers "is this machine allowed in, and did a human agree?"** The device renders the join
on its own screen and someone presses the button. No software wallet can offer that, because malware
on the host can produce a signature but cannot press a button on a separate device.

**Rewall answers "who is this machine, and how does the credential reach it?"** The member is stored
as a secret sealed to the agent's ENS name, so it travels encrypted on a public chain, addressed by
a name rather than an IP, and is revoked by rotating rather than by remembering which boxes hold a
copy.

## Running it

```bash
cd ../sdk && pnpm run build
cd ../ledger && pnpm install

# Build the real Ledger Sync app and run it in the emulator, see "no hardware" below
pnpm run speculos

pnpm run enroll     # owner, device approves, member sealed to the agent's name on chain
docker stop speculos
pnpm run agent      # agent, no device reachable, reads the member and uses the ring
```

`enroll` mints one member keypair for one agent, has the device approve it, then writes
`ledger-ring.rewall.<owner>` granted to the agent's name. `agent` reads that secret with its Rewall
identity, rebuilds the member, and authenticates with `trustchainId` and no session, which is the
path the SDK's own types allow:

```ts
{ keyPair; clientName; permissions } & ( { trustchainId; sessionId? } | { trustchainId?; sessionId } )
```

The device is optional exactly when the trustchain is already known. That is the whole basis of this.

## No hardware

The device is emulated with [Speculos](https://github.com/LedgerHQ/speculos) running
[app-ledger-sync](https://github.com/LedgerHQ/app-ledger-sync), the real Key Ring app, compiled from
source with Ledger's own `ledger-app-builder` image. Nothing is stubbed. The APDUs, the secp256k1
signing and the trustchain blocks are real, and only the silicon is emulated, which is the same
bargain this project already makes by running on Sepolia rather than mainnet.

Two consequences, stated rather than hidden:

- **It runs against Ledger's staging trustchain.** Production refuses a self-compiled app with
  `401 Attestation is for an unknown application`, because the attestation is not Ledger-signed. On
  real hardware with the store build, the same code points at production.
- **Speculos is a development tool.** Ledger's own guidance is that it must not back a production
  ring, and this repo agrees.

## What it does not fix

The member private key does travel to the agent. It has to, because the SDK has no call that adds
someone else's public key to a trustchain, so the keypair must exist on the machine holding the
device at the moment of approval.

What changes is which credential moves and how. It is one member minted for one agent, not the
owner's own ring membership, so removing it cuts off that agent alone. It moves sealed to the agent's
published key rather than copied over SSH. And it is revoked by name, on chain, rather than by
remembering where it was put.

A compromised agent still loses the ring access it holds. Hardware does not fix host compromise. It
fixes onboarding, which is where the ceremony was missing.

## Rough edges found while building this

Kept here because the hackathon asks for developer experience feedback and these cost real time.

- **`wallet-cli` cannot reach Speculos.** Its binary carries `SPECULOS_API_PORT`, `SPECULOS_DEVICE`,
  `COINAPPS` and `SEED` from bundled `live-env`, so they look like configuration, but the transport
  it ships is WebUSB and nothing consults them. `DEVICE_PROXY_URL`, documented as "enable a proxy to
  use instead of a physical device", is also ignored. The emulator-capable CLI is a different,
  internal one that has no `ring` command.
- **Only `OWNER` permissions enrol.** `Permissions.CAN_ENCRYPT` and `CAN_ENCRYPT | CAN_ADD_BLOCK`
  both fail with `Security issue with bad state` after the first approval. Least privilege is in the
  enum but not reachable on this path, so an agent has to be given the whole ring.
- **The DMK ESM build does not run under Node.** `@ledgerhq/device-management-kit` resolves a
  directory import, `lib/esm/src`, which Node's ESM resolver refuses, so it works only behind a
  bundler even though the docs show a Node CLI. Everything here imports the CJS entry instead.
- **`@ledgerhq/device-trusted-app-kit-ledger-keyring-protocol` ships an empty README.** "How it
  works", "Initialisation", "Use Cases" and "Example" are all present as headings with no content,
  and npm returns 403 to unauthenticated fetches, so the type definitions are the only documentation.
- **Nothing points at staging.** The production 401 does not mention that `LKRPEnv.STAGING` exists or
  that a self-built app needs it, and the staging host appears only in the bundle.
