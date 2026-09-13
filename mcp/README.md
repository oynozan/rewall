# @rewall/mcp

An MCP server that lets an AI agent **use** a secret without the model ever reading it. SPEC section 7.

The agent asks for a request to be sent. This process decrypts the secret, attaches it, sends it, and
returns the response with the secret redacted. The value never enters the model's context, so it
never lands in a transcript, a log, or a context window that gets shipped somewhere else.

## What it does not protect

Stated first, because the name invites the wrong assumption.

**This defends the model boundary, not the machine.** Anyone who can run code as this user can read
the seed out of the process and decrypt every secret granted to it. That is not a bug in this server,
it is the same exposure SPEC section 6 already concedes for `rewall run` and section 8 for the
extension.

What that seed cannot do is worth saying, because it bounds the damage. The host holds the 32-byte
X25519 scalar and no wallet key, so a compromised host can read what was granted to this name and
nothing else. It cannot sign, spend gas, register or rewrite ENS records, or forge the authorization
a rotation rebuilds its grantee list from.

What it does defend against is real and worth having: prompt injection steering a credential
somewhere it should not go, a transcript or log capturing a key, and an agent that reads a secret
once and then holds it in context forever.

Two more limits, both inherited from the protocol:

- **Revocation is forward only.** Revoking a grant stops future reads. The old wrap and the old blob
  are on chain permanently, so a host that held the key can decrypt that version from an archive node
  forever. SPEC section 3.
- **`rewall.allow` is not signed.** It sits outside `rewall.auth.sig`, so a write delegate can widen
  it and no reader can tell. That is why it is the owner's _intent_ rather than a control against a
  hostile host, and why a local policy should be intersected with it on any host you do not own.

## Setup

```bash
cp .env.example .env       # REWALL_NAME, then pnpm run seed to fill REWALL_IDENTITY_SEED
cd ../sdk && pnpm run build
cd ../mcp && pnpm install
pnpm run check
```

Register it with an MCP client, for example `.mcp.json`:

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

## Hosting it, so nobody has to clone anything

`pnpm run serve` speaks MCP over Streamable HTTP instead of stdio. **A hosted server holds no vault
of its own.** Every caller brings the identity their own agent was granted, in two headers, and the
process keeps none of them. A request builds a vault, answers, and drops it.

```json
{
    "mcpServers": {
        "rewall": {
            "type": "http",
            "url": "https://mcp.rewall.me/mcp",
            "headers": { "X-Rewall-Vault": "alice.eth", "X-Rewall-Seed": "<the agent's seed>" }
        }
    }
}
```

### The seed you send is not your wallet identity

This distinction is the whole design, so it is worth being blunt about. Your wallet identity reads
every secret ever shared with you and can never be revoked, so it must never leave your machine. An
**agent identity** is a fresh 32 byte scalar with an ENS name of its own. It reads only what you
granted that one name, and you take it back by rotating those secrets.

`pnpm run agent` mints one. It needs the wallet that owns the vault, so run it where that wallet is.
Put `REWALL_OWNER_KEY` or `REWALL_OWNER_MNEMONIC` in `.env` rather than on the command line, where it
would land in shell history.

```bash
pnpm run agent alice.eth ci
```

That publishes `ci.alice.eth` with a key nothing else holds and writes `agent-ci.mcp.json` beside the
script, owner readable only and gitignored. It refuses a name that already publishes a key, since
replacing one strands every secret already granted to it. Grant it what it needs and nothing more:

```ts
await rewall.grant("openai.rewall.alice.eth", "ci.alice.eth");
```

### What the operator of a hosted instance can see

A seed sits in the server's memory for the length of a request, so whoever runs that server could
read the secrets granted to the agent it belongs to. That is the trade for installing nothing, and it
is exactly why the credential is scoped to one agent and revocable by rotation. Two things follow:

- Grant an agent only what that agent needs. The blast radius is whatever you granted its name.
- Revoking stops future reads. It does not unsee what the agent already read, and the old value stays
  in chain history, so rotate the credential at its provider too.
- If you will not take that trade, run this same process yourself. Set `REWALL_NAME` and
  `REWALL_IDENTITY_SEED`, send no headers, and the key never leaves your machine.

A seed is refused unless the request arrived over TLS. With `REWALL_TRUST_PROXY=1` that is what the
proxy says in `X-Forwarded-Proto`, and without it the peer has to be loopback, so an exposed server
with no proxy in front never accepts one. The environment vault answers a caller who sends no headers
only from loopback, or when `REWALL_SHARED_VAULT=1` says so outright, so a public deployment never
hands a stranger the operator's own vault by accident.

`sign_with_secret` is **never offered to a caller who brought their own identity**, whatever
`REWALL_SIGNING` says. Signing is bounded by `policy.json`, which names tokens, recipients and a cap
per secret label, and that file belongs to the deployment rather than to the caller, so a shared
instance cannot bound one honestly. It is offered locally, where the same person owns the policy and
the key, and a secret with no entry in that file still cannot sign at all. `REWALL_RPM` requests a
minute are counted per identity and `REWALL_PEER_RPM` per peer address, so neither a busy agent nor a
caller minting fresh identities can spend anyone else's budget.

### Deploying

