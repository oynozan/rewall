import { recoverMessageAddress, type Address } from "viem";
import { joinNames } from "./records.ts";

export const AUTHORIZATION_CONTEXT = "Rewall authorization v1";

export type Authorization = {
    secretName: string;
    counter: number;
    owner: string;
    grantees: string[];
    subtrees: string[];
    recovery: string[];
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
    ].join("\n");
}

// Recovers who signed the list. The caller compares that to the address holding the name in the registry,
// which is the one thing about a secret that a write delegate cannot rewrite.
export async function authorizationSigner(auth: Authorization, signature: string): Promise<Address | null> {
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;

    try {
        return await recoverMessageAddress({
            message: authorizationPayload(auth),
            signature: signature as `0x${string}`,
        });
    } catch {
        return null;
    }
}

export async function isAuthorizedBy(auth: Authorization, signature: string, owner: Address): Promise<boolean> {
    const signer = await authorizationSigner(auth, signature);
    return signer !== null && signer.toLowerCase() === owner.toLowerCase();
}
