/*
 * The agent's read only view of its own Rewall vault
 * No walletClient and no account are ever built here, so every write path in the SDK refuses by
 * construction rather than by discipline
 */

import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
    Rewall,
    RECORD,
    readTexts,
    splitNames,
    fromBase64,
    identityFromAccount,
    identityFromSeed,
    type Identity,
} from "@rewall/sdk";

const UNIVERSAL_RESOLVER: Address = "0x4a1817d13e9cf196f471725176355c1234b63c70";
const NAMESPACE_LABEL = "rewall";

export type Meta = {
    name: string;
    label: string;
    type: string;
    allow: string[];
    site: string;
    created: number | null;
    readable: boolean;
};

export type Vault = {
    rewall: Rewall;
    publicClient: any;
    name: string;
    fingerprint: string;
    identityAddress: string;
    list(): Promise<string[]>;
    metaOf(label: string): Promise<Meta>;
};

function required(key: string): string {
    const value = process.env[key];
    if (!value) throw new Error(`${key} is not set, see .env.example`);
    return value;
}

export async function openVault(): Promise<Vault> {
    const name = required("REWALL_NAME");
    const rpc = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

    // A seed is the whole capability this server needs, so a host holding one can decrypt what was
    // granted to it and nothing else, no signing, no gas, no ENS writes, no forged authorizations
    // The wallet key stays supported only because that is how an identity is first derived
    const seed = process.env.REWALL_IDENTITY_SEED;
    let identity: Identity;
    let identityAddress = "";
    if (seed) {
        identity = await identityFromSeed(fromBase64(seed));
    } else {
        const account = privateKeyToAccount(required("REWALL_AGENT_KEY") as `0x${string}`);
        identity = await identityFromAccount(account);
        identityAddress = account.address;
    }

    // Batched because one metadata read fans out to six keys and a listing multiplies that by the vault
    const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(rpc, { timeout: 15000, retryCount: 1, batch: true }),
    });

    const rewall = new Rewall({ publicClient, name, universalResolver: UNIVERSAL_RESOLVER, identity });
    const namespace = `${NAMESPACE_LABEL}.${name}`;

    return {
        rewall,
        publicClient,
        name,
        fingerprint: identity.fingerprint,
        // Held so a signing tool can refuse to sign with the key backing this host's own identity
        identityAddress,
        list: () => rewall.list(),
        async metaOf(label: string): Promise<Meta> {
            const secretName = `${label}.${namespace}`;
            const records = await readTexts(publicClient, UNIVERSAL_RESOLVER, secretName, [
                RECORD.type,
                RECORD.allow,
                RECORD.site,
                RECORD.created,
                RECORD.wrap(identity.fingerprint),
            ]);

            const created = Number(records[RECORD.created]);
            return {
                name: secretName,
                label,
                type: records[RECORD.type] || "generic",
                // Parsed with the SDK's own splitter so the dashboard and this server agree on spacing
                allow: splitNames(records[RECORD.allow]),
                site: records[RECORD.site] || "",
                created: Number.isFinite(created) && created > 0 ? created : null,
                // A wrap addressed to this fingerprint is what read access actually is, so it is
                // reported without opening anything
                readable: Boolean(records[RECORD.wrap(identity.fingerprint)]),
            };
        },
    };
}

export const secretNameFor = (label: string, vaultName: string) => `${label}.${NAMESPACE_LABEL}.${vaultName}`;
