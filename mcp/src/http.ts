/*
 * Networked entry point, so anyone can point an MCP client at a URL instead of cloning this repo
 *
 * Every caller brings the identity their own agent was granted, in a header, and this process keeps
 * none of them. A request builds a vault, answers, wipes the scalar and drops it, so two callers can
 * never share one. The seed a caller sends is an agent identity, not the wallet identity that granted
 * it, so what it reaches is the set of secrets its owner granted to that one name and nothing else.
 *
 * The operator of a hosted instance does see a seed in memory for the length of a request. That is
 * the trade for installing nothing, and it is why the credential is scoped and rotatable. Anyone who
 * will not take that trade runs this same process themselves and sends no header at all.
 */

import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { wipe } from "@rewall/sdk";
import { credentialsFromEnv, credentialsFromSeed, openVault, type Credentials } from "./vault.ts";
import { assertSafeEnvironment, register, INSTRUCTIONS } from "./tools.ts";

const PORT = Number(process.env.PORT || 8787);
const PATH = process.env.REWALL_MCP_PATH || "/mcp";

// Loopback by default, since a seed arriving in a header has to cross TLS the proxy terminates
const HOST = process.env.REWALL_MCP_HOST || "127.0.0.1";

// A proxy's headers mean nothing unless a proxy is in front, since any caller can send the same bytes
const TRUST_PROXY = process.env.REWALL_TRUST_PROXY === "1";

// Answering a caller who sent no credential as the operator is a decision, never an inference
const SHARED = process.env.REWALL_SHARED_VAULT === "1";

// The policy that bounds signing belongs to the deployment, not to whoever connected
const SIGNING = process.env.REWALL_SIGNING === "1";

// A fingerprint costs nothing to mint, so the peer has to carry a budget of its own
const REQUESTS_PER_MINUTE = Number(process.env.REWALL_RPM || 120);
const PEER_PER_MINUTE = Number(process.env.REWALL_PEER_RPM || 240);

// Named hosts stop a page in someone's browser rebinding a name to this server and driving it as them
const ALLOWED_HOSTS = (process.env.REWALL_ALLOWED_HOSTS ?? `127.0.0.1:${PORT},localhost:${PORT}`)
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

const VAULT_HEADER = "x-rewall-vault";
const SEED_HEADER = "x-rewall-seed";

// Bounded, because every key here is reachable by a stranger and an unbounded map ends the process
function budget(limit: number, cap = 4096) {
    const seen = new Map<string, number[]>();
    return (key: string): boolean => {
        const now = Date.now();
        const recent = (seen.get(key) ?? []).filter((at) => now - at < 60_000);
        if (recent.length >= limit) return true;
        recent.push(now);
        seen.delete(key);
        seen.set(key, recent);
        if (seen.size > cap) seen.delete(seen.keys().next().value as string);
        return false;
    };
}

const perIdentity = budget(REQUESTS_PER_MINUTE);
const perPeer = budget(PEER_PER_MINUTE);

const header = (request: IncomingMessage, name: string): string => {
    const value = request.headers[name];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
};

const isLoopback = (request: IncomingMessage): boolean => {
    const remote = request.socket.remoteAddress ?? "";
    return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
};

// The nearest proxy owns the last element, everything before it is what the caller wrote
const nearest = (value: string): string => {
    const parts = value.split(",");
    return parts[parts.length - 1]?.trim() ?? "";
};

// Only a proxy can say a request crossed TLS, and with none in front the socket is the honest answer
function overTls(request: IncomingMessage): boolean {
    if (TRUST_PROXY) return nearest(header(request, "x-forwarded-proto")).toLowerCase() === "https";
    return isLoopback(request);
}

// Behind a proxy every peer is the proxy, so the forwarded address is what separates two callers
const peerOf = (request: IncomingMessage): string =>
    (TRUST_PROXY ? nearest(header(request, "x-forwarded-for")) : "") || (request.socket.remoteAddress ?? "unknown");

const json = (response: import("node:http").ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
};

