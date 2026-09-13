// Reads the paired vault and hands back one account per hostname, which is all the toolbar ever needs

import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { identityFromSeed, NAMESPACE_LABEL, normalizeSite, readTexts, RECORD, Rewall } from "@rewall/sdk";

// The only free Sepolia endpoint serving eth_simulateV1, and the same one the dashboard reads through
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";

export type Account = { uri: string; label: string };

const label = (secretName: string) => secretName.split(".")[0] ?? secretName;

/* Read */

// One account per hostname, so a second secret claiming a taken hostname is reported rather than silently dropped
export async function readAccounts(
    name: string,
    secretKey: Uint8Array,
): Promise<{ accounts: Record<string, Account>; contested: string[]; sites: Record<string, string> }> {
    const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC, { batch: true }) });

    // Wraps the caller's seed rather than copying it, so the caller stays the one that wipes
    const identity = await identityFromSeed(secretKey);
    const client = new Rewall({ publicClient, name, universalResolver: UNIVERSAL_RESOLVER, identity });

    const accounts: Record<string, Account> = {};
    const contested = new Set<string>();
    // What each secret claims right now, so the caller can tell a changed hostname from a first sighting
    const sites: Record<string, string> = {};

    // list returns bare labels, so each is completed to its full subname before any read or decrypt
    const labels = await client.list();
    const described = await Promise.all(
        labels.map(async (labelName) => {
            const secretName = `${labelName}.${NAMESPACE_LABEL}.${name}`;
            const records = await readTexts(publicClient, UNIVERSAL_RESOLVER, secretName, [RECORD.type, RECORD.site]);
            return { secretName, type: records[RECORD.type], site: records[RECORD.site] };
        }),
    );

    for (const entry of described) {
        // An empty site means never fill, rather than fill anywhere
        if (entry.type !== "totp" || !entry.site) continue;

        let hostname: string;
        try {
            hostname = normalizeSite(entry.site);
        } catch {
            continue;
        }

        sites[entry.secretName] = hostname;

        // Two secrets claiming one hostname is ambiguous, so neither fills and the popup says which host
        if (contested.has(hostname)) continue;
        if (accounts[hostname]) {
            delete accounts[hostname];
            contested.add(hostname);
            continue;
        }

        const plaintext = await client.get(entry.secretName);
        accounts[hostname] = { uri: new TextDecoder().decode(plaintext), label: label(entry.secretName) };
        plaintext.fill(0);
    }

    return { accounts, contested: [...contested], sites };
}
