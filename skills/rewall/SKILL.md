---
name: rewall
description: Rewall is secret storage with no server, built on ENSv2 Sepolia. A secret is encrypted on the user's device, stored as ENS text records under a subname the user owns, shared by sealing its key to other ENS names, and taken back by rotation. Use this skill when a user mentions Rewall, wants to store or share a credential by ENS name, wants an AI agent to use a secret without seeing it, or is building on the Rewall SDK or MCP server.
license: See the repository at https://github.com/oynozan/rewall
metadata:
  author: oynozan
  docs: https://docs.rewall.me
  source: https://github.com/oynozan/rewall
---

# Rewall

Secret storage with no server. A secret is encrypted on the user's machine and stored under an ENS
name they own. They share it by naming who may read it. They take it back by rotating. Nobody but
the names they chose can read it. There is no account, no login and no company in the middle.

Everything runs on ENSv2 Sepolia, a test network. Real credentials do not belong in it yet.

Full docs: https://docs.rewall.me. Source: https://github.com/oynozan/rewall.

## Vocabulary

- **Name.** Every person, team or machine is an ENS name such as `alice.eth`. A name publishes one
  X25519 public key as the text record `rewall.pubkey`.
- **Secret.** A subname under a name, `<secret>.rewall.<name>.eth`, for example
  `openai.rewall.alice.eth`. The `rewall` label keeps secrets in one place and leaves
  `openai.alice.eth` free.
- **Data key.** A random 32 byte key that encrypts one secret with AES-256-GCM. The ciphertext is
  the record `rewall.blob`.
- **Sealed copy.** The data key sealed to one reader's public key with a libsodium sealed box, stored
  as `rewall.key.<fingerprint>`. One record per reader.
- **Fingerprint.** The first 8 bytes of `keccak256(pubkey)`, 16 lowercase hex characters.
- **Identity key.** The reader's X25519 secret key. It is derived from one wallet signature and is
  never stored in plaintext.
- **Rotation.** A new data key, a new blob, new sealed copies for everyone who stays. Revoke and
  rotate are the same operation.
- **Recovery holder.** A second name, or k of n guardians, that can always open the secret. Every
  secret has at least one.
- **Subtree.** A grant to a name and every subname under it, so a whole team reads at once.

## Three ways in

1. **A person** uses the dashboard at https://rewall.me. Nothing to install. Connect a wallet, sign
   one message, store, share, revoke, recover, hold 2FA codes, pay a name privately.
2. **An app** uses the SDK, `@rewall/sdk`. It is not on npm. It lives in `sdk/` in the repository.
   Clone the repo, build it, and link it as `"@rewall/sdk": "link:../sdk"`. Details in
   [references/sdk.md](references/sdk.md).
3. **An agent** uses the MCP server. It decrypts inside its own process, uses the value, and returns
   a result with the value removed. The model never receives plaintext. Hosted at
   `https://mcp.rewall.me/mcp`, or run locally. Details in [references/mcp.md](references/mcp.md).

## Integrate with the SDK

```bash
git clone https://github.com/oynozan/rewall
cd rewall/sdk && pnpm install && pnpm run build && pnpm test
```

```ts
import { Rewall } from "@rewall/sdk";

const rewall = new Rewall({
    publicClient, // viem, reads
    walletClient, // viem, writes and the one signature
    account,
    name: "alice.eth", // the namespace this client acts as
    universalResolver: "0x4a1817d13e9cf196f471725176355c1234b63c70",
});

await rewall.publishIdentity(); // writes rewall.pubkey on alice.eth, once
await rewall.create("openai.rewall.alice.eth", plaintext, {
    type: "apikey",
    grantees: ["bob.eth"],
    recovery: ["vault.alice.eth"], // required, at least one
    allow: ["api.openai.com"], // hosts the MCP server may send it to
});

const value = await rewall.get("openai.rewall.alice.eth"); // Uint8Array, memory only
await rewall.grant("openai.rewall.alice.eth", "carol.eth");
await rewall.revoke("openai.rewall.alice.eth", "bob.eth"); // rotates
await rewall.list();
```

`plaintext` is a `Uint8Array`. `get` returns one. Wipe it when done. The wallet must be MetaMask or
another plain key wallet that signs the same way every time. Smart contract and MPC wallets do not.

A client built with an `identity` and no `walletClient` can read but not write. That is how the MCP
server and the browser extension run.

## Give an agent a secret

