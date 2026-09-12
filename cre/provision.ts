/*
 * Registers the enclave as a participant on Sepolia and publishes the key the Vault DON will hold.
 * The scalar is generated rather than derived from a wallet, which SPEC line 41 already allows for
 * parties that cannot sign, and it is written straight into the gitignored .env without being printed.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseAbi, namehash, keccak256, toBytes } from "viem";
import { sepolia } from "viem/chains";
import { deriveIdentity, IDENTITY_TYPED_DATA, toBase64, RECORD } from "@rewall/sdk";
import { publicClient, deployments, byRole, walletFor, readRecords, writeRecords } from "../tools/chain.ts";
import { ZERO_ADDRESS, ETH_REGISTRY } from "../tools/participants.ts";

const PARENT_ROLE = "grantee";
const LABEL = "enclave";

const ROLE_SET_RESOLVER = 1n << 24n;
const NAME_ROLES = ROLE_SET_RESOLVER | (ROLE_SET_RESOLVER << 128n);

const registryAbi = parseAbi([
    "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
    "function getResolver(string label) view returns (address)",
    "function getExpiry(uint256 anyId) view returns (uint64)",
]);

const parent = byRole[PARENT_ROLE]!;
const parentName = `${parent.label}.eth`;
const entry = deployments[parent.label!];
const enclaveName = `${LABEL}.${parentName}`;

/* The enclave identity, generated from a throwaway signer that is discarded on the next line */

const identity = await deriveIdentity(
    await privateKeyToAccount(generatePrivateKey()).signTypedData(IDENTITY_TYPED_DATA),
);

console.log(`enclave     ${enclaveName}`);
console.log(`fingerprint ${identity.fingerprint}`);

/* The subname, pointed at the parent resolver exactly as ci and deploy are */

const configured = await publicClient.readContract({
    address: entry.registry,
    abi: registryAbi,
    functionName: "getResolver",
    args: [LABEL],
});

if (configured === ZERO_ADDRESS) {
    const expiry = await publicClient.readContract({
        address: ETH_REGISTRY,
        abi: registryAbi,
        functionName: "getExpiry",
        args: [BigInt(keccak256(toBytes(parent.label!)))],
    });

    const { account, client } = walletFor(parent.index);
    const hash = await client.writeContract({
        address: entry.registry,
        abi: registryAbi,
        functionName: "register",
        args: [LABEL, account.address, ZERO_ADDRESS, entry.resolver, NAME_ROLES, expiry],
        account,
        chain: sepolia,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`register reverted ${hash}`);
    console.log(`registered  gas ${receipt.gasUsed}  https://sepolia.etherscan.io/tx/${hash}`);
} else {
    console.log(`registered  already exists`);
}

/* The published key, written by the parent because the enclave holds no wallet of its own */

const receipt = await writeRecords(parent.index, enclaveName, [
    { key: RECORD.pubkey, value: toBase64(identity.publicKey) },
]);
console.log(`published   ${RECORD.pubkey}  gas ${receipt.gasUsed}`);

const onChain = await readRecords(enclaveName, [RECORD.pubkey]);
if (onChain[RECORD.pubkey] !== toBase64(identity.publicKey)) throw new Error("published key does not read back");
console.log(`verified    reads back from ${enclaveName}`);

/* The scalar, into the env the simulator loads and nowhere else */

const envPath = new URL("./.env", import.meta.url);
const existing = readFileSync(envPath, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("SECRET_ENCLAVE_SCALAR="));

writeFileSync(
    envPath,
    `${[...existing, `SECRET_ENCLAVE_SCALAR=${Buffer.from(identity.secretKey).toString("hex")}`].join("\n")}\n`,
);
console.log(`scalar      written to .env, not printed`);
