/*
 * The agent's read only view of its own Rewall vault
 * No walletClient and no account are ever built here, so every write path in the SDK refuses by
 * construction rather than by discipline
 */

import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Rewall, RECORD, readTexts, splitNames, identityFromAccount, type Identity } from "@rewall/sdk";

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

    // ponytail: the key is read from the environment, seed only provisioning needs an SDK
    // constructor that takes the 32 byte scalar directly so the host never holds a signer at all
    const account = privateKeyToAccount(required("REWALL_AGENT_KEY") as `0x${string}`);
    const identity: Identity = await identityFromAccount(account);

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
        identityAddress: account.address,
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
