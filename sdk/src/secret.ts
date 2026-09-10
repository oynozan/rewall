import { randomDek, encrypt, decrypt, seal, unseal, toBase64, fromBase64, wipe } from "./crypto.ts";
import { buildSecretRecords, RECORD, type SecretRecords } from "./records.ts";
import type { Identity } from "./identity.ts";

export type Grantee = { fingerprint: string; publicKey: Uint8Array };

// Distinguishable from a broken lookup, because an unset ENS text record reads as an empty string
export class NoWrapError extends Error {
    readonly fingerprint: string;

    constructor(fingerprint: string, secretName?: string) {
        super(`no ${RECORD.wrap(fingerprint)} record${secretName ? ` on ${secretName}` : ""}`);
        this.name = "NoWrapError";
        this.fingerprint = fingerprint;
    }
}

export class MissingBlobError extends Error {
    constructor(secretName?: string) {
        super(`no ${RECORD.blob} record${secretName ? ` on ${secretName}` : ""}`);
        this.name = "MissingBlobError";
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
    type: string;
    plaintext: Uint8Array;
    owner: Grantee;
    recovery: Grantee[];
    grantees?: Grantee[];
    createdAt: number;
    allow?: string[];
}): Promise<SecretRecords> {
    assertRecovery(input.recovery);

    const holders = dedupe([input.owner, ...input.recovery, ...(input.grantees ?? [])]);
    const dek = randomDek();

    try {
        const blob = await encrypt(input.plaintext, dek);
        const wraps = await Promise.all(
            holders.map(async (g) => ({ fingerprint: g.fingerprint, wrapped: toBase64(await seal(dek, g.publicKey)) })),
        );
        return buildSecretRecords({
            type: input.type,
            blob: toBase64(blob),
            wraps,
            createdAt: input.createdAt,
            allow: input.allow,
        });
    } finally {
        await wipe(dek);
    }
}

/* Read */

export async function recoverDek(
    records: Record<string, string>,
    identity: Identity,
    secretName?: string,
): Promise<Uint8Array> {
    const wrapped = records[RECORD.wrap(identity.fingerprint)];
    if (!wrapped) throw new NoWrapError(identity.fingerprint, secretName);
    return unseal(fromBase64(wrapped), identity.publicKey, identity.secretKey);
}

export async function openSecret(
    records: Record<string, string>,
    identity: Identity,
    secretName?: string,
): Promise<Uint8Array> {
    const blob = records[RECORD.blob];
    if (!blob) throw new MissingBlobError(secretName);

    const dek = await recoverDek(records, identity, secretName);
    try {
        return await decrypt(fromBase64(blob), dek);
    } finally {
        await wipe(dek);
    }
}

/* Grant */

export async function planGrant(
    records: Record<string, string>,
    identity: Identity,
    grantee: Grantee,
): Promise<SecretRecords> {
    const dek = await recoverDek(records, identity);
    try {
        return [{ key: RECORD.wrap(grantee.fingerprint), value: toBase64(await seal(dek, grantee.publicKey)) }];
    } finally {
        await wipe(dek);
    }
}

/* Rotate, which is also how revoke works */

export async function planRotate(input: {
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

export function wrapFingerprints(records: Record<string, string>): string[] {
    return Object.entries(records)
        .filter(([key, value]) => key.startsWith("rewall.key.") && value !== "")
        .map(([key]) => key.slice("rewall.key.".length));
}
