import { createPublicClient, createWalletClient, http, namehash } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import { identityFromAccount, fingerprintOf, toBase64, fromBase64, RECORD, resolverAbi, readTexts } from "@rewall/sdk";
import { PARTICIPANTS, UNIVERSAL_RESOLVER } from "./participants.ts";

const rpc = process.env.SEPOLIA_RPC_URL;
const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!rpc) throw new Error("SEPOLIA_RPC_URL is not set");
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set, run pnpm run wallets first");

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
if ((await publicClient.getChainId()) !== sepolia.id) throw new Error("refusing to run off Sepolia");

const state = JSON.parse(readFileSync(new URL("deployments.json", import.meta.url), "utf8"));

for (const p of PARTICIPANTS) {
    const account = mnemonicToAccount(mnemonic, { addressIndex: p.index });
    const identity = await identityFromAccount(account);
    const encoded = toBase64(identity.publicKey);

    console.log(`\n${p.role.toUpperCase()}`);
    console.log(`  fingerprint  ${identity.fingerprint}`);
    console.log(`  public key   ${encoded}`);

    if (!p.label) {
        console.log(`  onchain      nothing published, this identity exists only to be denied`);
        continue;
    }

    const name = `${p.label}.eth`;
    const resolver = state[p.label]?.resolver;
    if (!resolver) throw new Error(`no resolver deployed for ${name}, run pnpm run deploy first`);

    const existing = await readTexts(publicClient, UNIVERSAL_RESOLVER, name, [RECORD.pubkey]);
    if (existing[RECORD.pubkey] === encoded) {
        console.log(`  onchain      already published on ${name}`);
        continue;
    }

    const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
    const hash = await wallet.writeContract({
        address: resolver,
        abi: resolverAbi,
        functionName: "setText",
        args: [namehash(name), RECORD.pubkey, encoded],
        account,
        chain: sepolia,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`write reverted ${hash}`);
    console.log(`  onchain      published on ${name}, gas ${receipt.gasUsed}`);
}

/* Read back through the Universal Resolver, which is how another participant would find these */

console.log(`\nREAD BACK`);
for (const p of PARTICIPANTS) {
    if (!p.label) continue;
    const name = `${p.label}.eth`;
    const records = await readTexts(publicClient, UNIVERSAL_RESOLVER, name, [RECORD.pubkey]);
    const value = records[RECORD.pubkey];
    if (!value) {
        console.log(`  ${name.padEnd(22)} MISSING`);
        continue;
    }
    console.log(`  ${name.padEnd(22)} ${fingerprintOf(fromBase64(value))}`);
}
console.log("");
