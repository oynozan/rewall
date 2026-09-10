import sodium from "libsodium-wrappers";
import { split, combine } from "shamir-secret-sharing";
import { fingerprintOf, type Identity } from "./identity.ts";
import { toBase64, fromBase64, seal, unseal, wipe } from "./crypto.ts";
import type { Grantee } from "./secret.ts";

export type GuardianShare = {
    guardian: string;
    guardianFingerprint: string;
    sealed: string;
};

export type GuardianSet = {
    recoveryPublicKey: Uint8Array;
    recoveryFingerprint: string;
    threshold: number;
    shares: GuardianShare[];
};

/* Setup */

// The recovery private key is destroyed here on purpose. Secrets are wrapped to its public half, and
// only a threshold of guardians acting together can bring the private half back.
export async function createGuardianSet(guardians: Grantee[], threshold: number): Promise<GuardianSet> {
    await sodium.ready;

    if (guardians.length < 2) throw new Error("a guardian set needs at least 2 guardians");
    if (threshold < 2) throw new Error("a threshold below 2 defeats the point, one guardian could recover alone");
    if (threshold > guardians.length) {
        throw new Error(`threshold ${threshold} cannot exceed the ${guardians.length} guardians`);
    }

    const names = new Set(guardians.map((g) => g.fingerprint));
    if (names.size !== guardians.length) throw new Error("the same guardian appears twice");

    const recoverySecret = sodium.randombytes_buf(32);

    try {
        const recoveryPublicKey = sodium.crypto_scalarmult_base(recoverySecret);
        const pieces = await split(recoverySecret, guardians.length, threshold);

        const shares = await Promise.all(
            guardians.map(async (g, i) => ({
                guardian: g.name ?? g.fingerprint,
                guardianFingerprint: g.fingerprint,
                sealed: toBase64(await seal(pieces[i]!, g.publicKey)),
            })),
        );

        for (const piece of pieces) sodium.memzero(piece);

        return {
            recoveryPublicKey,
            recoveryFingerprint: fingerprintOf(recoveryPublicKey),
            threshold,
            shares,
        };
    } finally {
        await wipe(recoverySecret);
    }
}

/* Recovery */

// Run by each guardian. The share is re-sealed to the new owner key and never leaves in the clear.
export async function reshare(sealed: string, guardian: Identity, newOwnerPublicKey: Uint8Array): Promise<string> {
    await sodium.ready;

    const piece = await unseal(fromBase64(sealed), guardian.publicKey, guardian.secretKey);
    try {
        return toBase64(await seal(piece, newOwnerPublicKey));
    } finally {
        sodium.memzero(piece);
    }
}

// Run by the new owner once enough guardians have re-shared. Below the threshold this returns a key that
// simply does not work, because Shamir reconstruction is unauthenticated and fails silently.
export async function recoverWithShares(resealed: string[], newOwner: Identity): Promise<Identity> {
    await sodium.ready;

    if (resealed.length < 2) throw new Error("recovery needs at least 2 re-shared pieces");

    const pieces = await Promise.all(
        resealed.map((s) => unseal(fromBase64(s), newOwner.publicKey, newOwner.secretKey)),
    );

    try {
        const secretKey = await combine(pieces);
        if (secretKey.length !== 32) throw new Error(`reconstructed a ${secretKey.length} byte key, expected 32`);

        const publicKey = sodium.crypto_scalarmult_base(secretKey);
        return { secretKey, publicKey, fingerprint: fingerprintOf(publicKey) };
    } finally {
        for (const piece of pieces) sodium.memzero(piece);
    }
}
