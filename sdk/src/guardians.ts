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

export class ForgedShareError extends Error {
    constructor(reason: string) {
        super(`refusing a guardian share, ${reason}`);
        this.name = "ForgedShareError";
    }
}

export class RecoveryFailedError extends Error {
    readonly tried: number;
    constructor(tried: number) {
        super(`no combination of ${tried} pieces reconstructs the published recovery key`);
        this.name = "RecoveryFailedError";
        this.tried = tried;
    }
}

const SHARE_BYTES = 33;
const MAX_GUARDIANS = 12;

/* Setup */

// Destroyed on purpose, only a threshold of guardians together can bring the private half back
export async function createGuardianSet(guardians: Grantee[], threshold: number): Promise<GuardianSet> {
    await sodium.ready;

    if (guardians.length < 2) throw new Error("a guardian set needs at least 2 guardians");
    if (guardians.length > MAX_GUARDIANS) throw new Error(`at most ${MAX_GUARDIANS} guardians`);
    if (threshold < 2) throw new Error("a threshold below 2 defeats the point, one guardian could recover alone");
    if (threshold > guardians.length) {
        throw new Error(`threshold ${threshold} cannot exceed the ${guardians.length} guardians`);
    }

    const seen = new Set(guardians.map((g) => g.fingerprint));
    if (seen.size !== guardians.length) throw new Error("the same guardian appears twice");

    // Validated before any key material exists, because a throw mid-split would strand live shares
    for (const g of guardians) {
        if (g.publicKey.length !== 32) {
            throw new Error(`${g.name ?? g.fingerprint} published a ${g.publicKey.length} byte key, expected 32`);
        }
    }

    const recoverySecret = sodium.randombytes_buf(32);
    let pieces: Uint8Array[] = [];

    try {
        const recoveryPublicKey = sodium.crypto_scalarmult_base(recoverySecret);
        pieces = await split(recoverySecret, guardians.length, threshold);

        const shares = await Promise.all(
            guardians.map(async (g, i) => ({
                guardian: g.name ?? g.fingerprint,
                guardianFingerprint: g.fingerprint,
                sealed: toBase64(await seal(pieces[i]!, g.publicKey)),
            })),
        );

        return { recoveryPublicKey, recoveryFingerprint: fingerprintOf(recoveryPublicKey), threshold, shares };
    } finally {
        // Both wiped on every path, including a throw part way through sealing
        await wipe(recoverySecret, ...pieces);
    }
}

/* Recovery */

// Run by each guardian. The share is re-sealed to the new owner key and never leaves in the clear
export async function reshare(sealed: string, guardian: Identity, newOwnerPublicKey: Uint8Array): Promise<string> {
    await sodium.ready;

    if (newOwnerPublicKey.length !== 32) {
        throw new Error(`expected a 32 byte recipient key, got ${newOwnerPublicKey.length}`);
    }

    const piece = await unseal(fromBase64(sealed), guardian.publicKey, guardian.secretKey);
    try {
        return toBase64(await seal(piece, newOwnerPublicKey));
    } finally {
        sodium.memzero(piece);
    }
}

function combinations(n: number, k: number): number[][] {
    const out: number[][] = [];
    const pick = (start: number, chosen: number[]) => {
        if (chosen.length === k) return void out.push([...chosen]);
        for (let i = start; i < n; i++) pick(i + 1, [...chosen, i]);
    };
    pick(0, []);
    return out;
}

// Verified rather than trusted, because one forged piece would otherwise dictate the result
export async function recoverWithShares(
    resealed: string[],
    newOwner: Identity,
    expect: { publicKey: Uint8Array; threshold: number },
): Promise<Identity> {
    await sodium.ready;

    const { publicKey: expected, threshold } = expect;
    if (expected.length !== 32) throw new Error(`expected a 32 byte recovery key, got ${expected.length}`);
    if (threshold < 2) throw new Error("a threshold below 2 is not a threshold");
    if (resealed.length < threshold) {
        throw new Error(`recovery needs ${threshold} pieces, only ${resealed.length} were supplied`);
    }
    if (resealed.length > MAX_GUARDIANS) throw new Error(`at most ${MAX_GUARDIANS} pieces`);

    const pieces = await Promise.all(
        resealed.map((s) => unseal(fromBase64(s), newOwner.publicKey, newOwner.secretKey)),
    );

    try {
        for (const piece of pieces) {
            if (piece.length !== SHARE_BYTES) {
                throw new ForgedShareError(`it is ${piece.length} bytes, expected ${SHARE_BYTES}`);
            }
            // Zero makes every honest share vanish from the interpolation and hands the result to the forger
            if (piece[SHARE_BYTES - 1] === 0) throw new ForgedShareError("its x coordinate is zero");
        }

        const xs = new Set(pieces.map((p) => p[SHARE_BYTES - 1]!));
        if (xs.size !== pieces.length) throw new ForgedShareError("two pieces share an x coordinate");

        // Exactly threshold at a time, so a poisoned piece is isolated rather than poisoning the whole set
        for (const combo of combinations(pieces.length, threshold)) {
            const candidate = await combine(combo.map((i) => pieces[i]!));
            if (candidate.length !== 32) continue;

            const publicKey = sodium.crypto_scalarmult_base(candidate);
            if (sodium.memcmp(publicKey, expected)) {
                return { secretKey: candidate, publicKey, fingerprint: fingerprintOf(publicKey) };
            }
            sodium.memzero(candidate);
        }

        throw new RecoveryFailedError(pieces.length);
    } finally {
        for (const piece of pieces) sodium.memzero(piece);
    }
}
