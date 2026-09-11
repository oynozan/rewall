# @rewall/mcp

An MCP server that lets an AI agent **use** a secret without the model ever reading it. SPEC section 7.

The agent asks for a request to be sent. This process decrypts the secret, attaches it, sends it, and
returns the response with the secret redacted. The value never enters the model's context, so it
never lands in a transcript, a log, or a context window that gets shipped somewhere else.

## What it does not protect

Stated first, because the name invites the wrong assumption.

**This defends the model boundary, not the machine.** Anyone who can run code as this user can read
the key out of the process and decrypt every secret granted to it. That is not a bug in this server,
it is the same exposure SPEC section 6 already concedes for `rewall run` and section 8 for the
extension.

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
cp .env.example .env       # REWALL_NAME and REWALL_AGENT_KEY
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

## Tools

| Tool               | What the model gets back                                                       |
| ------------------ | ------------------------------------------------------------------------------ |
| `list_secrets`     | Label, type, allowed hosts, and whether this agent holds a key. Metadata only. |
| `http_with_secret` | The response, redacted. Never the secret.                                      |
| `otp_code`         | Six digits and the seconds left. Never the seed.                               |

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

## Not built yet

- `sign_with_secret`. Deliberately absent. `identity.ts` derives the X25519 key from the signature
  over `IDENTITY_TYPED_DATA`, so a tool that signs a model-chosen payload hands over the whole
  identity in one call, permanently and unrevocably. It ships only as one structured payload kind the
  tool builds itself, with the Rewall identity and authorization payloads hard-denied.
- A live `otp_code`. The tool and its type gate are in, but no `totp` secret exists on chain yet, so
  `pnpm run check` says the live path is unproven rather than quietly skipping it.
- Seed-only provisioning. The host should hold the 32-byte X25519 seed and no Ethereum key, which
  collapses its capability to _decrypt what was granted to it_. Needs an SDK constructor that takes
  the scalar directly.
