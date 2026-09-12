/*
 * Proves the batched ENS read the enclave will issue, against real Sepolia and against the per key
 * reads the SDK does today. Run before the same encoding goes near QuickJS, so a failure there is
 * unambiguously the runtime rather than the ABI.
 */

import { createPublicClient, http, encodeFunctionData, decodeFunctionResult, namehash } from "viem";
import { sepolia } from "viem/chains";
import { RECORD, dnsEncode, resolverAbi, universalResolverAbi, readTexts, splitNames } from "@rewall/sdk";

const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";
const NAMESPACE = "rewall.rewall-test-1.eth";

const client = createPublicClient({
    chain: sepolia,
    transport: http("https://ethereum-sepolia-rpc.publicnode.com"),
});

const listed = await readTexts(client, UNIVERSAL_RESOLVER, NAMESPACE, [RECORD.index]);
const labels = splitNames(listed[RECORD.index]);
if (labels.length === 0) throw new Error(`${NAMESPACE} indexes no secrets`);

const secretName = `${labels[0]}.${NAMESPACE}`;
console.log(`index      ${labels.join(", ")}`);
console.log(`reading    ${secretName}\n`);

const KEYS = [
    RECORD.version,
    RECORD.encryption,
    RECORD.blob,
    RECORD.holders,
    RECORD.grantees,
    RECORD.recovery,
    RECORD.authCounter,
    RECORD.authKeys,
];

/* One call per key, which is what the SDK does today */

const perKey = await readTexts(client, UNIVERSAL_RESOLVER, secretName, KEYS);

/* One call for all of them, which is what an enclave with a five call budget needs */

const node = namehash(secretName);
const inner = KEYS.map((key) => encodeFunctionData({ abi: resolverAbi, functionName: "text", args: [node, key] }));
const multicall = encodeFunctionData({ abi: resolverAbi, functionName: "multicall", args: [inner] });

const [result] = await client.readContract({
    address: UNIVERSAL_RESOLVER,
    abi: universalResolverAbi,
    functionName: "resolve",
    args: [dnsEncode(secretName), multicall],
});

const parts = decodeFunctionResult({ abi: resolverAbi, functionName: "multicall", data: result });
const batched = Object.fromEntries(
    KEYS.map((key, i) => [key, decodeFunctionResult({ abi: resolverAbi, functionName: "text", data: parts[i] })]),
);

console.log(`calldata   ${(multicall.length - 2) / 2} bytes in, ${(result.length - 2) / 2} bytes back\n`);

let mismatched = 0;
for (const key of KEYS) {
    const a = perKey[key] ?? "";
    const b = batched[key] ?? "";
    const same = a === b;
    if (!same) mismatched++;

    const shown = b.length > 48 ? `${b.slice(0, 45)}...` : b || "(empty)";
    console.log(`${same ? "ok  " : "FAIL"} ${key.padEnd(20)} ${shown}`);
}

console.log(
    `\n${mismatched === 0 ? "PASS" : "FAIL"}  batched read matches ${KEYS.length - mismatched}/${KEYS.length} keys`,
);
if (mismatched > 0) process.exit(1);