The owner stores the secret with `allow` set to the hosts it may reach, then grants the agent's ENS
name. The agent runs the MCP server with its own identity and the model calls tools:

| Tool               | What the model gets back                                            |
| ------------------ | ------------------------------------------------------------------- |
| `list_secrets`     | Labels, types, allowed hosts, and whether this agent holds a key.   |
| `http_with_secret` | The response of an HTTPS request with the secret attached, redacted. |
| `otp_code`         | Six digits and the seconds left, from a `totp` secret.               |
| `sign_with_secret` | A signed ERC-20 transfer, unbroadcast, inside a policy.              |

Add the hosted server to Claude Code with this `.mcp.json` entry, where the seed belongs to an agent
identity the user minted, never to their wallet:

```json
{
    "mcpServers": {
        "rewall": {
            "type": "http",
            "url": "https://mcp.rewall.me/mcp",
            "headers": { "X-Rewall-Vault": "alice.eth", "X-Rewall-Seed": "the agent's seed" }
        }
    }
}
```

The hosted server holds no vault of its own, so each caller reaches only what their own agent name
was granted. `pnpm run agent <vault.eth> <label>` in `mcp/` mints an agent identity and writes that
config. Never suggest putting a wallet derived identity in those headers, because it reads every
secret ever shared with that wallet and no rotation can take it back.

A refusal from a tool is policy, not an error. Tell the user what the policy says and stop. Never ask
the user to paste the secret instead.

## Rules for any agent working with Rewall

- Never print, log, or write a plaintext secret or a private key anywhere. Hold it in memory and
  wipe it.
- Never ask a user to paste a secret into the chat.
- The identity signature is the key. Never request the `Identity` typed data with domain `Rewall`
  outside a Rewall client, and never build a tool that signs a model chosen payload.
- Revocation is forward only. Whoever held a key can still decrypt the old value from chain history.
  When someone leaves, rotate the credential at the service that issued it, then replace the value.
- Sepolia only. The registrar is paid in a mock token with an open mint, so a name costs only gas.
- Never hardcode or cache a resolver address. Find it with `UniversalResolverV2.findResolver`.
- Never install `@ensdomains/ensjs`. Its registrar writes into a registry nothing resolves against.
  Use raw viem with `parseAbi`.
- Never mock the chain. Every check runs against real Sepolia.
- Read permission is a sealed copy, not a role. Nothing checks a list. Write permission is an ENSv2
  role inside the owner's resolver.

## The records

On a secret subname: `rewall.v`, `rewall.type`, `rewall.enc`, `rewall.blob`, `rewall.key.<fp>`,
`rewall.owner`, `rewall.grantees`, `rewall.subtrees`, `rewall.recovery`, `rewall.holders`,
`rewall.auth.n`, `rewall.auth.keys`, `rewall.auth.sig`, `rewall.site`, `rewall.allow`,
`rewall.created`. On a participant name: `rewall.pubkey`, `rewall.index`, the subtree, guardian and
recovery records, and `rewall.shielded`. Every one is described in
[references/records.md](references/records.md).

## Where to read more

- https://docs.rewall.me/how-it-works, the protocol in plain words, with the key derivation.
- https://docs.rewall.me/ensv2, exactly how ENSv2 is used, with the Sepolia addresses.
- https://docs.rewall.me/components/sdk, every SDK method.
- https://docs.rewall.me/components/mcp, the MCP server, its refusals and its redaction.
- https://docs.rewall.me/examples, eight short programs, one per feature.
- `SPEC.md` in the repository is the source of truth for the protocol.

## Repository layout

| Folder       | What it is                                                                 |
| ------------ | -------------------------------------------------------------------------- |
| `sdk/`       | The core library, `@rewall/sdk`. Everything else builds on it.             |
| `web/`       | The dashboard at rewall.me.                                                |
| `mcp/`       | The MCP server.                                                            |
| `extension/` | The browser extension that fills 2FA codes.                                |
| `examples/`  | Eight runnable programs against real Sepolia.                              |
| `tools/`     | Setup and proof scripts, and the test wallet phrase in `.env`.             |
| `ledger/`    | Enrols a server into a Ledger Key Ring over ENS. Optional.                 |
| `cre/`       | A Chainlink CRE workflow that opens a secret inside an enclave.            |
| `rail/`      | A local stand in for the private transfer service. Testing only.           |
| `docs/`      | This documentation site.                                                   |
