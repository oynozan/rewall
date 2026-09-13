import { createPublicClient, http, parseAbi, parseAbiItem } from "viem";
import { sepolia } from "viem/chains";
import { RECORD, readTexts, registeredOwnerOf, resolverFor } from "@rewall/sdk";
import { ownerName, UNIVERSAL_RESOLVER, vaultClient } from "./vault";

const ETH_REGISTRY = "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2";
const ZERO = "0x0000000000000000000000000000000000000000";
const ETH_COIN_TYPE = BigInt(60);

/* Listing the names a wallet holds, which ENSv2 only answers through logs */

// The read endpoint serves about a day of log history, so the scan needs one that keeps all of it
// Comma separated, tried in order, so a second endpoint only has to be named to stand behind the first
const LOGS_RPC_URLS = (process.env.NEXT_PUBLIC_SEPOLIA_LOGS_RPC_URL || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

// Where ETHRegistry first has bytecode, found by bisecting eth_getCode, so a scan starts there and not at genesis
const REGISTRY_DEPLOYED = BigInt(11383897);
// The widest window the endpoint accepts, which puts the whole scan at about thirty queries
const LOG_SPAN = BigInt(10000);
// Log queries are the expensive kind, so they go out in paced rounds rather than all at once
const LOG_ROUND = 5;
const LOG_PAUSE = 350;

// One scan per wallet per session, since the answer only changes when a name is bought or moved
const listed = new Map<string, string[]>();

// The registry is an ERC-1155 and this is the only event carrying an owner as an indexed topic
const transferSingle = parseAbiItem(
    "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
);
const tokenAbi = parseAbi([
    "function ownerOf(uint256 id) view returns (address)",
    "function LABEL_STORE() view returns (address)",
]);
// ENSv2 keeps the label behind every labelhash, which is what makes a token id readable as a name
const labelStoreAbi = parseAbi(["function getLabel(uint256 id) view returns (string)"]);

// Thirty windows sent as thirty requests earns a 429, so they travel as a handful of batched calls instead
// A refused window would lose a name rather than report it, so what does get refused is retried
const logsClients = LOGS_RPC_URLS.map((url) =>
    createPublicClient({
        chain: sepolia,
        transport: http(url, { batch: { wait: 16, batchSize: 10 }, timeout: 30000, retryCount: 4, retryDelay: 400 }),
    }),
);

const reverseAbi = parseAbi([
    "function reverse(bytes lookupAddress, uint256 coinType) view returns (string name, address resolver, address reverseResolver)",
]);
const registryAbi = parseAbi([
    "function getSubregistry(string label) view returns (address)",
    "function getResolver(string label) view returns (address)",
]);

const remembered = (address: string) => `rewall.name.${address.toLowerCase()}`;

// Names whose vaults are scanned for receipts granted to you, since ENS has no reverse index
const watched = (address: string) => `rewall.watch.${address.toLowerCase()}`;

// Each name costs a chain read per receipt it holds, and a short list is what keeps that bounded
const MAX_WATCHED = 5;

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
        const owner = await registeredOwnerOf(vaultClient, UNIVERSAL_RESOLVER, name);
        return owner.toLowerCase() === address.toLowerCase();
    } catch {
        return false;
    }
}

// Endpoints that refuse a wide window say so in the message, which is the signal to walk it in pieces
function capped(failure: unknown) {
    const message = failure instanceof Error ? failure.message : "";
    return /block range|range .*exceed|exceed.*range|query returned more than/i.test(message);
}

