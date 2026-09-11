import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Rewall, ReadOnlyError } from "./client.ts";
import { deriveIdentity, IDENTITY_TYPED_DATA } from "./identity.ts";

const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";
const KEY = "0x0000000000000000000000000000000000000000000000000000000000000007" as const;

// A real client, never called, because every guard below sits ahead of the first lookup
const publicClient = createPublicClient({
    chain: sepolia,
    transport: http("https://ethereum-sepolia-rpc.publicnode.com"),
});

const identity = await deriveIdentity(await privateKeyToAccount(KEY).signTypedData(IDENTITY_TYPED_DATA));

const readOnly = (options: { identity?: typeof identity } = {}) =>
    new Rewall({ publicClient, name: "rewall-test-1.eth", universalResolver: UNIVERSAL_RESOLVER, ...options });

/* Reading without a wallet */

test("a supplied identity is used as it is, with no signature and no copy", async () => {
    const client = readOnly({ identity });
    assert.equal(await client.identity(), identity);
});

test("deriving an identity without a wallet is refused", async () => {
    await assert.rejects(() => readOnly().identity(), ReadOnlyError);
});

/* Writing without a wallet */

test("writing a record without a wallet is refused before any lookup", async () => {
    await assert.rejects(
        () => readOnly({ identity }).setSite("x.rewall.rewall-test-1.eth", "github.com"),
        ReadOnlyError,
    );
});

test("registering a subname without a wallet is refused before any lookup", async () => {
    await assert.rejects(() => readOnly({ identity }).ensureSecretName("x.rewall.rewall-test-1.eth"), ReadOnlyError);
});

test("the refusal names the operation, so a caller knows which half is missing", async () => {
    await assert.rejects(() => readOnly().identity(), /deriving an identity/);
    await assert.rejects(
        () => readOnly({ identity }).ensureSecretName("x.rewall.rewall-test-1.eth"),
        /registering a subname/,
    );
});
