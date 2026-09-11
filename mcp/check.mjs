/*
 * Drives the server the way a real MCP client does, over stdio, against real Sepolia
 * The load bearing assertion is the last one, that no plaintext secret appears in any tool result
 */

import assert from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Rewall, identityFromAccount } from "@rewall/sdk";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const UR = "0x4a1817d13e9cf196f471725176355c1234b63c70";
const NAME = process.env.REWALL_NAME;
const pass = (what) => console.log(`  ok  ${what}`);
const textOf = (result) => result.content.map((part) => part.text ?? "").join("\n");

const transport = new StdioClientTransport({
    command: "node",
    args: ["--env-file=.env", "--experimental-strip-types", "src/index.ts"],
    stderr: "pipe",
});
const client = new Client({ name: "rewall-check", version: "0.1.0" });
await client.connect(transport);

const seen = [];

try {
    /* The surface */

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert.deepStrictEqual(names, ["http_with_secret", "list_secrets"]);
    pass(`server exposes ${names.join(", ")}`);

    /* Listing is metadata only */

    const listed = await client.callTool({ name: "list_secrets", arguments: {} });
    const listing = textOf(listed);
    seen.push(listing);
    assert.ok(listing.includes("openai"), "the live vault lists its secrets");
    assert.ok(/type=\w+/.test(listing), "each row carries a type");
    pass(`list_secrets returned ${listing.split("\n").length - 2} rows of metadata`);

    /* The allowlist refuses before anything is decrypted */

    const offList = await client.callTool({
        name: "http_with_secret",
        arguments: { secret: "openai", url: "https://evil.example.com/v1/models" },
    });
    seen.push(textOf(offList));
    assert.ok(offList.isError, "a host outside rewall.allow is refused");
    assert.ok(textOf(offList).includes("not in this secret's allowed hosts"));
    pass("a host outside rewall.allow is refused");

    const plain = await client.callTool({
        name: "http_with_secret",
        arguments: { secret: "openai", url: "http://api.openai.com/v1/models" },
    });
    seen.push(textOf(plain));
    assert.ok(plain.isError && textOf(plain).includes("only https"), "http is refused");
    pass("plain http is refused");

    const literal = await client.callTool({
        name: "http_with_secret",
        arguments: { secret: "openai", url: "https://169.254.169.254/latest/meta-data" },
    });
    seen.push(textOf(literal));
    assert.ok(literal.isError, "the cloud metadata address is refused");
    pass("an IP literal is refused");

    /* A real call to the one host the secret actually allows */

    const real = await client.callTool({
        name: "http_with_secret",
        arguments: { secret: "openai", url: "https://api.openai.com/v1/models" },
    });
    const body = textOf(real);
    seen.push(body);
    assert.ok(/from api\.openai\.com/.test(body), "the allowed host was reached");
    pass(`api.openai.com answered, ${body.split("\n")[0]}`);

    /* The property the whole server exists for */

    const account = privateKeyToAccount(process.env.REWALL_AGENT_KEY);
    const identity = await identityFromAccount(account);
    const rewall = new Rewall({
        publicClient: createPublicClient({ chain: sepolia, transport: http(undefined, { batch: true }) }),
        name: NAME,
        universalResolver: UR,
        identity,
    });
    const secret = new TextDecoder().decode(await rewall.get(`openai.rewall.${NAME}`));
    assert.ok(secret.length >= 8, "the check is comparing against a real value");

    for (const [index, result] of seen.entries()) {
        assert.ok(!result.includes(secret), `tool result ${index} leaked the secret`);
    }
    pass(`no plaintext in any of ${seen.length} tool results`);
} finally {
    await client.close();
}

console.log("\ncheck.mjs ok");
