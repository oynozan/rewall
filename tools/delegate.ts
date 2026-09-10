import { createPublicClient, createWalletClient, http, namehash } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { dnsEncode, readTexts, resolverFor, RECORD, resolverAbi } from "@rewall/sdk";
import { PARTICIPANTS, NAMESPACE_LABEL, UNIVERSAL_RESOLVER } from "./participants.ts";

const SECRET_LABEL = process.env.REWALL_SECRET_LABEL ?? "openai";
const GRANTED_KEY = RECORD.allow;
const NEIGHBOUR_KEY = RECORD.blob;

const rpc = process.env.SEPOLIA_RPC_URL;
const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!rpc) throw new Error("SEPOLIA_RPC_URL is not set");
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set");

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
if ((await publicClient.getChainId()) !== sepolia.id) throw new Error("refusing to run off Sepolia");

const byRole = Object.fromEntries(PARTICIPANTS.map((p) => [p.role, p]));
const owner = byRole.owner!;
const grantee = byRole.grantee!;

const ownerAccount = mnemonicToAccount(mnemonic, { addressIndex: owner.index });
const granteeAccount = mnemonicToAccount(mnemonic, { addressIndex: grantee.index });
const ownerWallet = createWalletClient({ account: ownerAccount, chain: sepolia, transport: http(rpc) });
const granteeWallet = createWalletClient({ account: granteeAccount, chain: sepolia, transport: http(rpc) });

const secretName = `${SECRET_LABEL}.${NAMESPACE_LABEL}.${owner.label}.eth`;
const node = namehash(secretName);
const resolver = await resolverFor(publicClient, UNIVERSAL_RESOLVER, secretName);
if (!resolver) throw new Error(`no resolver configured for ${secretName}`);

console.log(`secret    ${secretName}`);
console.log(`resolver  ${resolver}`);
console.log(`grantee   ${granteeAccount.address}\n`);

/* Before the grant, the grantee can write neither key */

const canWrite = async (key: string) => {
    try {
        await publicClient.simulateContract({
            address: resolver,
            abi: resolverAbi,
            functionName: "setText",
            args: [node, key, "probe"],
            account: granteeAccount,
        });
        return true;
    } catch {
        return false;
    }
};

console.log(`before grant  ${GRANTED_KEY} ${(await canWrite(GRANTED_KEY)) ? "ALLOWED" : "denied"}`);
console.log(`before grant  ${NEIGHBOUR_KEY} ${(await canWrite(NEIGHBOUR_KEY)) ? "ALLOWED" : "denied"}`);

/* Grant write on exactly one key */

const grantHash = await ownerWallet.writeContract({
    address: resolver,
    abi: resolverAbi,
    functionName: "authorizeTextRoles",
    args: [dnsEncode(secretName), GRANTED_KEY, granteeAccount.address, true],
    account: ownerAccount,
    chain: sepolia,
});
const grantReceipt = await publicClient.waitForTransactionReceipt({ hash: grantHash });
if (grantReceipt.status !== "success") throw new Error(`grant reverted ${grantHash}`);
console.log(`\ngranted ${GRANTED_KEY} to the grantee  gas ${grantReceipt.gasUsed}`);

/* After the grant, exactly one key opens */

const grantedNow = await canWrite(GRANTED_KEY);
const neighbourNow = await canWrite(NEIGHBOUR_KEY);
console.log(`after grant   ${GRANTED_KEY} ${grantedNow ? "allowed" : "DENIED"}`);
console.log(`after grant   ${NEIGHBOUR_KEY} ${neighbourNow ? "ALLOWED" : "denied"}`);

if (!grantedNow) throw new Error(`FAIL the grantee still cannot write ${GRANTED_KEY}`);
if (neighbourNow) throw new Error(`FAIL the grant leaked to ${NEIGHBOUR_KEY}`);

/* The granted write really lands, not just in simulation */

const value = `api.openai.com,written-by-grantee-${grantReceipt.blockNumber}`;
const writeHash = await granteeWallet.writeContract({
    address: resolver,
    abi: resolverAbi,
    functionName: "setText",
    args: [node, GRANTED_KEY, value],
    account: granteeAccount,
    chain: sepolia,
});
const writeReceipt = await publicClient.waitForTransactionReceipt({ hash: writeHash });
if (writeReceipt.status !== "success") throw new Error(`grantee write reverted ${writeHash}`);

const after = await readTexts(publicClient, UNIVERSAL_RESOLVER, secretName, [GRANTED_KEY]);
if (after[GRANTED_KEY] !== value) throw new Error(`FAIL wrote ${value} but read back ${after[GRANTED_KEY]}`);

console.log(`\nPASS  the grantee wrote ${GRANTED_KEY} and it read back correctly`);
console.log(`PASS  the same grantee is still refused on ${NEIGHBOUR_KEY}`);
console.log(`tx https://sepolia.etherscan.io/tx/${writeReceipt.transactionHash}`);
