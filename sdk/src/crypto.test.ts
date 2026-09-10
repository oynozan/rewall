import { test } from "node:test";
import assert from "node:assert/strict";
import sodium from "libsodium-wrappers";
import { privateKeyToAccount } from "viem/accounts";
import { identityFromAccount } from "./identity.ts";
import { nameContext } from "./records.ts";
import {
    encrypt,
    decrypt,
    pad,
    unpad,
    seal,
    unseal,
    randomDek,
    toBase64,
    fromBase64,
    NONCE_BYTES,
    DEK_BYTES,
    SEALED_DEK_BYTES,
    COMMITMENT_BYTES,
    TAG_BYTES,
    PAD_BLOCK,
    KeyCommitmentError,
    PaddingError,
} from "./crypto.ts";

const PLAINTEXT = new TextEncoder().encode("sk-proj-not-a-real-key-0123456789");
const NAME = nameContext("openai.rewall.alice.eth");
const OTHER_NAME = nameContext("stripe.rewall.alice.eth");

const identityFor = (key: `0x${string}`) => identityFromAccount(privateKeyToAccount(key));

const owner = await identityFor("0x0000000000000000000000000000000000000000000000000000000000000001");
const stranger = await identityFor("0x0000000000000000000000000000000000000000000000000000000000000002");

/* Payload */

test("AES-256-GCM round trips", async () => {
    const dek = randomDek();
    assert.deepEqual(await decrypt(await encrypt(PLAINTEXT, dek, NAME), dek, NAME), PLAINTEXT);
});

test("blob layout is nonce, key commitment, padded ciphertext and a 16 byte tag", async () => {
    const blob = await encrypt(PLAINTEXT, randomDek(), NAME);
    assert.equal(blob.length, NONCE_BYTES + COMMITMENT_BYTES + PAD_BLOCK + TAG_BYTES);
});

test("a blob encrypted under one key is refused by another, AES-GCM alone would not do this", async () => {
    const blob = await encrypt(PLAINTEXT, randomDek(), NAME);
    await assert.rejects(() => decrypt(blob, randomDek(), NAME), KeyCommitmentError);
});

test("a blob moved to another name is refused even with the right key", async () => {
    const dek = randomDek();
    const blob = await encrypt(PLAINTEXT, dek, NAME);
    await assert.rejects(() => decrypt(blob, dek, OTHER_NAME), KeyCommitmentError);
});

test("a tampered commitment is rejected before any decryption is attempted", async () => {
    const dek = randomDek();
    const blob = await encrypt(PLAINTEXT, dek, NAME);
    blob[NONCE_BYTES] ^= 0x01;
    await assert.rejects(() => decrypt(blob, dek, NAME), KeyCommitmentError);
});

test("the commitment changes with the nonce, so it cannot be lifted between blobs", async () => {
    const dek = randomDek();
    const a = await encrypt(PLAINTEXT, dek, NAME);
    const b = await encrypt(PLAINTEXT, dek, NAME);
    assert.notDeepEqual(
        a.subarray(NONCE_BYTES, NONCE_BYTES + COMMITMENT_BYTES),
        b.subarray(NONCE_BYTES, NONCE_BYTES + COMMITMENT_BYTES),
    );
});

test("each encryption uses a fresh nonce", async () => {
    const dek = randomDek();
    const a = await encrypt(PLAINTEXT, dek, NAME);
    const b = await encrypt(PLAINTEXT, dek, NAME);
    assert.notDeepEqual(a.subarray(0, NONCE_BYTES), b.subarray(0, NONCE_BYTES));
});

test("decrypt fails with the wrong key", async () => {
    const blob = await encrypt(PLAINTEXT, randomDek(), NAME);
    await assert.rejects(() => decrypt(blob, randomDek(), NAME));
});

test("a flipped ciphertext byte is rejected", async () => {
    const dek = randomDek();
    const blob = await encrypt(PLAINTEXT, dek, NAME);
    blob[NONCE_BYTES + COMMITMENT_BYTES + 2]! ^= 0x01;
    await assert.rejects(() => decrypt(blob, dek, NAME));
});

test("a flipped nonce byte is rejected", async () => {
    const dek = randomDek();
    const blob = await encrypt(PLAINTEXT, dek, NAME);
    blob[0]! ^= 0x01;
    await assert.rejects(() => decrypt(blob, dek, NAME));
});

