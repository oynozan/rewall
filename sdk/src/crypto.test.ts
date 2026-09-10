import { test } from "node:test";
import assert from "node:assert/strict";
import sodium from "libsodium-wrappers";
import { privateKeyToAccount } from "viem/accounts";
import { deriveIdentity, IDENTITY_MESSAGE } from "./identity.ts";
import {
    encrypt,
    decrypt,
    seal,
    unseal,
    randomDek,
    toBase64,
    fromBase64,
    NONCE_BYTES,
    DEK_BYTES,
    SEALED_DEK_BYTES,
} from "./crypto.ts";

const PLAINTEXT = new TextEncoder().encode("sk-proj-not-a-real-key-0123456789");

const identityFor = async (key: `0x${string}`) => {
    const account = privateKeyToAccount(key);
    return deriveIdentity(await account.signMessage({ message: IDENTITY_MESSAGE }));
};

const owner = await identityFor("0x0000000000000000000000000000000000000000000000000000000000000001");
const stranger = await identityFor("0x0000000000000000000000000000000000000000000000000000000000000002");

/* Payload */

test("AES-256-GCM round trips", async () => {
    const dek = randomDek();
    assert.deepEqual(await decrypt(await encrypt(PLAINTEXT, dek), dek), PLAINTEXT);
});

test("blob layout is nonce plus ciphertext plus a 16 byte tag", async () => {
    const blob = await encrypt(PLAINTEXT, randomDek());
    assert.equal(blob.length, NONCE_BYTES + PLAINTEXT.length + 16);
});

test("each encryption uses a fresh nonce", async () => {
    const dek = randomDek();
    const a = await encrypt(PLAINTEXT, dek);
    const b = await encrypt(PLAINTEXT, dek);
    assert.notDeepEqual(a.subarray(0, NONCE_BYTES), b.subarray(0, NONCE_BYTES));
});

test("decrypt fails with the wrong key", async () => {
    const blob = await encrypt(PLAINTEXT, randomDek());
    await assert.rejects(() => decrypt(blob, randomDek()));
});

test("a flipped ciphertext byte is rejected", async () => {
    const dek = randomDek();
    const blob = await encrypt(PLAINTEXT, dek);
    blob[NONCE_BYTES + 2]! ^= 0x01;
    await assert.rejects(() => decrypt(blob, dek));
});

test("a flipped nonce byte is rejected", async () => {
    const dek = randomDek();
    const blob = await encrypt(PLAINTEXT, dek);
    blob[0]! ^= 0x01;
    await assert.rejects(() => decrypt(blob, dek));
});

test("a flipped tag byte is rejected", async () => {
    const dek = randomDek();
    const blob = await encrypt(PLAINTEXT, dek);
    blob[blob.length - 1]! ^= 0x01;
    await assert.rejects(() => decrypt(blob, dek));
});

test("a truncated blob is rejected", async () => {
    const dek = randomDek();
    const blob = await encrypt(PLAINTEXT, dek);
    await assert.rejects(() => decrypt(blob.subarray(0, NONCE_BYTES), dek), /too short/);
    await assert.rejects(() => decrypt(blob.subarray(0, blob.length - 1), dek));
});

test("encrypt and decrypt reject a key that is not 32 bytes", async () => {
    await assert.rejects(() => encrypt(PLAINTEXT, new Uint8Array(16)), /32 byte/);
    await assert.rejects(() => decrypt(new Uint8Array(64), new Uint8Array(16)), /32 byte/);
});

test("empty plaintext round trips", async () => {
    const dek = randomDek();
    const empty = new Uint8Array(0);
    assert.deepEqual(await decrypt(await encrypt(empty, dek), dek), empty);
});

/* Wraps */

test("a DEK seals to and unseals from a scalarmult derived identity", async () => {
    const dek = randomDek();
    const wrapped = await seal(dek, owner.publicKey);
    assert.deepEqual(await unseal(wrapped, owner.publicKey, owner.secretKey), dek);
});

test("a wrapped DEK is exactly 80 bytes", async () => {
    const wrapped = await seal(randomDek(), owner.publicKey);
    assert.equal(wrapped.length, SEALED_DEK_BYTES);
    assert.equal(wrapped.length, DEK_BYTES + 48);
});

test("sealing twice produces different bytes, the ephemeral key is fresh", async () => {
    const dek = randomDek();
    assert.notDeepEqual(await seal(dek, owner.publicKey), await seal(dek, owner.publicKey));
});

test("a stranger cannot unseal a wrap addressed to the owner", async () => {
    const wrapped = await seal(randomDek(), owner.publicKey);
    assert.throws(() => sodium.crypto_box_seal_open(wrapped, stranger.publicKey, stranger.secretKey));
});

test("a tampered wrap is rejected", async () => {
    const wrapped = await seal(randomDek(), owner.publicKey);
    wrapped[wrapped.length - 1]! ^= 0x01;
    assert.throws(() => sodium.crypto_box_seal_open(wrapped, owner.publicKey, owner.secretKey));
});

test("the full path, seal a DEK then decrypt the payload with it", async () => {
    const dek = randomDek();
    const blob = await encrypt(PLAINTEXT, dek);
    const wrapped = await seal(dek, owner.publicKey);

    const recovered = await unseal(wrapped, owner.publicKey, owner.secretKey);
    assert.deepEqual(await decrypt(blob, recovered), PLAINTEXT);
});

/* Base64 */

test("base64 uses the standard alphabet, not URL-safe", () => {
    // These bytes encode to characters that differ between the two alphabets
    assert.equal(toBase64(new Uint8Array([0xfb, 0xff, 0xbe])), "+/++");
    assert.notEqual(toBase64(new Uint8Array([0xfb, 0xff, 0xbe])), "-_--");
});

test("base64 is padded", () => {
    assert.equal(toBase64(new Uint8Array([0x00])), "AA==");
    assert.equal(toBase64(new Uint8Array([0x00, 0x00])), "AAA=");
});

test("sodium.to_base64 would disagree, which is why it is banned", async () => {
    await sodium.ready;
    const bytes = new Uint8Array([0xfb, 0xff, 0xbe]);
    assert.notEqual(sodium.to_base64(bytes), toBase64(bytes));
});

test("base64 round trips random bytes", () => {
    for (let size of [0, 1, 2, 3, 31, 32, 80, 1000]) {
        const bytes = crypto.getRandomValues(new Uint8Array(size));
        assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
    }
});

test("base64 handles a blob larger than the argument spread limit", () => {
    // Filled in 64KB slices because crypto.getRandomValues rejects anything larger in one call
    const bytes = new Uint8Array(200_000);
    for (let i = 0; i < bytes.length; i += 65_536) {
        crypto.getRandomValues(bytes.subarray(i, Math.min(i + 65_536, bytes.length)));
    }
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
});

test("a wrapped DEK survives a base64 round trip", async () => {
    const dek = randomDek();
    const wrapped = await seal(dek, owner.publicKey);
    const recovered = await unseal(fromBase64(toBase64(wrapped)), owner.publicKey, owner.secretKey);
    assert.deepEqual(recovered, dek);
});
