import sodium from "libsodium-wrappers";

export const NONCE_BYTES = 12;
export const DEK_BYTES = 32;
export const COMMITMENT_BYTES = 32;
export const TAG_BYTES = 16;

// The namehash of the secret, mixed into both the commitment and the AEAD so a blob cannot move names
export const CONTEXT_BYTES = 32;

// Plaintext is padded to a multiple of this, so a blob length no longer measures the secret inside it
export const PAD_BLOCK = 256;
const LENGTH_BYTES = 4;

const COMMITMENT_CONTEXT = new TextEncoder().encode("Rewall dek v1");

export class KeyCommitmentError extends Error {
    constructor() {
        super("this ciphertext does not belong to this key and name");
        this.name = "KeyCommitmentError";
    }
}

export class PaddingError extends Error {
    constructor(reason: string) {
        super(`padded plaintext is malformed, ${reason}`);
        this.name = "PaddingError";
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

// Strict because atob accepts whitespace and unpadded input, which makes a record value non-canonical
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

// Bridges to ArrayBuffer without copying, because a copy of key material is one memzero cannot reach
const buf = (bytes: Uint8Array) => bytes as unknown as BufferSource;

export function randomDek(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(DEK_BYTES));
}

/* Length hiding */

// A 32 character API key and a 200 character database URI have to look the same on chain
export function pad(plaintext: Uint8Array): Uint8Array {
    const blocks = Math.ceil((LENGTH_BYTES + plaintext.length) / PAD_BLOCK);
    const out = new Uint8Array(blocks * PAD_BLOCK);

    new DataView(out.buffer).setUint32(0, plaintext.length);
    out.set(plaintext, LENGTH_BYTES);
    return out;
}

// Strict, because a reader that accepts sloppy padding accepts a blob an attacker reshaped
export function unpad(padded: Uint8Array): Uint8Array {
    if (padded.length === 0 || padded.length % PAD_BLOCK !== 0) {
        throw new PaddingError(`${padded.length} bytes is not a whole number of ${PAD_BLOCK} byte blocks`);
    }

    const length = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0);
    if (length > padded.length - LENGTH_BYTES) throw new PaddingError("it claims more bytes than it holds");

    if (Math.ceil((LENGTH_BYTES + length) / PAD_BLOCK) * PAD_BLOCK !== padded.length) {
        throw new PaddingError("it carries more blocks than its length needs");
    }
    for (let i = LENGTH_BYTES + length; i < padded.length; i++) {
        if (padded[i] !== 0) throw new PaddingError("the padding is not zero filled");
    }

    return padded.slice(LENGTH_BYTES, LENGTH_BYTES + length);
}

/* Payload */

// AES-GCM is not committing, so two chosen keys can authenticate one ciphertext
async function commitmentFor(dek: Uint8Array, nonce: Uint8Array, context: Uint8Array): Promise<Uint8Array> {
    const parts = [COMMITMENT_CONTEXT, context, dek, nonce];
    const material = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));

    let at = 0;
    for (const part of parts) {
        material.set(part, at);
        at += part.length;
    }

    try {
        return new Uint8Array(await crypto.subtle.digest("SHA-256", buf(material)));
    } finally {
        await wipe(material);
    }
}

function assertInputs(dek: Uint8Array, context: Uint8Array): void {
    if (dek.length !== DEK_BYTES) throw new Error(`expected a ${DEK_BYTES} byte key, got ${dek.length}`);
    if (context.length !== CONTEXT_BYTES) {
        throw new Error(`expected a ${CONTEXT_BYTES} byte context, got ${context.length}`);
    }
}

export async function encrypt(plaintext: Uint8Array, dek: Uint8Array, context: Uint8Array): Promise<Uint8Array> {
    assertInputs(dek, context);

    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const commitment = await commitmentFor(dek, nonce, context);
    const padded = pad(plaintext);

    try {
        const key = await crypto.subtle.importKey("raw", buf(dek), "AES-GCM", false, ["encrypt"]);
        const sealed = new Uint8Array(
            await crypto.subtle.encrypt(
                { name: "AES-GCM", iv: buf(nonce), additionalData: buf(context) },
                key,
                buf(padded),
            ),
        );

        const out = new Uint8Array(NONCE_BYTES + COMMITMENT_BYTES + sealed.length);
        out.set(nonce, 0);
        out.set(commitment, NONCE_BYTES);
        out.set(sealed, NONCE_BYTES + COMMITMENT_BYTES);
        return out;
    } finally {
        await wipe(padded);
    }
}

export async function decrypt(blob: Uint8Array, dek: Uint8Array, context: Uint8Array): Promise<Uint8Array> {
    await sodium.ready;
    assertInputs(dek, context);

    const header = NONCE_BYTES + COMMITMENT_BYTES;
    if (blob.length < header + TAG_BYTES) throw new Error("ciphertext is too short to be a Rewall blob");

    const nonce = blob.subarray(0, NONCE_BYTES);

    // Checked first, so a blob lifted from another key or another name fails for the right reason
    if (!sodium.memcmp(blob.subarray(NONCE_BYTES, header), await commitmentFor(dek, nonce, context))) {
        throw new KeyCommitmentError();
    }

    const key = await crypto.subtle.importKey("raw", buf(dek), "AES-GCM", false, ["decrypt"]);
    const padded = new Uint8Array(
        await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: buf(nonce), additionalData: buf(context) },
            key,
            buf(blob.subarray(header)),
        ),
    );

    try {
        return unpad(padded);
    } finally {
        await wipe(padded);
    }
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
