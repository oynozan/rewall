import { test } from "node:test";
import assert from "node:assert/strict";
import sodium from "libsodium-wrappers";
import { privateKeyToAccount } from "viem/accounts";
import { hashTypedData, recoverAddress, hexToBytes, bytesToHex, numberToHex, concat, type Hex } from "viem";
import { canonicalSignature, deriveIdentity, fingerprintOf, IDENTITY_TYPED_DATA, SECP256K1_N } from "./identity.ts";

const KEY_A = "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
const KEY_B = "0x0000000000000000000000000000000000000000000000000000000000000002" as const;

const accountA = privateKeyToAccount(KEY_A);
const accountB = privateKeyToAccount(KEY_B);

const sign = (account: typeof accountA) => account.signTypedData(IDENTITY_TYPED_DATA);

// Rebuilds a signature with s replaced by N - s and v flipped, which is the other valid form of the same signature
function flipS(signature: Hex): Hex {
    const bytes = hexToBytes(signature);
    const r = bytes.slice(0, 32);
    const s = BigInt(bytesToHex(bytes.slice(32, 64)));
    const v = bytes[64]!;
    const flipped = hexToBytes(numberToHex(SECP256K1_N - s, { size: 32 }));
    return bytesToHex(concat([r, flipped, new Uint8Array([v === 27 ? 28 : 27])]));
}

test("SECP256K1_N is the real curve order, proven by recovering the signer from N - s", async () => {
    const signature = await sign(accountA);
    const hash = hashTypedData(IDENTITY_TYPED_DATA);

    assert.equal((await recoverAddress({ hash, signature })).toLowerCase(), accountA.address.toLowerCase());

    // Only holds if N is exactly the group order, otherwise the flipped signature recovers something else
    const recovered = await recoverAddress({ hash, signature: flipS(signature) });
    assert.equal(recovered.toLowerCase(), accountA.address.toLowerCase());
});

test("high-s and low-s forms of one signature give the same canonical bytes", async () => {
    const signature = await sign(accountA);
    assert.deepEqual(canonicalSignature(signature), canonicalSignature(flipS(signature)));
});

test("the recovery byte does not affect the identity", async () => {
    const signature = await sign(accountA);
    const bytes = hexToBytes(signature);

    const withOtherV = bytesToHex(concat([bytes.slice(0, 64), new Uint8Array([bytes[64] === 27 ? 28 : 27])]));
    assert.deepEqual(canonicalSignature(signature), canonicalSignature(withOtherV));
});

test("canonical output is 64 bytes with v dropped", async () => {
    assert.equal(canonicalSignature(await sign(accountA)).length, 64);
});

test("the same wallet always derives the same identity", async () => {
    const first = await deriveIdentity(await sign(accountA));
    const second = await deriveIdentity(await sign(accountA));

    assert.deepEqual(first.secretKey, second.secretKey);
    assert.deepEqual(first.publicKey, second.publicKey);
    assert.equal(first.fingerprint, second.fingerprint);
});

test("a high-s signature derives the same identity as its low-s twin", async () => {
    const signature = await sign(accountA);
    const low = await deriveIdentity(signature);
    const high = await deriveIdentity(flipS(signature));

    assert.deepEqual(low.publicKey, high.publicKey);
    assert.equal(low.fingerprint, high.fingerprint);
});

test("different wallets derive different identities", async () => {
    const a = await deriveIdentity(await sign(accountA));
    const b = await deriveIdentity(await sign(accountB));

    assert.notDeepEqual(a.publicKey, b.publicKey);
    assert.notEqual(a.fingerprint, b.fingerprint);
});

test("crypto_box_seed_keypair would derive a different key from the same seed", async () => {
    await sodium.ready;
    const { secretKey, publicKey } = await deriveIdentity(await sign(accountA));

    // Guards SPEC section 1. If these ever match, the normative choice stopped mattering and this test is wrong
    const wrong = sodium.crypto_box_seed_keypair(secretKey);
    assert.notDeepEqual(publicKey, wrong.publicKey);
    assert.deepEqual(publicKey, sodium.crypto_scalarmult_base(secretKey));
});

test("the secret key is the seed itself, 32 bytes", async () => {
    const identity = await deriveIdentity(await sign(accountA));
    assert.equal(identity.secretKey.length, 32);
    assert.equal(identity.publicKey.length, 32);
});

test("fingerprint is 16 lowercase hex characters", async () => {
    const { fingerprint } = await deriveIdentity(await sign(accountA));
    assert.match(fingerprint, /^[0-9a-f]{16}$/);
});

test("fingerprint rejects a key that is not 32 bytes", () => {
    assert.throws(() => fingerprintOf(new Uint8Array(31)), /32 byte/);
    assert.throws(() => fingerprintOf(new Uint8Array(33)), /32 byte/);
});

/* Domain separation, which is what stops another app collecting a usable identity signature */

test("the typed data carries a Rewall domain and a warning the wallet can render", () => {
    assert.equal(IDENTITY_TYPED_DATA.domain.name, "Rewall");
    assert.equal(IDENTITY_TYPED_DATA.primaryType, "Identity");
    assert.match(IDENTITY_TYPED_DATA.message.warning, /every secret/);
});

test("another app signing the same fields derives a different key", async () => {
    const mine = await deriveIdentity(await sign(accountA));
    const theirs = await deriveIdentity(
        await accountA.signTypedData({ ...IDENTITY_TYPED_DATA, domain: { name: "NotRewall", version: "1" } }),
    );

    assert.notDeepEqual(mine.publicKey, theirs.publicKey);
});

test("a plain personal_sign of the same words derives a different key", async () => {
    const typed = await deriveIdentity(await sign(accountA));
    const plain = await deriveIdentity(await accountA.signMessage({ message: IDENTITY_TYPED_DATA.message.purpose }));

    assert.notDeepEqual(typed.publicKey, plain.publicKey);
});

test("canonicalSignature rejects a signature that is not 65 bytes", () => {
    assert.throws(() => canonicalSignature(bytesToHex(new Uint8Array(64))), /65 byte/);
    assert.throws(() => canonicalSignature(bytesToHex(new Uint8Array(66))), /65 byte/);
});

test("canonicalSignature rejects s of zero or s at or above the curve order", () => {
    const r = new Uint8Array(32).fill(1);

    const zero = bytesToHex(concat([r, new Uint8Array(32), new Uint8Array([27])]));
    assert.throws(() => canonicalSignature(zero), /curve order/);

    const atOrder = bytesToHex(concat([r, hexToBytes(numberToHex(SECP256K1_N, { size: 32 })), new Uint8Array([27])]));
    assert.throws(() => canonicalSignature(atOrder), /curve order/);
});
