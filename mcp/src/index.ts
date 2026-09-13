/*
 * Local entry point, spoken over stdio by an MCP client that launches this process
 * The tools live in tools.ts, shared with the networked entry point in http.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { credentialsFromEnv, openVault } from "./vault.ts";
import { assertSafeEnvironment, register, INSTRUCTIONS } from "./tools.ts";

async function main() {
    assertSafeEnvironment();
    const vault = openVault(await credentialsFromEnv());

    const server = new McpServer({ name: "rewall", version: "0.1.0" }, { instructions: INSTRUCTIONS });
    // Offered here because policy.json is the real gate and a secret with no entry cannot sign at all
    register(server, vault, { signing: true });

    // stdout is the JSON-RPC channel, so every human readable line goes to stderr
    process.stderr.write(`rewall mcp ready, ${vault.name} as ${vault.fingerprint}\n`);
    await server.connect(new StdioServerTransport());
}

main().catch((error) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
});
