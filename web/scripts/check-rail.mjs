// Checks the proxy carries a signed request to the rail untouched and refuses anything outside the five

import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Transfers } from "@rewall/sdk";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const vault = process.env.NEXT_PUBLIC_REWALL_VAULT;
if (!vault) throw new Error("NEXT_PUBLIC_REWALL_VAULT is not set, run pnpm run deploy in rail and paste it in");

const checks = [];
const pass = (message) => checks.push(message);

const post = (path, body) =>
    fetch(`${baseURL}/api/rail/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });

/* A real signature crosses the proxy and the rail's answer comes back */

// A key nobody has used, so an empty ledger is the honest answer rather than a leftover balance
const account = privateKeyToAccount(generatePrivateKey());
const transfers = new Transfers({ account, api: `${baseURL}/api/rail`, vault });

const balances = await transfers.balances().catch((failure) => {
    throw new Error(`the proxy did not reach the rail, check pnpm run serve in rail, ${failure.message}`);
});
assert.deepEqual(balances, [], "A wallet that never deposited must come back with no rows");
pass("a signed request crosses the proxy and the rail's answer comes back");

/* The rail's own refusal keeps its status and its wording */

const forged = await post("balances", {
    account: account.address,
    timestamp: Math.floor(Date.now() / 1000),
    auth: `0x${"11".repeat(65)}`,
});
assert.equal(forged.status, 401, "A bad signature must arrive as the rail's own 401");
const refusal = await forged.json();
assert.equal(refusal.error, "request authentication failed", "The rail's wording must survive the hop");
assert.ok(refusal.request_id, "A rail error carries a request_id, which is what marks it as the rail's");
pass("an upstream 401 is relayed with its status, its wording and its request_id unchanged");

/* Anything outside the five is refused before a socket is opened */

for (const path of ["rail.db", "admin", "balances/all", ""]) {
    const refused = await post(path, {});
    assert.equal(refused.status, 404, `/api/rail/${path} must be refused`);
    assert.ok(
        (refused.headers.get("content-type") || "").includes("application/json"),
        "A refusal must be JSON, so the SDK reads it as an error rather than failing to parse",
    );
    assert.equal((await refused.json()).request_id, undefined, "A proxy refusal must not look like a rail answer");
}
pass("a path outside the five is refused as JSON without reaching the rail");

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