// Throws rather than returning nothing, because a half scan and an empty wallet must not look the same
async function scanFor(client: (typeof logsClients)[number], address: string) {
    const head = await client.getBlockNumber();
    const received = (fromBlock: bigint, toBlock: bigint) =>
        client.getLogs({
            address: ETH_REGISTRY,
            event: transferSingle,
            args: { to: address as `0x${string}` },
            fromBlock,
            toBlock,
        });

    const ids = new Set<bigint>();
    const collect = (logs: Awaited<ReturnType<typeof received>>) => {
        for (const log of logs) if (log.args.id !== undefined) ids.add(log.args.id);
    };

    // An endpoint that serves the whole history answers in one query, and one that caps the range says so
    try {
        collect(await received(REGISTRY_DEPLOYED, head));
    } catch (failure) {
        if (!capped(failure)) throw failure;
        const windows: [bigint, bigint][] = [];
        for (let from = REGISTRY_DEPLOYED; from <= head; from += LOG_SPAN) {
            const to = from + LOG_SPAN - BigInt(1);
            windows.push([from, to > head ? head : to]);
        }
        for (let start = 0; start < windows.length; start += LOG_ROUND) {
            if (start) await new Promise((wake) => setTimeout(wake, LOG_PAUSE));
            const found = await Promise.all(
                windows.slice(start, start + LOG_ROUND).map(([from, to]) => received(from, to)),
            );
            for (const logs of found) collect(logs);
        }
    }
    if (!ids.size) return [];

    const store = await vaultClient.readContract({ address: ETH_REGISTRY, abi: tokenAbi, functionName: "LABEL_STORE" });
    const held = await Promise.all(
        [...ids].map(async (id) => {
            // Zero comes back for a name that expired or whose token was regenerated, which drops both here
            const owner = await vaultClient.readContract({
                address: ETH_REGISTRY,
                abi: tokenAbi,
                functionName: "ownerOf",
                args: [id],
            });
            if (owner.toLowerCase() !== address.toLowerCase()) return "";
            const label = await vaultClient.readContract({
                address: store,
                abi: labelStoreAbi,
                functionName: "getLabel",
                args: [id],
            });
            return label ? `${label}.eth` : "";
        }),
    );
    return [...new Set(held.filter(Boolean))].sort();
}

// A wallet's names are only discoverable through logs, so each endpoint is asked until one answers
// When none of them does the list stays empty and nothing is said, since an empty list is not an error
export async function ownedNames(address: string): Promise<string[]> {
    if (!address) return [];
    const key = address.toLowerCase();
    const known = listed.get(key);
    if (known) return known;

    for (const client of logsClients) {
        try {
            const names = await scanFor(client, address);
            listed.set(key, names);
            return names;
        } catch {
            // Nothing is remembered from a failed scan, so the next endpoint and the next open both get a turn
        }
    }
    return [];
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

// Kept on the device rather than in a record, because a public list of who you pay is a social graph
export function watchedNames(address: string): string[] {
    try {
        return JSON.parse(localStorage.getItem(watched(address)) || "[]");
    } catch {
        return [];
    }
}

export function watchName(address: string, name: string) {
    const next = [...new Set([...watchedNames(address), name])].slice(-MAX_WATCHED);
    try {
        localStorage.setItem(watched(address), JSON.stringify(next));
    } catch {}
}

export function unwatchName(address: string, name: string) {
    try {
        localStorage.setItem(watched(address), JSON.stringify(watchedNames(address).filter((held) => held !== name)));
    } catch {}
}

// Read off the device so a returning wallet has its name before the first chain call
export function cachedName(address: string): string {
    if (!address) return "";
    try {
        return localStorage.getItem(remembered(address)) || "";
    } catch {
        return "";
    }
}

// A remembered choice wins over a reverse record, and either one has to survive the ownership check
export async function resolveOwnName(address: string): Promise<string> {
    if (!address) return "";

    const stored = cachedName(address);
    if (stored) {
        // A read that failed is not an answer, so the name is only dropped when the registry names somebody else
        const owner = await registeredOwnerOf(vaultClient, UNIVERSAL_RESOLVER, stored).catch(() => null);
        if (!owner || owner.toLowerCase() === address.toLowerCase()) return stored;
        forgetName(address);
    }

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