test("a flipped tag byte is rejected", async () => {
    const dek = randomDek();
    const blob = await encrypt(PLAINTEXT, dek, NAME);
    blob[blob.length - 1]! ^= 0x01;
    await assert.rejects(() => decrypt(blob, dek, NAME));
});

test("a truncated blob is rejected", async () => {
    const dek = randomDek();
    const blob = await encrypt(PLAINTEXT, dek, NAME);
    await assert.rejects(() => decrypt(blob.subarray(0, NONCE_BYTES), dek, NAME), /too short/);
    await assert.rejects(() => decrypt(blob.subarray(0, blob.length - 1), dek, NAME));
});

test("encrypt and decrypt reject a key that is not 32 bytes", async () => {
    await assert.rejects(() => encrypt(PLAINTEXT, new Uint8Array(16), NAME), /32 byte key/);
    await assert.rejects(() => decrypt(new Uint8Array(64), new Uint8Array(16), NAME), /32 byte key/);
});

test("encrypt and decrypt reject a context that is not 32 bytes", async () => {
    await assert.rejects(() => encrypt(PLAINTEXT, randomDek(), new Uint8Array(8)), /32 byte context/);
    await assert.rejects(() => decrypt(new Uint8Array(64), randomDek(), new Uint8Array(8)), /32 byte context/);
});

test("empty plaintext round trips", async () => {
    const dek = randomDek();
    const empty = new Uint8Array(0);
    assert.deepEqual(await decrypt(await encrypt(empty, dek, NAME), dek, NAME), empty);
});

/* Length hiding */

test("plaintexts of different lengths produce blobs of the same length", async () => {
    const dek = randomDek();
    const short = await encrypt(new TextEncoder().encode("a"), dek, NAME);
    const long = await encrypt(new TextEncoder().encode("x".repeat(200)), dek, NAME);
    assert.equal(short.length, long.length);
});

test("a plaintext larger than one block spans exactly the blocks it needs", async () => {
    const dek = randomDek();
    const blob = await encrypt(new Uint8Array(PAD_BLOCK), dek, NAME);
    assert.equal(blob.length, NONCE_BYTES + COMMITMENT_BYTES + 2 * PAD_BLOCK + TAG_BYTES);
});

test("padding round trips at every block boundary", () => {
    for (const size of [0, 1, 251, 252, 253, 255, 256, 511, 512, 1000]) {
        const plaintext = crypto.getRandomValues(new Uint8Array(size));
        const padded = pad(plaintext);

        assert.equal(padded.length % PAD_BLOCK, 0, `size ${size} is not block aligned`);
        assert.deepEqual(unpad(padded), plaintext, `size ${size} did not round trip`);
    }
});

test("unpad refuses padding an attacker reshaped", () => {
    const padded = pad(new TextEncoder().encode("hello"));

    assert.throws(() => unpad(padded.subarray(0, PAD_BLOCK - 1)), PaddingError);
    assert.throws(() => unpad(new Uint8Array(0)), PaddingError);

    const overlong = pad(new TextEncoder().encode("hello"));
    new DataView(overlong.buffer).setUint32(0, PAD_BLOCK);
    assert.throws(() => unpad(overlong), PaddingError);

    const dirty = pad(new TextEncoder().encode("hello"));
    dirty[PAD_BLOCK - 1] = 0x01;
    assert.throws(() => unpad(dirty), PaddingError);

    const extraBlock = new Uint8Array(2 * PAD_BLOCK);
    extraBlock.set(pad(new TextEncoder().encode("hello")), 0);
    new DataView(extraBlock.buffer).setUint32(0, 5);
    assert.throws(() => unpad(extraBlock), PaddingError);
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
    const blob = await encrypt(PLAINTEXT, dek, NAME);
    const wrapped = await seal(dek, owner.publicKey);

    const recovered = await unseal(wrapped, owner.publicKey, owner.secretKey);
    assert.deepEqual(await decrypt(blob, recovered, NAME), PLAINTEXT);
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

test("base64 decoding is strict, so a record value has exactly one encoding", () => {
    const valid = toBase64(new Uint8Array([1, 2, 3]));

    for (const malformed of [` ${valid}`, `${valid} `, "AQID\n", "AQI", "AQL_", "AQL-", "AQID=", "!!!!"]) {
        assert.throws(() => fromBase64(malformed), /canonical/, `accepted ${JSON.stringify(malformed)}`);
    }
    assert.deepEqual(fromBase64(valid), new Uint8Array([1, 2, 3]));
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
