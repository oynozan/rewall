import sodium from "libsodium-wrappers";

export const NONCE_BYTES = 12;
export const DEK_BYTES = 32;
export const COMMITMENT_BYTES = 32;
export const TAG_BYTES = 16;

const COMMITMENT_CONTEXT = new TextEncoder().encode("Rewall dek v1");

export class KeyCommitmentError extends Error {
    constructor() {
        super("this ciphertext does not belong to this key");
        this.name = "KeyCommitmentError";
    }
}

// crypto_box_seal prepends an ephemeral public key, so a wrapped 32 byte DEK is always 80 bytes
export const SEALED_DEK_BYTES = DEK_BYTES + 48;

/* Base64, standard padded alphabet */

// sodium.to_base64 defaults to URL-safe unpadded, which would write records other clients cannot decode
export function toBase64(bytes: Uint8Array): string {
    let binary = "";
    // Chunked because fromCharCode takes the whole chunk as arguments and a large spread overflows the stack
    for (let i = 0; i < bytes.length; i += 0x2000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
    }
    return btoa(binary);
}

// Strict, because atob accepts whitespace and unpadded input, which would let one byte string be written
// several ways and make a record value non-canonical
export function fromBase64(value: string): Uint8Array {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
        throw new Error("not canonical standard base64");
    }

    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);

    if (toBase64(out) !== value) throw new Error("not canonical standard base64");
    return out;
}

/* Payload, AES-256-GCM through platform WebCrypto */

// WebCrypto wants ArrayBuffer backing while Uint8Array is generic over ArrayBufferLike, so this bridges the
// two without copying, because a copy of key material is a duplicate that memzero cannot reach
const buf = (bytes: Uint8Array) => bytes as unknown as BufferSource;

export function randomDek(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(DEK_BYTES));
}

// AES-GCM is not a committing AEAD. Given two chosen keys it is solvable to produce one ciphertext that
// authenticates under both, so a blob alone does not say which key it belongs to. This binds it to one.
async function commitmentFor(dek: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> {
    const material = new Uint8Array(COMMITMENT_CONTEXT.length + dek.length + nonce.length);
    material.set(COMMITMENT_CONTEXT, 0);
    material.set(dek, COMMITMENT_CONTEXT.length);
    material.set(nonce, COMMITMENT_CONTEXT.length + dek.length);

    try {
        return new Uint8Array(await crypto.subtle.digest("SHA-256", buf(material)));
    } finally {
        await wipe(material);
    }
}

export async function encrypt(plaintext: Uint8Array, dek: Uint8Array): Promise<Uint8Array> {
    if (dek.length !== DEK_BYTES) throw new Error(`expected a ${DEK_BYTES} byte key, got ${dek.length}`);

    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const commitment = await commitmentFor(dek, nonce);

    const key = await crypto.subtle.importKey("raw", buf(dek), "AES-GCM", false, ["encrypt"]);
    const sealed = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonce) }, key, buf(plaintext)),
    );

    const out = new Uint8Array(NONCE_BYTES + COMMITMENT_BYTES + sealed.length);
    out.set(nonce, 0);
    out.set(commitment, NONCE_BYTES);
    out.set(sealed, NONCE_BYTES + COMMITMENT_BYTES);
    return out;
}

export async function decrypt(blob: Uint8Array, dek: Uint8Array): Promise<Uint8Array> {
    await sodium.ready;
    if (dek.length !== DEK_BYTES) throw new Error(`expected a ${DEK_BYTES} byte key, got ${dek.length}`);

    const header = NONCE_BYTES + COMMITMENT_BYTES;
    if (blob.length < header + TAG_BYTES) throw new Error("ciphertext is too short to be a Rewall blob");

    const nonce = blob.subarray(0, NONCE_BYTES);

    // Checked before decrypting, so a blob lifted from another key fails for the right reason
    if (!sodium.memcmp(blob.subarray(NONCE_BYTES, header), await commitmentFor(dek, nonce))) {
        throw new KeyCommitmentError();
    }

    const key = await crypto.subtle.importKey("raw", buf(dek), "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(nonce) }, key, buf(blob.subarray(header)));
    return new Uint8Array(plaintext);
}

/* Wraps, libsodium sealed box */

export async function seal(dek: Uint8Array, recipientPublicKey: Uint8Array): Promise<Uint8Array> {
    await sodium.ready;
    return sodium.crypto_box_seal(dek, recipientPublicKey);
}

export async function unseal(wrapped: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Promise<Uint8Array> {
    await sodium.ready;
    return sodium.crypto_box_seal_open(wrapped, publicKey, secretKey);
}

export async function wipe(...buffers: Uint8Array[]): Promise<void> {
    await sodium.ready;
    for (const b of buffers) sodium.memzero(b);
}
