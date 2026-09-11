/*
 * Rewall MCP server, SPEC section 7
 * An agent can use a secret without the model ever reading it, because the value is attached to a
 * request inside this process and redacted out of the response before anything is returned
 * The boundary this defends is the model, not the machine, see README.md
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { wipe } from "@rewall/sdk";
import { openVault, type Vault } from "./vault.ts";
import { checkUrl, HostRefused } from "./allow.ts";
import { needlesFor, scrub } from "./scrub.ts";

const MAX_BODY = 256 * 1024;
const CALLS_PER_MINUTE = 30;
// A server echoing a credential back is a misconfiguration or an exfiltration attempt, and in
// neither case should the agent be allowed to keep trying
const REDACTION_LIMIT = 3;

// Anything else comes back as status and length only, because a substring scan over a binary body
// proves nothing and a redaction that silently fails is worse than no answer
const READABLE_TYPES = ["application/json", "text/plain", "text/html", "application/x-www-form-urlencoded"];

// Sending a key nobody can use is pointless, and these two are never bearer credentials
const NEVER_OVER_HTTP = ["privkey", "totp", "seed"];

const say = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

/* Guards that run once, before the server accepts anything */

function assertSafeEnvironment() {
    // A proxy sees every request whatever the allowlist says, and with its own CA it sees the value
    for (const key of ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]) {
        if (process.env[key]) throw new Error(`${key} is set, refusing to start, a proxy would see every secret`);
    }
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
        throw new Error("NODE_TLS_REJECT_UNAUTHORIZED is 0, refusing to start");
    }
}

/* Rate limiting, per secret rather than global so one busy secret cannot starve the rest */

const calls = new Map<string, number[]>();
const redactions = new Map<string, number>();

function rateLimit(label: string) {
    const now = Date.now();
    const recent = (calls.get(label) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= CALLS_PER_MINUTE) throw new Error(`rate limit reached for ${label}, wait a minute`);
    recent.push(now);
    calls.set(label, recent);
}

/* Tools */

function register(server: McpServer, vault: Vault) {
    server.registerTool(
        "list_secrets",
        {
            title: "List Rewall secrets",
            description:
                "Lists the secrets in this agent's Rewall vault with their type, allowed hosts and whether this agent can read them. Returns metadata only, never a value.",
            inputSchema: {},
        },
        async () => {
            const labels = await vault.list();
            const rows = await Promise.all(labels.map((label) => vault.metaOf(label)));
            const lines = rows.map((meta) => {
                const hosts = meta.allow.length ? meta.allow.join(" ") : "none set";
                const mine = meta.readable ? "readable" : "no access";
                return `${meta.label}  type=${meta.type}  hosts=${hosts}  ${mine}`;
            });
            return say(
                `${vault.name} holds ${rows.length} secrets, this agent is ${vault.fingerprint}\n\n${lines.join("\n")}`,
            );
        },
    );

    server.registerTool(
        "http_with_secret",
        {
            title: "Send a request authenticated with a secret",
            description:
                "Sends an HTTPS request with a Rewall secret attached as a bearer token, then returns the response with the secret redacted. The secret is never revealed. The host must appear in the secret's rewall.allow list.",
            inputSchema: {
                secret: z.string().describe("The secret's label, as shown by list_secrets"),
                url: z.string().describe("Full https URL. The host must be in the secret's allowed hosts"),
                method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
                body: z.string().optional().describe("Request body, sent as application/json"),
            },
        },
        async ({ secret, url, method, body }) => {
            try {
                rateLimit(secret);
                if ((redactions.get(secret) ?? 0) >= REDACTION_LIMIT) {
                    return fail(`${secret} is disabled for this session, a host kept echoing it back`);
                }

                const meta = await vault.metaOf(secret);
                if (!meta.readable) return fail(`this agent holds no key for ${secret}`);
                if (NEVER_OVER_HTTP.includes(meta.type)) {
                    return fail(`${secret} is a ${meta.type} and is never sent over HTTP`);
                }

                const host = checkUrl(url, meta.allow);

                const value = await vault.rewall.get(meta.name);
                // Built before the wipe, or the needles would be derived from zeroed bytes and
                // every redaction below would silently match nothing
                const needles = needlesFor(value);

                let response: Response;
                try {
                    // ponytail: bearer only, placement is deliberately not model controlled, a per
                    // secret placement policy goes here when a demo needs a header other than this
                    const text = new TextDecoder().decode(value);
                    response = await fetch(url, {
                        method,
                        redirect: "manual",
                        headers: {
                            authorization: `Bearer ${text}`,
                            ...(body ? { "content-type": "application/json" } : {}),
                        },
                        body,
                    });
                } finally {
                    await wipe(value);
                }

                if (response.status >= 300 && response.status < 400) {
                    return fail(
                        `${host} answered ${response.status} with a redirect, which is not followed because it could replay the secret at another host`,
                    );
                }

                const mime = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
                const head = scrub([...response.headers].map(([k, v]) => `${k}: ${v}`).join("\n"), needles);

                if (!READABLE_TYPES.includes(mime)) {
                    return say(`${response.status} from ${host}, ${mime || "unknown type"} body not returned`);
                }

                const raw = await response.text();
                if (raw.length > MAX_BODY) {
                    return say(`${response.status} from ${host}, body of ${raw.length} bytes is too large to redact`);
                }

                const cleaned = scrub(raw, needles);
                const total = cleaned.redactions + head.redactions;
                if (total) redactions.set(secret, (redactions.get(secret) ?? 0) + 1);

                const alarm = total ? `\n\n[${total} redactions, ${host} echoed the secret back]` : "";
                return say(`${response.status} from ${host}\n\n${cleaned.text}${alarm}`);
            } catch (error) {
                if (error instanceof HostRefused) return fail(error.message);
                return fail((error as Error).message);
            }
        },
    );
}

/* Boot */

async function main() {
    assertSafeEnvironment();
    const vault = await openVault();

    const server = new McpServer({ name: "rewall", version: "0.1.0" });
    register(server, vault);

    // stdout is the JSON-RPC channel, so every human readable line goes to stderr
    process.stderr.write(`rewall mcp ready, ${vault.name} as ${vault.fingerprint}\n`);
    await server.connect(new StdioServerTransport());
}

main().catch((error) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
});
