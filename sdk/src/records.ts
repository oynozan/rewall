import {
    parseAbi,
    encodeFunctionData,
    decodeFunctionResult,
    hexToBytes,
    keccak256,
    namehash,
    toBytes,
    toHex,
    type Address,
    type Hex,
} from "viem";
import { packetToBytes } from "viem/ens";

// Bumped to 3 when blobs gained name binding and padding, so an older blob is refused rather than misparsed
export const SCHEMA_VERSION = "3";
export const ENCRYPTION = "aes-256-gcm";

// Binds a blob to the name it sits on, so a ciphertext moved to another name refuses to open
export const nameContext = (secretName: string): Uint8Array => hexToBytes(namehash(secretName));

export const RECORD = {
    version: "rewall.v",
    type: "rewall.type",
    encryption: "rewall.enc",
    blob: "rewall.blob",
    cid: "rewall.cid",
    created: "rewall.created",
    pubkey: "rewall.pubkey",
    index: "rewall.index",
    // A fingerprint is a hash, so the names have to be recorded or a rotation cannot re-wrap for anyone
    owner: "rewall.owner",
    grantees: "rewall.grantees",
    subtrees: "rewall.subtrees",
    recovery: "rewall.recovery",
    // Text records cannot be enumerated, so without this a rotation cannot find the wraps it must clear
    holders: "rewall.holders",
    // Signed by the address holding the name, which is the one thing a write delegate cannot rewrite
    authCounter: "rewall.auth.n",
    authSig: "rewall.auth.sig",
    subtreePubkey: "rewall.subtree.pubkey",
    subtreeKey: "rewall.subtree.key",
    subtreeVersion: "rewall.subtree.v",
    guardians: "rewall.guardians",
    guardian: (fingerprint: string) => `rewall.guardian.${fingerprint}`,
    recoveryPubkey: "rewall.recovery.pubkey",
    recoveryThreshold: "rewall.recovery.k",
    site: "rewall.site",
    allow: "rewall.allow",
    wrap: (fingerprint: string) => `rewall.key.${fingerprint}`,
} as const;

export const WRAP_PREFIX = "rewall.key.";

// Marks a recovery entry backed by a guardian set rather than by a name that publishes its own key
export const GUARDIAN_RECOVERY_PREFIX = "guardians:";
export const guardianRecoveryEntry = (ownerName: string) => `${GUARDIAN_RECOVERY_PREFIX}${ownerName}`;

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

export const joinNames = (names: string[]) => [...new Set(names)].sort().join(",");
export const splitNames = (value: string | undefined) =>
    (value ?? "")
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);

export function buildSecretRecords(input: {
    type: string;
    blob: string;
    wraps: { fingerprint: string; wrapped: string }[];
    createdAt: number;
    allow?: string[];
    owner?: string;
    grantees?: string[];
    subtrees?: string[];
    recovery?: string[];
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

    // Always written, including empty, so a rotation that drops the last grantee clears the old list
    records.push({ key: RECORD.owner, value: input.owner ?? "" });
    records.push({ key: RECORD.recovery, value: joinNames(input.recovery ?? []) });
    records.push({ key: RECORD.grantees, value: joinNames(input.grantees ?? []) });
    records.push({ key: RECORD.subtrees, value: joinNames(input.subtrees ?? []) });
    records.push({ key: RECORD.holders, value: joinNames(input.wraps.map((w) => w.fingerprint)) });

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

export const registryLookupAbi = parseAbi([
    "function findParentRegistry(bytes name) view returns (address)",
    "function getTokenId(uint256 anyId) view returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)",
]);

// The address holding a name is the one thing about it a write delegate cannot rewrite
export async function ownerAddressOf(
    client: ReadClient,
    universalResolver: Address,
    name: string,
): Promise<Address> {
    const registry = await client.readContract({
        address: universalResolver,
        abi: registryLookupAbi,
        functionName: "findParentRegistry",
        args: [dnsEncode(name)],
    });
    if (!registry || registry === "0x0000000000000000000000000000000000000000") {
        throw new Error(`no registry holds ${name}`);
    }

    const tokenId = await client.readContract({
        address: registry,
        abi: registryLookupAbi,
        functionName: "getTokenId",
        args: [BigInt(keccak256(toBytes(name.split(".")[0]!)))],
    });
    return client.readContract({
        address: registry,
        abi: registryLookupAbi,
        functionName: "ownerOf",
        args: [tokenId],
    }) as Promise<Address>;
}

/* The rewall.index record, which is what list reads because ENSv2 exposes no enumeration */

export const addToIndex = (current: string | undefined, label: string) => joinNames([...splitNames(current), label]);

export const removeFromIndex = (current: string | undefined, label: string) =>
    joinNames(splitNames(current).filter((l) => l !== label));
