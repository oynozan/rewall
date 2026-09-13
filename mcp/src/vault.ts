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

// Which vault this process is acting as, from its environment locally or from a header when hosted
export type Credentials = { name: string; identity: Identity; identityAddress: string };

function required(key: string): string {
    const value = process.env[key];
    if (!value) throw new Error(`${key} is not set, see .env.example`);
    return value;
}

// The whole capability, so a host holding one decrypts what was granted and can do nothing else
export async function credentialsFromSeed(name: string, seed: string): Promise<Credentials> {
    const scalar = fromBase64(seed);
    if (scalar.length !== 32) throw new Error("an identity seed is 32 bytes of standard base64");
    return { name, identity: await identityFromSeed(scalar), identityAddress: "" };
}

export async function credentialsFromEnv(): Promise<Credentials> {
    const name = required("REWALL_NAME");

    const seed = process.env.REWALL_IDENTITY_SEED;
    if (seed) return credentialsFromSeed(name, seed);

    // The wallet key stays supported only because that is how an identity is first derived
    const account = privateKeyToAccount(required("REWALL_AGENT_KEY") as `0x${string}`);
    return { name, identity: await identityFromAccount(account), identityAddress: account.address };
}

// Nothing here touches the network, so a hosted server builds one per request rather than caching
export function openVault({ name, identity, identityAddress }: Credentials): Vault {
    const rpc = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

    // The fragment keys viem's module level batch scheduler per identity and never reaches the wire
    const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(`${rpc}#${identity.fingerprint}`, { timeout: 15000, retryCount: 1, batch: true }),
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
