// Holds the handed over identity key, wrapped by a passphrase on disk and in the clear only in session memory

// Current OWASP guidance for PBKDF2-HMAC-SHA256, which is what WebCrypto offers without a wasm dependency
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export type Paired = { name: string; wrapped: string; salt: string; iv: string };
export type Unlocked = { name: string; secretKey: Uint8Array };

/* Encoding */

// Base64 by hand, because sodium's helpers default to a URL safe alphabet this never wants
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

/* Wrapping */

async function wrappingKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
        "deriveKey",
    ]);
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
    );
}

export async function wrapIdentity(name: string, secretKey: Uint8Array, passphrase: string): Promise<Paired> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await wrappingKey(passphrase, salt);
    const sealed = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        key,
        secretKey as BufferSource,
    );
    return { name, wrapped: encode(new Uint8Array(sealed)), salt: encode(salt), iv: encode(iv) };
}

// Throws on a wrong passphrase, because GCM authenticates and there is nothing to distinguish it from tampering
export async function unwrapIdentity(paired: Paired, passphrase: string): Promise<Uint8Array> {
    const key = await wrappingKey(passphrase, decode(paired.salt));
    const opened = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decode(paired.iv) as BufferSource },
        key,
        decode(paired.wrapped) as BufferSource,
    );
    return new Uint8Array(opened);
}
