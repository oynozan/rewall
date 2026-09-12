// Checks the sponsored endpoints refuse strangers, since both of them spend project funds

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { getAddress } from "viem";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
// Fresh every run, because any fixed address stops being new the first time someone onboards with it
const SOMEONE = getAddress(`0x${randomBytes(20).toString("hex")}`);

const checks = [];
const pass = (message) => checks.push(message);

const get = async (path) => {
    const response = await fetch(`${baseURL}${path}`);
    return { status: response.status, body: await response.json().catch(() => ({})) };
};
const post = async (path, body, headers = {}) => {
    const response = await fetch(`${baseURL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
};

/* A wallet nobody has seen reads as new rather than as an error */

const unknown = await get(`/api/account?address=${SOMEONE}`);
assert.equal(unknown.status, 200);
assert.equal(unknown.body.seen, false, "An unseen wallet must read as new");
assert.equal(unknown.body.completed, false);
pass("an unknown wallet is reported as new, which is what opens the wizard");

const malformed = await get("/api/account?address=not-an-address");
assert.equal(malformed.status, 400, "A malformed address must be refused");
pass("a malformed address is refused rather than looked up");

/* Neither money endpoint moves anything without a verified Privy session */

for (const [path, body] of [
    ["/api/faucet", { address: SOMEONE }],
    [
        "/api/provision",
        { phase: "start", address: SOMEONE, label: "someclaim", publicKey: "a", recoveryPublicKey: "b" },
    ],
]) {
    const anonymous = await post(path, body);
    assert.equal(anonymous.status, 401, `${path} must refuse an unauthenticated caller`);

    const forged = await post(path, body, { authorization: "Bearer not-a-real-token" });
    assert.equal(forged.status, 401, `${path} must refuse a forged token`);
}
pass("the faucet and the provisioner both refuse an anonymous caller and a forged token");

/* Input is checked before any key is touched */

const short = await post("/api/provision", { phase: "start", address: SOMEONE, label: "ab" });
assert.equal(short.status, 400);
assert.match(short.body.error, /5 or more/, "A short label must be explained, not thrown");

const badAddress = await post("/api/faucet", { address: "0xnope" });
assert.equal(badAddress.status, 400);
pass("a short label and a bad address are refused with a sentence before any signing happens");

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