async function main() {
    assertSafeEnvironment();

    // Absent on a shared instance, and never reached by a proxied caller even when it is present
    const fallback: Credentials | null = process.env.REWALL_NAME ? await credentialsFromEnv() : null;

    const http = createServer(async (request, response) => {
        // Split rather than parsed, because new URL throws on a caller controlled Host and stops the process
        const path = (request.url ?? "/").split(/[?#]/)[0] || "/";

        if (perPeer(peerOf(request))) return json(response, 429, { error: "too many requests, try again shortly" });

        // Names no vault, because which one an operator runs is not a stranger's business
        if (path === "/" || path === "/health") {
            return json(response, 200, {
                name: "rewall",
                mcp: PATH,
                vaults: "per caller",
                headers: { vault: "X-Rewall-Vault", seed: "X-Rewall-Seed" },
                signing: SIGNING,
                docs: "https://docs.rewall.me/components/mcp",
            });
        }

        if (path !== PATH) return json(response, 404, { error: "not found" });

        const seed = header(request, SEED_HEADER);
        const name = header(request, VAULT_HEADER);
        let credentials: Credentials;
        let borrowed = false;

        if (seed || name) {
            if (!seed || !name) {
                return json(response, 400, { error: `send both ${VAULT_HEADER} and ${SEED_HEADER}` });
            }
            if (!overTls(request)) {
                return json(response, 400, { error: "an identity seed only travels over https" });
            }
            try {
                credentials = await credentialsFromSeed(name, seed);
            } catch {
                // Fixed text, because the thrown message can quote what was sent
                return json(response, 400, { error: `${SEED_HEADER} is not 32 bytes of standard base64` });
            }
        } else if (fallback && (SHARED || (!TRUST_PROXY && isLoopback(request)))) {
            credentials = fallback;
            borrowed = true;
        } else {
            return json(response, 401, {
                error: `this server holds no vault of its own, send ${VAULT_HEADER} and ${SEED_HEADER}`,
            });
        }

        if (perIdentity(credentials.identity.fingerprint)) {
            if (!borrowed) await wipe(credentials.identity.secretKey);
            return json(response, 429, { error: "too many requests, try again shortly" });
        }

        // Built per request and dropped with it, so nothing about one caller outlives their own call
        const vault = openVault(credentials);

        // Stateless, so nothing is remembered between calls and any instance can answer any request
        const server = new McpServer({ name: "rewall", version: "0.1.0" }, { instructions: INSTRUCTIONS });
        // Never offered to a caller who brought an identity, since the policy names secrets by label
        register(server, vault, { signing: SIGNING && borrowed });

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            allowedHosts: ALLOWED_HOSTS,
            enableDnsRebindingProtection: true,
        });
        response.on("close", () => {
            void transport.close();
            void server.close();
            // The borrowed one is reused by the next caller, so zeroing it would break the process
            if (!borrowed) void wipe(credentials.identity.secretKey);
        });

        try {
            await server.connect(transport);
            await transport.handleRequest(request, response);
        } catch (error) {
            if (!response.headersSent) json(response, 500, { error: (error as Error).message });
        }
    });

    http.listen(PORT, HOST, () => {
        // Nothing about a caller is ever logged, so the lines here describe the process and no identity
        process.stderr.write(`rewall mcp on ${HOST}:${PORT}${PATH}, one vault per caller\n`);
        process.stderr.write(
            `hosts ${ALLOWED_HOSTS.join(", ")}, proxy headers ${TRUST_PROXY ? "trusted" : "ignored"}\n`,
        );
        if (fallback && SHARED) {
            process.stderr.write(
                `REWALL_SHARED_VAULT is on, so any caller sending no header acts as ${fallback.name}\n`,
            );
        } else if (fallback) {
            process.stderr.write("a loopback caller sending no header gets the vault in the environment\n");
        }
        process.stderr.write(`signing ${SIGNING ? "enabled for the shared vault" : "disabled"}\n`);
    });
}

main().catch((error) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
});
