// Proves the deployed tree is usable, one record written as the owner and read back through the Universal Resolver

import {
    createPublicClient,
    createWalletClient,
    http,
    parseAbi,
    encodeFunctionData,
    decodeFunctionResult,
    namehash,
    toHex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { packetToBytes } from "viem/ens";
import { readFileSync } from "node:fs";
import { PARTICIPANTS, NAMESPACE_LABEL } from "./participants.ts";

const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";

const resolverAbi = parseAbi([
    "function setText(bytes32 node, string key, string value)",
    "function text(bytes32 node, string key) view returns (string)",
    "function multicall(bytes[] data) returns (bytes[])",
]);
const urAbi = parseAbi(["function resolve(bytes name, bytes data) view returns (bytes, address)"]);

const rpc = process.env.SEPOLIA_RPC_URL!;
const mnemonic = process.env.REWALL_TEST_MNEMONIC!;
const state = JSON.parse(readFileSync(new URL("deployments.json", import.meta.url), "utf8"));

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
const owner = PARTICIPANTS.find((p) => p.role === "owner")!;
const account = mnemonicToAccount(mnemonic, { addressIndex: owner.index });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });

const name = `${NAMESPACE_LABEL}.${owner.label}.eth`;
const node = namehash(name);
const resolver = state[owner.label!].resolver;
const value = "1";

console.log(`name     ${name}`);
console.log(`node     ${node}`);
console.log(`resolver ${resolver}\n`);

// Two records in one multicall, which is the shape every secret write will use
const calls = [
    encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [node, "rewall.v", value] }),
    encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [node, "rewall.type", "generic"] }),
];
const hash = await wallet.writeContract({
    address: resolver,
    abi: resolverAbi,
    functionName: "multicall",
    args: [calls],
    account,
    chain: sepolia,
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`write reverted ${hash}`);
console.log(`wrote 2 records in one multicall, gas ${receipt.gasUsed}`);

// Read through the Universal Resolver, not the resolver directly, so the whole lookup path is exercised
const [raw] = await publicClient.readContract({
    address: UNIVERSAL_RESOLVER,
    abi: urAbi,
    functionName: "resolve",
    args: [
        toHex(packetToBytes(name)),
        encodeFunctionData({ abi: resolverAbi, functionName: "text", args: [node, "rewall.v"] }),
    ],
});
const got = decodeFunctionResult({ abi: resolverAbi, functionName: "text", data: raw });

console.log(`read back rewall.v = ${JSON.stringify(got)}`);
if (got !== value) throw new Error(`FAIL expected ${JSON.stringify(value)} got ${JSON.stringify(got)}`);
console.log(`\nPASS  write and read round trip works through the Universal Resolver`);
