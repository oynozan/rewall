# The MCP server

MCP is a standard way for an AI assistant to call tools. The Rewall MCP server lets an assistant
use a secret without ever reading it. The assistant asks for a request to be sent. The server
decrypts the secret inside its own process, attaches it, sends it, and returns the response with the
secret redacted. The value never enters the model's context.

## The tools

| Tool               | What the model gets back                                                       |
| ------------------ | ------------------------------------------------------------------------------ |
| `list_secrets`     | Label, type, allowed hosts, and whether this agent holds a key. Metadata only. |
| `http_with_secret` | The response, redacted. Never the secret.                                      |
| `otp_code`         | Six digits and the seconds left. Never the seed.                               |
| `sign_with_secret` | A signed ERC-20 transfer, unbroadcast. Never the key.                          |

Start with `list_secrets`. `otp_code` works only on a `totp` secret. `sign_with_secret` works only
on a `privkey` secret with an entry in `policy.json`.

## How a request is refused

`http_with_secret` fails closed, in this order, before anything is decrypted:

- not parseable as a URL, or not `https:`
- a username or password in the URL
- a non default port
- an IP literal, including `169.254.169.254` and its decimal and hex spellings
- an empty or absent `rewall.allow`, which means deny every host
- a hostname not exactly in the list. No wildcards, no suffix matching
- a secret whose type is `privkey`, `totp` or `seed`
- more than 30 calls a minute for one secret

Redirects are never followed. A refusal is policy, not a failure. Tell the user what the policy
says and stop. Do not retry against a different host, do not look for another route to the same
value, and never ask the user to paste the secret instead.

## Redaction

The response is scanned for the secret in every shape it could come back as: raw, base64 in four
variants, hex in four, percent encoded, and JSON escaped. Anything outside a small content type
allowlist comes back as status and length only. Redaction is an alarm. A host echoing the credential
is misconfigured or probing, so the third redaction disables that secret for the session.

## Signing

The model may name a token, a recipient and an amount. It may not supply calldata, a message, typed
data, or a hash. Only an ERC-20 transfer can be built, so `approve`, `setApprovalForAll` and
`permit` are unreachable. There is no general signing tool, because the identity key is derived from
a signature over `IDENTITY_TYPED_DATA`, and a tool that signed a model chosen payload would hand over
the wallet's identity for every secret ever shared with it. The server also refuses to sign with the
key backing its own identity.

## What it does not protect

It defends the model boundary, not the machine. Anyone who can run code as the same user can read
the seed out of the process and decrypt every secret granted to it. The host holds the 32 byte X25519
scalar and no wallet key, so a compromised host can read what was granted to that name and nothing
else. It cannot sign, spend gas, or rewrite ENS records.

## Running it

Locally over stdio, from `mcp/`:

```bash
cp .env.example .env # REWALL_NAME, then pnpm run seed to fill REWALL_IDENTITY_SEED
cd ../sdk && pnpm run build
cd ../mcp && pnpm install
pnpm run check
```

```json
{
    "mcpServers": {
        "rewall": {
            "command": "node",
            "args": ["--env-file=.env", "--experimental-strip-types", "src/index.ts"],
            "cwd": "./mcp"
        }
    }
}
```

Hosted, over Streamable HTTP. `pnpm run serve` speaks it, and `mcp/Dockerfile` builds an image
that carries the SDK. The public one answers at `https://mcp.rewall.me/mcp`:

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

A hosted server holds no vault of its own. Every caller brings the identity their own agent was
granted and the process keeps none of them, so one instance serves many vaults without either seeing
the other. The seed must be an agent identity, minted with `pnpm run agent <vault.eth> <label>`, and
never a wallet derived one, which reads every secret ever shared with that wallet and cannot be
revoked. A seed is refused unless the request arrived over TLS.

Whoever runs a hosted instance can see a seed while it answers, which is the trade for installing
nothing, so grant an agent only what it needs. Running the same process yourself with `REWALL_NAME`
and `REWALL_IDENTITY_SEED` keeps the key on your own machine. `sign_with_secret` is off on a shared
instance unless `REWALL_SIGNING=1`, because its policy file is per deployment rather than per caller.
