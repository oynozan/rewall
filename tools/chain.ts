import { createPublicClient, createWalletClient, http, namehash, type Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import {
    deriveIdentity,
    encodeSetTextCalls,
    readTexts,
    resolverFor,
    IDENTITY_MESSAGE,
    RECORD,
    resolverAbi,
    fromBase64,
    type Identity,
    type SecretRecords,
} from "@rewall/sdk";
import { PARTICIPANTS, NAMESPACE_LABEL, UNIVERSAL_RESOLVER } from "./participants.ts";

const rpc = process.env.SEPOLIA_RPC_URL;
const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!rpc) throw new Error("SEPOLIA_RPC_URL is not set");
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set, run pnpm run wallets first");

export const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
if ((await publicClient.getChainId()) !== sepolia.id) throw new Error("refusing to run off Sepolia");

export const deployments = JSON.parse(readFileSync(new URL("deployments.json", import.meta.url), "utf8"));
export const byRole = Object.fromEntries(PARTICIPANTS.map((p) => [p.role, p]));

export const accountFor = (index: number) => mnemonicToAccount(mnemonic!, { addressIndex: index });

export function walletFor(index: number) {
    const account = accountFor(index);
    return { account, client: createWalletClient({ account, chain: sepolia, transport: http(rpc) }) };
}

export async function identityFor(index: number): Promise<Identity> {
    return deriveIdentity(await accountFor(index).signMessage({ message: IDENTITY_MESSAGE }));
}

export async function identityOf(role: string): Promise<Identity> {
    const p = byRole[role];
    if (!p) throw new Error(`unknown role ${role}`);
    return identityFor(p.index);
}

// Read from chain rather than derived locally, which is how a real client finds a counterparty
export async function publishedPublicKey(role: string): Promise<Uint8Array> {
    const p = byRole[role];
    if (!p?.label) throw new Error(`${role} has no name, so it publishes no key`);

    const records = await readTexts(publicClient, UNIVERSAL_RESOLVER, `${p.label}.eth`, [RECORD.pubkey]);
    const encoded = records[RECORD.pubkey];
    if (!encoded) throw new Error(`${p.label}.eth has no ${RECORD.pubkey}, run pnpm run identity first`);
    return fromBase64(encoded);
}

export const secretNameFor = (label: string, ownerLabel: string) => `${label}.${NAMESPACE_LABEL}.${ownerLabel}.eth`;

export async function readRecords(name: string, keys: string[]): Promise<Record<string, string>> {
    return readTexts(publicClient, UNIVERSAL_RESOLVER, name, keys);
}

export async function writeRecords(index: number, name: string, records: SecretRecords) {
    // Looked up every write, never cached, because the owner can repoint the name at another resolver
    const resolver = await resolverFor(publicClient, UNIVERSAL_RESOLVER, name);
    if (!resolver) throw new Error(`no resolver configured for ${name}`);

    const { account, client } = walletFor(index);
    const calls = encodeSetTextCalls(namehash(name), records);

    const hash = await client.writeContract({
        address: resolver as Address,
        abi: resolverAbi,
        functionName: "multicall",
        args: [calls],
        account,
        chain: sepolia,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`write reverted ${hash}`);
    return receipt;
}
