import { parseAbi, encodeFunctionData, decodeFunctionResult, namehash, toHex, type Address, type Hex } from "viem";
import { packetToBytes } from "viem/ens";

export const SCHEMA_VERSION = "1";
export const ENCRYPTION = "aes-256-gcm";

export const RECORD = {
    version: "rewall.v",
    type: "rewall.type",
    encryption: "rewall.enc",
    blob: "rewall.blob",
    cid: "rewall.cid",
    created: "rewall.created",
    pubkey: "rewall.pubkey",
    index: "rewall.index",
    site: "rewall.site",
    allow: "rewall.allow",
    wrap: (fingerprint: string) => `rewall.key.${fingerprint}`,
} as const;

export const WRAP_PREFIX = "rewall.key.";

export const resolverAbi = parseAbi([
    "function setText(bytes32 node, string key, string value)",
    "function text(bytes32 node, string key) view returns (string)",
    "function multicall(bytes[] data) returns (bytes[])",
    "function authorizeNameRoles(bytes toName, uint256 roleBitmap, address account, bool grant) returns (bool)",
    "function authorizeTextRoles(bytes toName, string key, address account, bool grant) returns (bool)",
]);

export const universalResolverAbi = parseAbi([
    "function resolve(bytes name, bytes data) view returns (bytes, address)",
    "function findResolver(bytes name) view returns (address resolver, bytes32 node, uint256 offset)",
]);

export const dnsEncode = (name: string): Hex => toHex(packetToBytes(name));

export type SecretRecords = { key: string; value: string }[];

/* Building */

export function buildSecretRecords(input: {
    type: string;
    blob: string;
    wraps: { fingerprint: string; wrapped: string }[];
    createdAt: number;
    allow?: string[];
}): SecretRecords {
    if (input.wraps.length === 0) {
        throw new Error("a secret needs at least one wrap, otherwise nobody can read it");
    }

    const seen = new Set<string>();
    for (const w of input.wraps) {
        if (!/^[0-9a-f]{16}$/.test(w.fingerprint)) {
            throw new Error(`fingerprint must be 16 lowercase hex characters, got ${w.fingerprint}`);
        }
        if (seen.has(w.fingerprint)) throw new Error(`duplicate wrap for ${w.fingerprint}`);
        seen.add(w.fingerprint);
    }

    const records: SecretRecords = [
        { key: RECORD.version, value: SCHEMA_VERSION },
        { key: RECORD.type, value: input.type },
        { key: RECORD.encryption, value: ENCRYPTION },
        { key: RECORD.blob, value: input.blob },
        { key: RECORD.created, value: String(input.createdAt) },
    ];

    if (input.allow?.length) records.push({ key: RECORD.allow, value: input.allow.join(",") });
    for (const w of input.wraps) records.push({ key: RECORD.wrap(w.fingerprint), value: w.wrapped });

    return records;
}

export function encodeSetTextCalls(node: Hex, records: SecretRecords): Hex[] {
    return records.map((r) =>
        encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [node, r.key, r.value] }),
    );
}

/* Reading */

type ReadClient = {
    readContract: (args: any) => Promise<any>;
};

// Looked up every time, because an owner can repoint a name at a different resolver at any moment
export async function resolverFor(
    client: ReadClient,
    universalResolver: Address,
    name: string,
): Promise<Address | null> {
    const [resolver] = await client.readContract({
        address: universalResolver,
        abi: universalResolverAbi,
        functionName: "findResolver",
        args: [dnsEncode(name)],
    });
    return resolver === "0x0000000000000000000000000000000000000000" ? null : (resolver as Address);
}

export async function readTexts(
    client: ReadClient,
    universalResolver: Address,
    name: string,
    keys: string[],
): Promise<Record<string, string>> {
    const node = namehash(name);
    const out: Record<string, string> = {};

    const results = await Promise.all(
        keys.map((key) =>
            client.readContract({
                address: universalResolver,
                abi: universalResolverAbi,
                functionName: "resolve",
                args: [
                    dnsEncode(name),
                    encodeFunctionData({ abi: resolverAbi, functionName: "text", args: [node, key] }),
                ],
            }),
        ),
    );

    keys.forEach((key, i) => {
        const raw = results[i]![0] as Hex;
        out[key] = decodeFunctionResult({ abi: resolverAbi, functionName: "text", data: raw }) as string;
    });

    return out;
}

export const wrapKeyFor = (fingerprint: string) => RECORD.wrap(fingerprint);
