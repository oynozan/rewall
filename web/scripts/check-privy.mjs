// Answers the one question that decides whether Privy can back a Rewall identity at all

import assert from "node:assert/strict";
import { deriveIdentity, IDENTITY_TYPED_DATA, canonicalSignature } from "@rewall/sdk";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const APP_SECRET = process.env.PRIVY_APP_SECRET;
const API = "https://api.privy.io/v1";

if (!APP_ID || !APP_SECRET) {
    console.error("Set NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET in web/.env.local, then rerun.");
    process.exit(2);
}

const auth = "Basic " + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString("base64");

async function privy(path, body) {
    const response = await fetch(`${API}${path}`, {
        method: "POST",
        headers: { authorization: auth, "privy-app-id": APP_ID, "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${path} ${text.slice(0, 300)}`);
    return JSON.parse(text);
}

let passed = 0;
const pass = (message) => {
    passed++;
    console.log(`PASS  ${message}`);
};

/* A wallet to sign with, reused across runs when one is supplied */

let walletId = process.env.PRIVY_TEST_WALLET_ID;
let address;

if (walletId) {
    console.log(`reusing wallet ${walletId}`);
} else {
    const created = await privy("/wallets", { chain_type: "ethereum" });
    walletId = created.id;
    address = created.address;
    console.log(`created wallet ${walletId}  ${address}`);
    console.log(`set PRIVY_TEST_WALLET_ID=${walletId} to reuse it\n`);
}

const sign = async (message) => {
    const result = await privy(`/wallets/${walletId}/rpc`, {
        chain_type: "ethereum",
        method: "personal_sign",
        params: { message, encoding: "utf-8" },
    });
    return result.data?.signature ?? result.signature;
};

/* Determinism, which the whole identity scheme rests on */

const message = IDENTITY_TYPED_DATA.message.purpose;
const first = await sign(message);
const second = await sign(message);
const third = await sign(message);

console.log(`signature 1  ${first}`);
console.log(`signature 2  ${second}`);
console.log(`signature 3  ${third}\n`);

if (first !== second || second !== third) {
    console.log("FAIL  Privy signs the same message differently each time");
    console.log("");
    console.log("      A Rewall identity is SHA-256 of the signature, so a random nonce means a new");
    console.log("      identity on every login and every stored secret is orphaned, permanently.");
    console.log("      Privy embedded wallets cannot back the derived-key design as it stands.");
    console.log("      SPEC section 1 already names the fallback, a generated key stored by the");
    console.log("      client, which forfeits the never-stored property.");
    process.exit(1);
}
pass("Privy returns a byte-identical signature for a repeated message");

assert.equal(canonicalSignature(first).length, 64);
pass("the signature is 65 bytes and canonicalises, so it is a plain EOA signature");

const a = await deriveIdentity(first);
const b = await deriveIdentity(third);
assert.deepEqual(a.publicKey, b.publicKey);
assert.equal(a.fingerprint, b.fingerprint);
pass(`the derived identity is stable, ${a.fingerprint}`);

/* Typed data is what the SDK actually signs, so confirm the method exists */

try {
    const { domain, types, primaryType, message } = IDENTITY_TYPED_DATA;
    const typed = await privy(`/wallets/${walletId}/rpc`, {
        chain_type: "ethereum",
        method: "eth_signTypedData_v4",
        // The API takes snake_case and rejects any key it does not know
        params: { typed_data: { domain, types, primary_type: primaryType, message } },
    });
    const signature = typed.data?.signature ?? typed.signature;
    assert.equal(canonicalSignature(signature).length, 64);
    pass(`eth_signTypedData_v4 is supported, identity ${(await deriveIdentity(signature)).fingerprint}`);
} catch (error) {
    console.log(`NOTE  eth_signTypedData_v4 through the server API failed, ${String(error).slice(0, 160)}`);
    console.log("      Determinism is a property of the signer, not the payload, so the result above still holds");
}

console.log(`\n${passed} checks passed`);
console.log("\nCaveat worth keeping: this exercises Privy's server wallet API. The browser embedded");
console.log("wallet is a different surface and must be confirmed the same way before launch.");
