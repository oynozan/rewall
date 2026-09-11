import { parseAbi } from "viem";
import { ownerAddressOf, RECORD, readTexts, resolverFor } from "@rewall/sdk";
import { ownerName, UNIVERSAL_RESOLVER, vaultClient } from "./vault";

const ETH_REGISTRY = "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2";
const ZERO = "0x0000000000000000000000000000000000000000";
const ETH_COIN_TYPE = BigInt(60);

const reverseAbi = parseAbi([
    "function reverse(bytes lookupAddress, uint256 coinType) view returns (string name, address resolver, address reverseResolver)",
]);
const registryAbi = parseAbi([
    "function getSubregistry(string label) view returns (address)",
    "function getResolver(string label) view returns (address)",
]);

const remembered = (address: string) => `rewall.name.${address.toLowerCase()}`;

export type VaultSetup = {
    owned: boolean;
    resolver: boolean;
    registry: boolean;
    namespace: boolean;
    identity: boolean;
    ready: boolean;
};

// Reverse records are self asserted, so a claimed name only counts once the registry agrees
export async function ownsName(name: string, address: string): Promise<boolean> {
    try {
        const owner = await ownerAddressOf(vaultClient, UNIVERSAL_RESOLVER, name);
        return owner.toLowerCase() === address.toLowerCase();
    } catch {
        return false;
    }
}

export async function reverseName(address: string): Promise<string> {
    try {
        const [name] = await vaultClient.readContract({
            address: UNIVERSAL_RESOLVER,
            abi: reverseAbi,
            functionName: "reverse",
            args: [address.toLowerCase() as `0x${string}`, ETH_COIN_TYPE],
        });
        return name || "";
    } catch {
        return "";
    }
}

export function rememberName(address: string, name: string) {
    try {
        localStorage.setItem(remembered(address), name);
    } catch {}
}

export function forgetName(address: string) {
    try {
        localStorage.removeItem(remembered(address));
    } catch {}
}

// A remembered choice wins over a reverse record, and either one has to survive the ownership check
export async function resolveOwnName(address: string): Promise<string> {
    if (!address) return "";

    let stored = "";
    try {
        stored = localStorage.getItem(remembered(address)) || "";
    } catch {}

    if (stored && (await ownsName(stored, address))) return stored;
    if (stored) forgetName(address);

    const claimed = await reverseName(address);
    if (claimed && (await ownsName(claimed, address))) {
        rememberName(address, claimed);
        return claimed;
    }
    return "";
}

// What a 2LD still needs before it can hold secrets, read straight off the chain so it survives a reload
export async function vaultSetup(name: string, address: string): Promise<VaultSetup> {
    const label = ownerName(name).split(".")[0]!;
    const missing: VaultSetup = {
        owned: false,
        resolver: false,
        registry: false,
        namespace: false,
        identity: false,
        ready: false,
    };

    missing.owned = await ownsName(name, address);
    if (!missing.owned) return missing;

    missing.resolver = Boolean(await resolverFor(vaultClient, UNIVERSAL_RESOLVER, name).catch(() => null));

    const registry = (await vaultClient
        .readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getSubregistry", args: [label] })
        .catch(() => ZERO)) as string;
    missing.registry = registry !== ZERO;

    if (missing.registry) {
        const namespace = (await vaultClient
            .readContract({
                address: registry as `0x${string}`,
                abi: registryAbi,
                functionName: "getResolver",
                args: ["rewall"],
            })
            .catch(() => ZERO)) as string;
        missing.namespace = namespace !== ZERO;
    }

    if (missing.resolver) {
        const empty: Record<string, string> = {};
        const records = await readTexts(vaultClient, UNIVERSAL_RESOLVER, name, [RECORD.pubkey]).catch(() => empty);
        missing.identity = Boolean(records[RECORD.pubkey]);
    }

    missing.ready = missing.resolver && missing.registry && missing.namespace && missing.identity;
    return missing;
}
