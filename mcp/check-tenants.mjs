/*
 * Proves a hosted server holds no vault of its own, against a real one over Streamable HTTP
 *
 * Two callers connect to the same process with their own identities and each is answered with their
 * own vault. A caller that sends nothing is refused, and a seed that is not one is refused too.
 */

import assert from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { identityFromSeed, toBase64 } from "@rewall/sdk";

const URL_ = process.env.REWALL_MCP_URL || "http://127.0.0.1:8787/mcp";

const pass = (what) => console.log(`  ok  ${what}`);
const textOf = (result) => result.content.map((part) => part.text ?? "").join("\n");

// Thrown away with the run, because pointing this at a deployment sends whatever it holds to its operator
async function throwaway() {
    const identity = await identityFromSeed(crypto.getRandomValues(new Uint8Array(32)));
    return { seed: toBase64(identity.secretKey), fingerprint: identity.fingerprint };
}

async function connect(headers) {
    const client = new Client({ name: "rewall-tenant-check", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers } }));
    return client;
}

const alice = await throwaway();
const bob = await throwaway();

/* Each caller is answered as themselves */

const asAlice = await connect({ "X-Rewall-Vault": "rewall-test-1.eth", "X-Rewall-Seed": alice.seed });
const aliceList = textOf(await asAlice.callTool({ name: "list_secrets", arguments: {} }));
assert.ok(aliceList.includes("rewall-test-1.eth"), "the first caller is answered with their own vault");
assert.ok(aliceList.includes(alice.fingerprint), `the first caller acts as ${alice.fingerprint}`);
pass(`rewall-test-1.eth answered as ${alice.fingerprint}`);

const asBob = await connect({ "X-Rewall-Vault": "rewall-test-2.eth", "X-Rewall-Seed": bob.seed });
const bobList = textOf(await asBob.callTool({ name: "list_secrets", arguments: {} }));
assert.ok(bobList.includes("rewall-test-2.eth"), "the second caller is answered with their own vault");
assert.ok(bobList.includes(bob.fingerprint), `the second caller acts as ${bob.fingerprint}`);
pass(`rewall-test-2.eth answered as ${bob.fingerprint} on the same process`);

assert.notStrictEqual(alice.fingerprint, bob.fingerprint, "the two callers are different identities");
assert.ok(!bobList.includes(alice.fingerprint), "the second caller is never told the first one's identity");
pass("neither caller sees the other's vault or fingerprint");

/* What the server refuses */

const refused = async (headers, what) => {
    const response = await fetch(URL_, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.ok(response.status >= 400, `${what} is refused, got ${response.status}`);
    const body = await response.text();
    assert.ok(!body.includes(alice.seed), "a refusal never quotes back what was sent");
    pass(`${what} is refused with ${response.status}`);
};

await refused({}, "a caller that sends no identity");
await refused({ "X-Rewall-Vault": "rewall-test-1.eth" }, "a vault with no seed");
await refused({ "X-Rewall-Vault": "rewall-test-1.eth", "X-Rewall-Seed": "not-a-seed" }, "a seed that is not 32 bytes");

/* Nothing about a caller outlives the request */

const health = await (await fetch(URL_.replace(/\/mcp$/, "/"))).json();
assert.strictEqual(health.vaults, "per caller", "the server says it holds one vault per caller");
const named = JSON.stringify(health).match(/[a-z0-9-]+\.eth/);
assert.strictEqual(named, null, `the health page names a vault, ${named?.[0]}`);
pass("the health page names no vault, because which one an operator runs is nobody's business");

await asAlice.close();
await asBob.close();
console.log("\nall good, one process served two vaults and kept neither");
