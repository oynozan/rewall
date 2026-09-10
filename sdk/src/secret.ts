import { randomDek, encrypt, decrypt, seal, unseal, toBase64, fromBase64, wipe } from "./crypto.ts";
import { buildSecretRecords, nameContext, RECORD, type SecretRecords } from "./records.ts";
import type { Identity } from "./identity.ts";

export type Grantee = {
    fingerprint: string;
    publicKey: Uint8Array;
    // The ENS name this key came from. Without it a rotation cannot re-resolve the key to re-wrap
    name?: string;
    // True when the key is a subtree public key rather than an individual identity
    subtree?: boolean;
};

// Distinguishable from a broken lookup, because an unset ENS text record reads as an empty string
export class NoWrapError extends Error {
    readonly fingerprints: string[];

    constructor(fingerprints: string[], secretName?: string) {
        const tried = fingerprints.map((fp) => RECORD.wrap(fp)).join(", ");
        super(`no wrap for ${tried}${secretName ? ` on ${secretName}` : ""}`);
        this.name = "NoWrapError";
        this.fingerprints = fingerprints;
    }
}

export class MissingBlobError extends Error {
    constructor(secretName?: string) {
        super(`no ${RECORD.blob} record${secretName ? ` on ${secretName}` : ""}`);
        this.name = "MissingBlobError";
    }
}

// Overwriting a live secret is almost always a mistake, so it takes saying so
export class SecretExistsError extends Error {
    constructor(secretName: string) {
        super(`${secretName} already holds a secret, pass { overwrite: true } to replace it`);
        this.name = "SecretExistsError";
    }
}

/* Grantee sets */

function assertRecovery(recovery: Grantee[]): void {
    // SPEC section 5, key loss can never leak a secret but it can strand one, so a second holder is required
    if (recovery.length === 0) {
        throw new Error("a secret needs at least one recovery grantee, refusing to create it with only the owner");
    }
}

function dedupe(grantees: Grantee[]): Grantee[] {
    const byFingerprint = new Map<string, Grantee>();
    for (const g of grantees) byFingerprint.set(g.fingerprint, g);
    return [...byFingerprint.values()];
}

/* Create */

export async function planSecret(input: {
    secretName: string;
    type: string;
    plaintext: Uint8Array;
    owner: Grantee;
    recovery: Grantee[];
    grantees?: Grantee[];
    createdAt: number;
    allow?: string[];
}): Promise<SecretRecords> {
    assertRecovery(input.recovery);

    const grantees = input.grantees ?? [];
    const holders = dedupe([input.owner, ...input.recovery, ...grantees]);
    const named = (list: Grantee[]) => list.map((g) => g.name).filter((n): n is string => Boolean(n));
    const dek = randomDek();

    try {
        const blob = await encrypt(input.plaintext, dek, nameContext(input.secretName));
        const wraps = await Promise.all(
            holders.map(async (g) => ({ fingerprint: g.fingerprint, wrapped: toBase64(await seal(dek, g.publicKey)) })),
        );
        return buildSecretRecords({
            type: input.type,
            blob: toBase64(blob),
            wraps,
            createdAt: input.createdAt,
            allow: input.allow,
            owner: input.owner.name,
            recovery: named(input.recovery),
            grantees: named(grantees.filter((g) => !g.subtree)),
            subtrees: named(grantees.filter((g) => g.subtree)),
        });
    } finally {
        await wipe(dek);
    }
}

/* Read */

// Accepts several identities so a subname can present its own key and any subtree key it holds
export async function recoverDek(
    records: Record<string, string>,
    holder: Identity | Identity[],
    secretName?: string,
): Promise<Uint8Array> {
    const candidates = Array.isArray(holder) ? holder : [holder];

    // Every candidate is tried, so one corrupt wrap cannot lock a holder out of a key that would work
    for (const candidate of candidates) {
        const wrapped = records[RECORD.wrap(candidate.fingerprint)];
        if (!wrapped) continue;

        try {
            return await unseal(fromBase64(wrapped), candidate.publicKey, candidate.secretKey);
        } catch {
            // A wrap that will not open is the same as no wrap for this candidate, keep looking
        }
    }

    throw new NoWrapError(
        candidates.map((c) => c.fingerprint),
        secretName,
    );
}

// The name is required, because it is mixed into the AEAD and a blob will not open without the right one
export async function openSecret(
    records: Record<string, string>,
    holder: Identity | Identity[],
    secretName: string,
): Promise<Uint8Array> {
    const blob = records[RECORD.blob];
    if (!blob) throw new MissingBlobError(secretName);

    const dek = await recoverDek(records, holder, secretName);
    try {
        return await decrypt(fromBase64(blob), dek, nameContext(secretName));
    } finally {
        await wipe(dek);
    }
}

/* Grant */

export async function planGrant(
    records: Record<string, string>,
    holder: Identity | Identity[],
    grantee: Grantee,
): Promise<SecretRecords> {
    const dek = await recoverDek(records, holder);
    try {
        return [{ key: RECORD.wrap(grantee.fingerprint), value: toBase64(await seal(dek, grantee.publicKey)) }];
    } finally {
        await wipe(dek);
    }
}

/* Rotate, which is also how revoke works */

export async function planRotate(input: {
    secretName: string;
    type: string;
    plaintext: Uint8Array;
    owner: Grantee;
    recovery: Grantee[];
    grantees?: Grantee[];
    previousFingerprints: string[];
    createdAt: number;
    allow?: string[];
}): Promise<{ records: SecretRecords; cleared: string[] }> {
    const records = await planSecret(input);

    const kept = new Set(dedupe([input.owner, ...input.recovery, ...(input.grantees ?? [])]).map((g) => g.fingerprint));
    const cleared = [...new Set(input.previousFingerprints)].filter((fp) => !kept.has(fp));

    // An empty value reads back the same as an unset record, which is how a wrap is removed
    for (const fp of cleared) records.push({ key: RECORD.wrap(fp), value: "" });

    return { records, cleared };
}

// Only sees wraps the caller actually read. Use RECORD.holders to learn about wraps you did not fetch
export function wrapFingerprints(records: Record<string, string>): string[] {
    return Object.entries(records)
        .filter(([key, value]) => key.startsWith("rewall.key.") && value !== "")
        .map(([key]) => key.slice("rewall.key.".length));
}
