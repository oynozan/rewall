// Proves the wallet contract the dashboard depends on, run with pnpm run check:wallet

import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { sepolia } from "viem/chains";
import { Rewall, IDENTITY_TYPED_DATA, canonicalSignature, NoWrapError } from "@rewall/sdk";
import { headlessWallet } from "./lib/wallet.mjs";

const RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";
const OWNER = "rewall-test-1.eth";
const SECRET = `openai.rewall.${OWNER}`;

let passed = 0;
const pass = (message) => {
    passed++;
    console.log(`PASS  ${message}`);
};

const wallet = headlessWallet({ mnemonic: process.env.REWALL_TEST_MNEMONIC, addressIndex: 0 });
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC, { batch: true }) });

// Built the way dashboard-shell builds it, so a break here is a break in the app
function client() {
    return new Rewall({
        publicClient,
        walletClient: createWalletClient({
            account: wallet.address,
            chain: sepolia,
            transport: custom({ request: wallet.request }),
        }),
        account: wallet.address,
        name: OWNER,
        universalResolver: UNIVERSAL_RESOLVER,
    });
}

console.log(`wallet  ${wallet.address}\n`);

/* The account shape the app passes must actually reach a wallet */

const first = await client().identity();
assert.equal(first.publicKey.length, 32);
pass(`an address as the account signs typed data and derives an identity, ${first.fingerprint}`);

/* Determinism, which is the assumption the whole scheme rests on */

const second = await client().identity();
assert.deepEqual(first.secretKey, second.secretKey);
assert.equal(first.fingerprint, second.fingerprint);
pass("a fresh client on the same wallet derives a byte-identical identity");

const raw = await Promise.all([
    wallet.request({ method: "eth_signTypedData_v4", params: [wallet.address, JSON.stringify(IDENTITY_TYPED_DATA)] }),
    wallet.request({ method: "eth_signTypedData_v4", params: [wallet.address, JSON.stringify(IDENTITY_TYPED_DATA)] }),
]);
assert.equal(raw[0], raw[1]);
assert.equal(canonicalSignature(raw[0]).length, 64);
pass("the raw signature itself repeats byte for byte, so the signer is deterministic");

/* One instance, one prompt */

const reused = client();
const before = wallet.calls.typedData;
await reused.identity();
await reused.identity();
await reused.identity();
assert.equal(wallet.calls.typedData - before, 1);
pass("three identity calls on one instance cost exactly one signature");

/* The decrypt path the 2FA table uses */

const value = new TextDecoder().decode(await reused.get(SECRET));
assert.ok(value.length > 0);
pass(`the owner decrypted ${SECRET} through the injected provider`);

/* A wallet with no wrap is denied, not broken */

const stranger = headlessWallet({ mnemonic: process.env.REWALL_TEST_MNEMONIC, addressIndex: 2 });
const strangerClient = new Rewall({
    publicClient,
    walletClient: createWalletClient({
        account: stranger.address,
        chain: sepolia,
        transport: custom({ request: stranger.request }),
    }),
    account: stranger.address,
    name: OWNER,
    universalResolver: UNIVERSAL_RESOLVER,
});
await strangerClient
    .get(SECRET)
    .then(() => {
        throw new Error("FAIL a stranger decrypted the secret");
    })
    .catch((error) => {
        if (!(error instanceof NoWrapError)) throw error;
        pass("a wallet holding no wrap is refused with NoWrapError");
    });

console.log(`\n${passed} checks passed against real Sepolia`);
