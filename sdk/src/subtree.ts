import sodium from "libsodium-wrappers";
import { fingerprintOf, type Identity } from "./identity.ts";
import { toBase64, fromBase64, seal, unseal } from "./crypto.ts";

export const SUBTREE_CONTEXT = "Rewall subtree v1";

// Derived from the parent identity rather than stored, so the parent can always re-seal it to a new subname
// without keeping state. The version is the rotation counter and is published as rewall.subtree.v.
export async function deriveSubtreeKey(parent: Identity, version: number): Promise<Identity> {
    await sodium.ready;

    if (!Number.isInteger(version) || version < 0) {
        throw new Error(`subtree version must be a non-negative integer, got ${version}`);
    }

    const prefix = new TextEncoder().encode(`${SUBTREE_CONTEXT}:${version}:`);
    const material = new Uint8Array(prefix.length + parent.secretKey.length);
    material.set(prefix, 0);
    material.set(parent.secretKey, prefix.length);

    try {
        const seed = new Uint8Array(await crypto.subtle.digest("SHA-256", material as unknown as BufferSource));
        const publicKey = sodium.crypto_scalarmult_base(seed);
        return { secretKey: seed, publicKey, fingerprint: fingerprintOf(publicKey) };
    } finally {
        sodium.memzero(material);
    }
}

// The parent seals the subtree private key to a member, who stores it as rewall.subtree.key on its own name
export async function sealSubtreeKey(subtree: Identity, memberPublicKey: Uint8Array): Promise<string> {
    return toBase64(await seal(subtree.secretKey, memberPublicKey));
}

export async function openSubtreeKey(sealed: string, member: Identity): Promise<Identity> {
    await sodium.ready;

    const secretKey = await unseal(fromBase64(sealed), member.publicKey, member.secretKey);
    if (secretKey.length !== 32) {
        throw new Error(`expected a 32 byte subtree key, got ${secretKey.length}`);
    }

    const publicKey = sodium.crypto_scalarmult_base(secretKey);
    return { secretKey, publicKey, fingerprint: fingerprintOf(publicKey) };
}
