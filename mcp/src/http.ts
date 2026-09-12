/*
 * Networked entry point, so anyone can point an MCP client at a URL instead of cloning this repo
 *
 * A hosted server holds the seed that opens its vault, so everyone who connects shares one identity
 * and can use every secret granted to it. That is fine for a demo vault of throwaway credentials and
 * wrong for anything else, which is why signing is off unless REWALL_SIGNING is set
 */

import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { openVault, type Vault } from "./vault.ts";
import { assertSafeEnvironment, register, INSTRUCTIONS } from "./tools.ts";

const PORT = Number(process.env.PORT || 8787);
const PATH = process.env.REWALL_MCP_PATH || "/mcp";

// Signing from a shared identity means a stranger spending the vault owner's key, so it stays off
const SIGNING = process.env.REWALL_SIGNING === "1";

// One shared budget on top of the per secret limits, because every caller is the same identity here
const REQUESTS_PER_MINUTE = Number(process.env.REWALL_RPM || 120);
const recent: number[] = [];

function overBudget(): boolean {
    const now = Date.now();
    while (recent.length && now - recent[0]! > 60_000) recent.shift();
    if (recent.length >= REQUESTS_PER_MINUTE) return true;
    recent.push(now);
    return false;
}

const json = (response: import("node:http").ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
};

async function main() {
    assertSafeEnvironment();
    const vault: Vault = await openVault();

    const http = createServer(async (request, response) => {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

        // Something for a person who opens the URL in a browser and finds JSON-RPC
        if (url.pathname === "/" || url.pathname === "/health") {
            return json(response, 200, {
                name: "rewall",
                vault: vault.name,
                fingerprint: vault.fingerprint,
                mcp: PATH,
                signing: SIGNING,
                docs: "https://github.com/oynozan/rewall/tree/main/mcp",
            });
        }

        if (url.pathname !== PATH) return json(response, 404, { error: "not found" });
        if (overBudget()) return json(response, 429, { error: "too many requests, try again shortly" });

        // Stateless, so nothing is remembered between calls and any instance can answer any request
        const server = new McpServer({ name: "rewall", version: "0.1.0" }, { instructions: INSTRUCTIONS });
        register(server, vault, { signing: SIGNING });

        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        response.on("close", () => {
            void transport.close();
            void server.close();
        });

        try {
            await server.connect(transport);
            await transport.handleRequest(request, response);
        } catch (error) {
            if (!response.headersSent) json(response, 500, { error: (error as Error).message });
        }
    });

    http.listen(PORT, () => {
        process.stderr.write(`rewall mcp on :${PORT}${PATH}, vault ${vault.name} as ${vault.fingerprint}\n`);
        process.stderr.write(`signing ${SIGNING ? "enabled" : "disabled"}, ${REQUESTS_PER_MINUTE} requests a minute\n`);
    });
}

main().catch((error) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
});