The server binds `127.0.0.1:8787` by default, which is correct behind a proxy. `nginx.conf` in this
folder is a working reverse proxy for `mcp.rewall.me`. Two of its settings are not optional:
`X-Forwarded-Proto`, which is how the server knows the request arrived over TLS and without which
every credential is refused, and `proxy_buffering off`, without which a streamed response never
arrives.

```bash
sudo cp mcp/nginx.conf /etc/nginx/sites-available/mcp.rewall.me
sudo ln -s /etc/nginx/sites-available/mcp.rewall.me /etc/nginx/sites-enabled/
sudo certbot --nginx -d mcp.rewall.me
sudo nginx -t && sudo systemctl reload nginx
```

Run the server itself under systemd, or with the image `mcp/Dockerfile` builds from the repo root.
`REWALL_TRUST_PROXY=1` is what lets the server believe the proxy about TLS, and the publish flag is
what keeps the container's port on the host's loopback where only nginx can reach it.

```bash
docker build -f mcp/Dockerfile -t rewall-mcp .
docker run -p 127.0.0.1:8787:8787 \
  -e REWALL_TRUST_PROXY=1 \
  -e REWALL_ALLOWED_HOSTS=mcp.rewall.me \
  rewall-mcp
```

`GET /` says what the server is and which headers it wants, so a person who opens the URL in a
browser sees something useful. Check a deployment two ways:

```bash
REWALL_MCP_URL=https://mcp.rewall.me/mcp pnpm run check:tenants   # two vaults, one process
REWALL_MCP_URL=https://mcp.rewall.me/mcp pnpm run check:http      # the tools themselves
```

## Tools

| Tool               | What the model gets back                                                       |
| ------------------ | ------------------------------------------------------------------------------ |
| `list_secrets`     | Label, type, allowed hosts, and whether this agent holds a key. Metadata only. |
| `http_with_secret` | The response, redacted. Never the secret.                                      |
| `otp_code`         | Six digits and the seconds left. Never the seed.                               |
| `sign_with_secret` | A signed ERC-20 transfer, unbroadcast. Never the key.                          |

## Signing

`sign_with_secret` exists because an agent that holds a treasury key but can do nothing with it is
half a feature. It is also the most dangerous tool here, so the model chooses parameters and the tool
chooses structure.

The model may name a token, a recipient and an amount. It may not supply calldata, a message, typed
data, or a hash. The transfer calldata is built by `sign.ts`, so `approve`, `setApprovalForAll` and
`permit` are unreachable rather than denied. Each secret needs an entry in `policy.json` naming its
chain, its allowed tokens, its allowed recipients and a cap, and a secret with no entry cannot sign at
all. Nothing is broadcast.

**The reason there is no general signing tool.** `identity.ts` derives the X25519 key from the
signature over `IDENTITY_TYPED_DATA`. A tool that signs a payload the model chose would be asked for
that payload, and would hand over the identity of the wallet, permanently, across every secret ever
shared with it, archived blobs included. The same applies to the `Rewall authorization v1` prefix in
`authorization.ts`, which would let a model forge the grantee list a rotation rebuilds from. Neither
is reachable here, because no free-form signing path exists. The server also refuses to sign with the
key backing its own identity.

## How a request is refused

`http_with_secret` fails closed at every branch, in this order, before anything is decrypted:

- not parseable as a URL, or not `https:`
- a username or password in the URL, because `https://api.openai.com@evil.com/` has hostname
  `evil.com` and any substring match walks straight into it
- a non-default port
- an IP literal, which catches `169.254.169.254` and its decimal and hex spellings
- **an empty or absent `rewall.allow`**, which means deny every host. An empty record is
  indistinguishable from one that was never written, so the only safe reading of both is no
- a hostname not exactly in the list. No wildcards, no suffix matching
- a secret whose type is `privkey`, `totp` or `seed`
- more than 30 calls a minute for one secret

Redirects are never followed. A 307 or 308 preserves the method and body, so following one would
replay a secret-bearing request at a host nobody allowed.

## Redaction

The response is scanned for the secret in every shape it could come back as: raw, base64 in four
variants, hex in four, percent-encoded, and JSON-escaped. Anything outside a small content-type
allowlist comes back as status and length only, because a substring scan over a binary body proves
nothing.

**Redaction is an alarm, not a repair.** A host echoing your credential is either misconfigured or
probing you, so a redaction is counted and the third one disables that secret for the session.

Where it cannot work, and the README says so rather than pretending: a server that transforms the
secret (a masked form, a key id, an HMAC with its own salt), a response that _is_ a credential, or an
adversarial allowlisted endpoint returning the value split across two headers. The control is the
allowlist. Redaction is defence in depth behind it.

`pnpm run check:exfil` is the proof rather than the claim. It stores a secret allowed to reach an
endpoint that echoes request headers, checks that the endpoint really does echo it, then asks the
server for that exact request and asserts the value never reaches the caller. It then tries every
other route a model has: listing, a host outside the allowlist, plain http, the wrong tool for the
type, and a secret that does not exist. Nothing carries a value or a fragment of one.

## Not built yet

- More signing kinds. Only ERC-20 transfer is built today. Each new kind is a new builder in
  `sign.ts`, never a widening of what the model may pass.
- A live `otp_code`. The tool and its type gate are in, but no `totp` secret exists on chain yet, so
  `pnpm run check` says the live path is unproven rather than quietly skipping it.
