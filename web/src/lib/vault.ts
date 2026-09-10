import { createPublicClient, decodeFunctionResult, encodeFunctionData, http, namehash } from "viem";
import { normalize } from "viem/ens";
import { sepolia } from "viem/chains";
import { dnsEncode, RECORD, resolverAbi, universalResolverAbi, SCHEMA_VERSION } from "@rewall/sdk";
import { MOCKS_ENABLED, mockVault, mockTransfers } from "../../scripts/dashboard-mocks";

export const TEST_OWNER = "rewall-test-1.eth";
export const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";
export const TYPE_LABELS = {
    apikey: "API key",
    generic: "Secure note",
    privkey: "Private key",
    totp: "Authenticator",
    receipt: "Receipt",
} as const;
export type SecretType = keyof typeof TYPE_LABELS;
export type Secret = {
    name: string;
    label: string;
    type: string;
    encryption: string;
    created: number | null;
    allow: string[];
    version: string;
    owner: string;
    grantees: string[];
    site: string;
};
export type Vault = { owner: string; namespace: string; identityPublished: boolean; secrets: Secret[] };

export const vaultClient = createPublicClient({
    chain: sepolia,
    // Batched because a single rotation read fans out to more than a dozen concurrent eth_calls
    transport: http("https://ethereum-sepolia-rpc.publicnode.com", { timeout: 15000, retryCount: 1, batch: true }),
});

export function ownerName(input: string) {
    const name = normalize(input.trim());
    if (!name.endsWith(".eth") || name.split(".").some((label) => !label))
        throw new Error("Enter a complete ENS name ending in .eth.");
    return name;
}

async function readRecords(name: string, keys: string[]) {
    const calls = keys.map((key) =>
        encodeFunctionData({ abi: resolverAbi, functionName: "text", args: [namehash(name), key] }),
    );
    const [data] = await vaultClient.readContract({
        address: UNIVERSAL_RESOLVER,
        abi: universalResolverAbi,
        functionName: "resolve",
        args: [dnsEncode(name), encodeFunctionData({ abi: resolverAbi, functionName: "multicall", args: [calls] })],
    });
    const results = decodeFunctionResult({ abi: resolverAbi, functionName: "multicall", data });
    return Object.fromEntries(
        keys.map((key, index) => [
            key,
            decodeFunctionResult({ abi: resolverAbi, functionName: "text", data: results[index] }),
        ]),
    );
}

export async function readSecret(input: string): Promise<Secret> {
    const name = ownerName(input);
    if (MOCKS_ENABLED) {
        const entry = [...mockVault.secrets, ...mockTransfers.shared.map((row) => row.secret)].find(
            (secret) => secret.name === name,
        );
        if (!entry) throw new Error("No secret at this name in the mock preview.");
        return entry;
    }
    const records = await readRecords(name, [
        RECORD.version,
        RECORD.type,
        RECORD.encryption,
        RECORD.created,
        RECORD.allow,
        RECORD.owner,
        RECORD.grantees,
        RECORD.site,
    ]);
    if (records[RECORD.version] !== SCHEMA_VERSION)
        throw new Error("No supported Rewall secret was found at this name.");
    const created = Number(records[RECORD.created]);
    return {
        name,
        label: name.split(".")[0],
        type: records[RECORD.type],
        encryption: records[RECORD.encryption],
        created: Number.isFinite(created) && created > 0 && created < 8640000000000 ? created : null,
        allow: records[RECORD.allow]?.split(",").filter(Boolean) ?? [],
        version: records[RECORD.version],
        owner: records[RECORD.owner] || name.split(".rewall.")[1] || "",
        grantees: (records[RECORD.grantees] || "").split(",").filter(Boolean),
        site: records[RECORD.site] || "",
    };
}

export async function readVault(input: string): Promise<Vault> {
    if (MOCKS_ENABLED) {
        if (![TEST_OWNER, mockVault.owner].includes(ownerName(input)))
            throw new Error("Open demo.eth in the mock preview.");
        return mockVault;
    }
    const owner = ownerName(input);
    const namespace = `rewall.${owner}`;
    const [index, identity] = await Promise.all([
        readRecords(namespace, [RECORD.index]),
        readRecords(owner, [RECORD.pubkey]),
    ]);
    const labels = [...new Set((index[RECORD.index] || "").split(",").filter(Boolean))];
    if (labels.length > 128)
        throw new Error("This vault is too large for the current viewer. Open an individual secret by its ENS name.");
    if (labels.some((label) => label.includes("."))) throw new Error("This vault contains an invalid secret index.");
    const secrets = await Promise.all(labels.map((label) => readSecret(`${label}.${namespace}`)));
    return { owner, namespace, identityPublished: Boolean(identity[RECORD.pubkey]), secrets };
}
