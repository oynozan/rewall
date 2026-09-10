import sodium from "libsodium-wrappers";
import { keccak256, hexToBytes, bytesToHex, numberToHex, concat, type Hex } from "viem";

export const IDENTITY_MESSAGE = "Rewall identity v1";

// Order of the secp256k1 group. identity.test.ts proves this value by recovering a signer from N - s.
export const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export type Identity = {
    secretKey: Uint8Array;
    publicKey: Uint8Array;
    fingerprint: string;
};

/* Signature canonicalization */

// Discards v and folds high-s to low-s so clients that disagree on either still derive one identity
export function canonicalSignature(signature: Hex): Uint8Array {
    const bytes = hexToBytes(signature);
    if (bytes.length !== 65) {
        throw new Error(`expected a 65 byte signature, got ${bytes.length}`);
    }

    const r = bytes.slice(0, 32);
    const s = BigInt(bytesToHex(bytes.slice(32, 64)));
    if (s === 0n || s >= SECP256K1_N) {
        throw new Error("signature s is outside the curve order");
    }

    const lowS = s > SECP256K1_N / 2n ? SECP256K1_N - s : s;
    return concat([r, hexToBytes(numberToHex(lowS, { size: 32 }))]);
}

/* Derivation */

export async function deriveIdentity(signature: Hex): Promise<Identity> {
    await sodium.ready;

    // Cast rather than copy, see the same note in crypto.ts
    const canonical = canonicalSignature(signature) as unknown as BufferSource;
    const seed = new Uint8Array(await crypto.subtle.digest("SHA-256", canonical));

    // scalarmult_base, never crypto_box_seed_keypair, which hashes the seed first and yields a different key
    const publicKey = sodium.crypto_scalarmult_base(seed);

    return { secretKey: seed, publicKey, fingerprint: fingerprintOf(publicKey) };
}

// First 8 bytes of keccak256(pubkey) as 16 lowercase hex, used as the rewall.key.<fp> suffix
export function fingerprintOf(publicKey: Uint8Array): string {
    if (publicKey.length !== 32) {
        throw new Error(`expected a 32 byte X25519 public key, got ${publicKey.length}`);
    }
    return keccak256(publicKey).slice(2, 18);
}
