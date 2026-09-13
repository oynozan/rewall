// Listing the names a wallet holds is the one place an empty answer could be mistaken for owning nothing

import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-resolve.mjs", import.meta.url));

const checks = [];
const pass = (message) => checks.push(message);

// The module reads its endpoint once at import, so each endpoint needs its own copy of it
let copies = 0;
async function withEndpoint(url) {
    if (url === null) delete process.env.NEXT_PUBLIC_SEPOLIA_LOGS_RPC_URL;
    else process.env.NEXT_PUBLIC_SEPOLIA_LOGS_RPC_URL = url;
    return import(`../src/lib/account.ts?copy=${copies++}`);
}

/* The real chain, where these three wallets hold exactly the names CLAUDE.md says they do */

const configured = process.env.NEXT_PUBLIC_SEPOLIA_LOGS_RPC_URL;
assert.ok(configured, "no logs endpoint is configured, so this check cannot prove anything");

const live = await withEndpoint(configured);
const started = Date.now();
const owner = await live.ownedNames("0xD2F84D1fD5c7E322D2264c41F7a438393a50b231");
assert.deepEqual(owner, ["rewall-test-1.eth", "rewall.eth"], "the owner wallet holds the project name and its own");
pass(`the owner wallet lists ${owner.join(" and ")} in ${Date.now() - started}ms`);

const grantee = await live.ownedNames("0x1d494e7FdB3a6b4161400B7143EA97a68314C040");
assert.deepEqual(grantee, ["rewall-test-2.eth"], "the grantee wallet holds one name");
pass("the grantee wallet lists only its own name");

// The stranger at index 2 holds no name at all, which has to read as an empty list rather than a failure
const stranger = await live.ownedNames("0x0000000000000000000000000000000000000001");
assert.deepEqual(stranger, [], "a wallet holding nothing lists nothing");
pass("a wallet holding no name comes back empty");

/* An endpoint that cannot answer must leave the panel as it was, never throw into it */

const dead = await withEndpoint("http://127.0.0.1:9/unreachable");
assert.deepEqual(await dead.ownedNames("0xD2F84D1fD5c7E322D2264c41F7a438393a50b231"), []);
pass("an unreachable endpoint returns an empty list instead of throwing");

/* A dead endpoint in front of a live one must be stepped over rather than believed */

const chained = await withEndpoint(`http://127.0.0.1:9/unreachable,${configured}`);
assert.deepEqual(await chained.ownedNames("0xD2F84D1fD5c7E322D2264c41F7a438393a50b231"), [
    "rewall-test-1.eth",
    "rewall.eth",
]);
pass("a failed endpoint falls through to the next one in the list");

const unset = await withEndpoint(null);
assert.deepEqual(await unset.ownedNames("0xD2F84D1fD5c7E322D2264c41F7a438393a50b231"), []);
assert.deepEqual(await unset.ownedNames(""), []);
pass("no endpoint at all returns an empty list instead of throwing");

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
