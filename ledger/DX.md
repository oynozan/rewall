# Developer experience notes

Written while building `ledger/`, which enrols an agent into a Ledger Key Ring over ENS. Everything
below was hit in practice, on Windows 11 with Node 22.14, against:

```
@ledgerhq/wallet-cli                                    2.1.0
@ledgerhq/device-management-kit                         1.9.0
@ledgerhq/device-transport-kit-speculos                 1.2.1
@ledgerhq/device-trusted-app-kit-ledger-keyring-protocol 0.5.0
app-ledger-sync                                         1.2.2, built from source
```

No physical device was available, which is itself the lens most of this is seen through.

## What worked well

**Speculos and `ledger-app-builder` are the best part of the stack.** `app-ledger-sync` being a
public repo that compiles in one documented Docker command is what made this project possible at
all. Our whole setup is now a single script that goes from an empty directory to a device reporting
`Ledger Sync app is ready` in about two minutes, and it worked first time.

**The device-action model is good to build against.** `{ observable, cancel }` with
`DeviceActionStatus` and, in particular, `intermediateValue.requiredUserInteraction`, meant driving
approvals was straightforward, and the step names (`lkrp.steps.authenticate`, `lkrp-add-member`,
`lkrp.steps.extractEncryptionKey`) made it obvious where a failure happened.

**One type taught us the product.** This union in `AuthenticateUsecaseInput` is where we learned that
a device-less host is a supported case at all:

```ts
{ keyPair; clientName; permissions } & ( { trustchainId; sessionId? } | { trustchainId?; sessionId } )
```

`sessionId` being optional exactly when `trustchainId` is known says the whole thing. It is better
documentation than the prose we could find, which is also the problem, below.

## Blocking issues

### 1. `wallet-cli` cannot talk to Speculos, and looks like it can

This cost the most time by far. The prize asks for the Key Ring on hosts with no USB port, the CLI
is the named entry point, and with no hardware the natural move is to point it at the emulator.

Its binary contains `SPECULOS_API_PORT`, `SPECULOS_DEVICE`, `SPECULOS_FIRMWARE_VERSION`,
`SPECULOS_USE_WEBSOCKET`, `COINAPPS` ("defines the folder for speculos mode that contains Nano apps
binaries") and `SEED` ("seed to be used by speculos (device simulator)"). It also contains
`DEVICE_PROXY_URL`, described as "enable a proxy to use instead of a physical device". Setting any
of them changes nothing: the bundled transport is WebUSB, and none of those values are consulted.
They are inert schema entries pulled in with `live-env`.

Establishing that required grepping a 163 MB single-file binary. The answer, once found, is that the
Speculos-capable CLI is a different, internal one that has no `ring` commands.

**Suggested fix.** Either wire `SPECULOS_API_PORT` through to
`@ledgerhq/device-transport-kit-speculos`, which already exists and works, or have `ring` fail with
"this CLI only supports USB devices" when those variables are set. A one-line note in the CLI docs
saying the emulator is not supported would have saved a day.

### 2. `WALLET_CLI_MOCK=1` does not mean what it looks like

It swaps the LKRP backend for a mock client. It does not mock the device, so `ring init` still fails
with "No Ledger device found" and the name suggests the opposite. It is also undocumented.

**Suggested fix.** Rename to `WALLET_CLI_MOCK_BACKEND`, or document the scope.

### 3. Production gives no route to staging

A self-compiled app fails authentication with:

```
401 Unauthorized: Attestation is for an unknown application
(from: https://trustchain.api.live.ledger.com/v1/authenticate)
```

That is the correct refusal, since the attestation is not Ledger-signed. But nothing says
`LKRPEnv.STAGING` exists, and the staging host appears only inside the bundle. We found it by
grepping the package for URLs. Anyone developing against Speculos will hit this 401 as their first
result and has no documented next step.

**Suggested fix.** Say in the error, or in the Key Ring docs, that emulator and self-built apps must
use the staging environment, and name it.

### 4. Least privilege does not work

`Permissions` exposes `OWNER`, `CAN_ENCRYPT`, `CAN_DERIVE` and `CAN_ADD_BLOCK`, which reads like an
invitation to give an agent the minimum it needs. In practice only `OWNER` enrols. Both
`Permissions.CAN_ENCRYPT` and `Permissions.CAN_ENCRYPT | Permissions.CAN_ADD_BLOCK` fail after the
first device approval with:

```
Security issue with bad state
```

So an agent that should only decrypt has to be given the whole ring. For the use case this track is
about, agents that hold secrets they cannot leak, that is the wrong default and it is the single
change that would most improve the security story.

**Suggested fix.** Either support scoped permissions on enrolment, or document which values are
valid there and reject the others with a message naming the constraint.

### 5. No way to enrol another member's public key

The track asks for enrolling a VPS or CI runner. The clean shape is: the host generates a keypair,
publishes the public half, and the owner approves adding it, so nothing secret ever travels.

`app-ledger-sync`'s own Python tests do exactly that:

```python
bob = device.software()
stream.edit().add_member("Bob", bob.get_public_key(), 0xFFFFFFFF, True).issue(alice, tree)
```

The TypeScript kit exposes three use cases — `Authenticate`, `EncryptData`, `DecryptData` — and
`authenticate` enrols the caller's own keypair. So the capability exists in the protocol and in the
test tooling, but not on the supported TS path, which forces the member key to be generated on the
machine holding the device and then delivered to the host.

**Suggested fix.** Expose an add-member use case taking a public key and permissions. This is the
one change that would let the prize's own example be built the obvious way.

## Smaller friction

**The DMK ESM build does not run under plain Node.** `@ledgerhq/device-management-kit` resolves a
directory import:

```
ERR_UNSUPPORTED_DIR_IMPORT: .../device-management-kit/lib/esm/src
```

Node's ESM resolver requires a file, so it only works behind a bundler, even though the DMK docs
include a Node.js CLI example. Everything here imports the CJS entry through `createRequire`.

**`@ledgerhq/device-trusted-app-kit-ledger-keyring-protocol` ships an empty README.** "How it works",
"Initialisation", "Use Cases", "Observable Behavior" and "Example" are headings with nothing under
them, and npm returns 403 to unauthenticated fetches, so the `.d.ts` files are the only reference.

**`applicationId` is undocumented.** `LedgerKeyringProtocolBuilder` requires one and nothing says
what to pass. We used `17` after finding `applicationId: 17` in the wallet-cli bundle.

**Approval wording is not enumerated.** The two screens are `Connect` and `Turn On sync`, and each
sits under a differently worded question. Automating or testing an approval means scraping the
screen and guessing which line is the action, because nothing lists the strings per device model.

**The security key page reads like an escape hatch and is not one.** The Key Ring is described as
having "OpenPGP and FIDO2 support", and the linked page is titled around FIDO2. It documents the
Ledger _being_ a FIDO2 authenticator, not a third-party key standing in for one. With no hardware
that distinction matters a lot, and it took a while to be sure.

## The one thing to change

If only one thing gets fixed: **make it possible to enrol a member by public key, with scoped
permissions.** Issues 4 and 5 are the same wish from two directions, and together they are the
difference between "the agent holds a credential that can do everything, delivered somehow" and "the
agent holds the least it needs, and nothing secret ever moved."
