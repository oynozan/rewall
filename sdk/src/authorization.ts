import { recoverMessageAddress, type Address } from "viem";
import {
    approvalKey,
    joinApprovals,
    joinNames,
    RECORD,
    splitApprovals,
    splitNames,
    type Approval,
    type ApprovalRole,
} from "./records.ts";

export const AUTHORIZATION_CONTEXT = "Rewall authorization v2";

// Kept only so a list signed before key binding is told apart from one a delegate stripped
export const LEGACY_AUTHORIZATION_CONTEXT = "Rewall authorization v1";

export type Authorization = {
    secretName: string;
    counter: number;
    owner: string;
    grantees: string[];
    subtrees: string[];
    recovery: string[];
    approvals: Approval[];
};

export class UnauthorizedListError extends Error {
    readonly signer: string | null;
    readonly expected: string;

    constructor(secretName: string, signer: string | null, expected: string) {
        super(
            `the grantee list on ${secretName} is signed by ${signer ?? "nobody"}, not by its owner ${expected}, refusing to rotate`,
        );
        this.name = "UnauthorizedListError";
        this.signer = signer;
        this.expected = expected;
    }
}

// A list signed before key binding existed names its grantees but not their keys, so it cannot gate a rotation
export class LegacyAuthorizationError extends Error {
    constructor(secretName: string) {
        super(
            `${secretName} carries no ${RECORD.authKeys}, so its signed list binds names but not keys, re-sign it with reauthorize before rotating`,
        );
        this.name = "LegacyAuthorizationError";
    }
}

export type KeyChange = { role: ApprovalRole; name: string; approved: string | null; resolved: string };

export class KeyChangedError extends Error {
    readonly changes: KeyChange[];
    readonly subject: string;
    readonly approved: string | null;
    readonly resolved: string;

    constructor(secretName: string, changes: KeyChange[]) {
        const listed = changes.map(
            (c) => `${c.name} publishes ${c.resolved} as its ${c.role} key where ${c.approved ?? "no key"} is approved`,
        );
        super(
            `${secretName} would seal to a key its owner never approved, ${listed.join(", ")}, inspect each new key then accept it by name with reauthorize, or drop that name from the list`,
        );
        this.name = "KeyChangedError";
        this.changes = changes;
        this.subject = changes[0]!.name;
        this.approved = changes[0]!.approved;
        this.resolved = changes[0]!.resolved;
    }
}

export class NonCanonicalRecordError extends Error {
    readonly key: string;

    constructor(secretName: string, key: string) {
        super(
            `${key} on ${secretName} is not in canonical form, so it carries bytes the owner's signature does not cover, refusing to act on it`,
        );
        this.name = "NonCanonicalRecordError";
        this.key = key;
    }
}

// Stops whoever controls a grantee's name from redirecting that grant by publishing a different pubkey
export function assertApproved(secretName: string, approvals: Approval[], resolved: Approval[]): void {
    // An empty resolved set would satisfy the loop below without a single key having been checked
    if (!resolved.some((e) => e.role === "owner")) {
        throw new Error(`${secretName} resolved no owner key, refusing to rotate against an unchecked set`);
    }

    const approved = new Map(approvals.map((a) => [approvalKey(a.role, a.name), a.fingerprint]));
    const changes = resolved
        .map((entry) => ({
            role: entry.role,
            name: entry.name,
            approved: approved.get(approvalKey(entry.role, entry.name)) ?? null,
            resolved: entry.fingerprint,
        }))
        .filter((c) => c.approved !== c.resolved);

    // Every drifted name at once, or an owner clears one and the next rotation stops on the next
    if (changes.length) throw new KeyChangedError(secretName, changes);
}

// Entries already bound to a different key, minus the ones the owner named, so re-approval stays deliberate
export function unacceptedChanges(prior: Approval[], next: Approval[], accept: Approval[]): KeyChange[] {
    const bound = new Map(prior.map((a) => [approvalKey(a.role, a.name), a.fingerprint]));
    const named = new Set(accept.map((a) => `${approvalKey(a.role, a.name)}:${a.fingerprint}`));

    return next
        .map((a) => ({
            role: a.role,
            name: a.name,
            approved: bound.get(approvalKey(a.role, a.name)) ?? null,
            resolved: a.fingerprint,
        }))
        .filter((c) => c.approved !== null && c.approved !== c.resolved)
        .filter((c) => !named.has(`${approvalKey(c.role, c.name)}:${c.resolved}`));
}

// Verification re-serializes what it parsed, so junk appended to a record would otherwise ride under the signature
export function assertCanonical(secretName: string, stored: Record<string, string>): void {
    const expected: [string, string][] = [
        [RECORD.grantees, joinNames(splitNames(stored[RECORD.grantees]))],
        [RECORD.subtrees, joinNames(splitNames(stored[RECORD.subtrees]))],
        [RECORD.recovery, joinNames(splitNames(stored[RECORD.recovery]))],
        [RECORD.authKeys, joinApprovals(splitApprovals(stored[RECORD.authKeys]))],
    ];

    for (const [key, canonical] of expected) {
        if ((stored[key] ?? "") !== canonical) throw new NonCanonicalRecordError(secretName, key);
    }
}

// Canonical and order independent, so the same authorization always produces the same bytes to sign
export function authorizationPayload(auth: Authorization): string {
    return [
        AUTHORIZATION_CONTEXT,
        `name=${auth.secretName}`,
        `n=${auth.counter}`,
        `owner=${auth.owner}`,
        `grantees=${joinNames(auth.grantees)}`,
        `subtrees=${joinNames(auth.subtrees)}`,
        `recovery=${joinNames(auth.recovery)}`,
        `keys=${joinApprovals(auth.approvals)}`,
    ].join("\n");
}

export function legacyAuthorizationPayload(auth: Authorization): string {
    return [
        LEGACY_AUTHORIZATION_CONTEXT,
        `name=${auth.secretName}`,
        `n=${auth.counter}`,
        `owner=${auth.owner}`,
        `grantees=${joinNames(auth.grantees)}`,
        `subtrees=${joinNames(auth.subtrees)}`,
        `recovery=${joinNames(auth.recovery)}`,
    ].join("\n");
}

const signerOf = async (message: string, signature: string): Promise<Address | null> => {
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;

    try {
        return await recoverMessageAddress({ message, signature: signature as `0x${string}` });
    } catch {
        return null;
    }
};

// Compared against the address holding the name, the one thing a write delegate cannot rewrite
export const authorizationSigner = (auth: Authorization, signature: string): Promise<Address | null> =>
    signerOf(authorizationPayload(auth), signature);

export async function isAuthorizedBy(auth: Authorization, signature: string, owner: Address): Promise<boolean> {
    const signer = await authorizationSigner(auth, signature);
    return signer !== null && signer.toLowerCase() === owner.toLowerCase();
}

// Only a list the owner signed under the old payload verifies this way, so a stripped record cannot pose as one
export async function isLegacyAuthorizedBy(auth: Authorization, signature: string, owner: Address): Promise<boolean> {
    const signer = await signerOf(legacyAuthorizationPayload(auth), signature);
    return signer !== null && signer.toLowerCase() === owner.toLowerCase();
}
