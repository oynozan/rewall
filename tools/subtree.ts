import { parseAbi, encodeFunctionData, keccak256, toBytes } from "viem";
import { sepolia } from "viem/chains";
import { writeFileSync } from "node:fs";
import {
    deriveSubtreeKey,
    sealSubtreeKey,
    openSubtreeKey,
    planGrant,
    openSecret,
    toBase64,
    fromBase64,
    RECORD,
    NoWrapError,
} from "@rewall/sdk";
import { ETH_REGISTRY, ZERO_ADDRESS, SUBTREE_PARENT_ROLE, SUBTREE_MEMBERS } from "./participants.ts";
import {
    publicClient,
    deployments,
    byRole,
    walletFor,
    identityFor,
    identityOf,
    secretNameFor,
    readRecords,
    writeRecords,
} from "./chain.ts";

const SECRET_LABEL = process.env.REWALL_SECRET_LABEL ?? "openai";
const VERIFIABLE_FACTORY = "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef";
const USER_REGISTRY_IMPL = "0x624a25d67b59d587752ebec8dded8827dae52050";
const ALL_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111n;
const ROLE_SET_RESOLVER = 1n << 24n;
const NAME_ROLES = ROLE_SET_RESOLVER | (ROLE_SET_RESOLVER << 128n);

const factoryAbi = parseAbi([
    "function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)",
    "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);
const registryAbi = parseAbi([
    "function initialize(address rootAccount, uint256 roleBitmap)",
    "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
    "function setSubregistry(uint256 anyId, address registry)",
    "function getSubregistry(string label) view returns (address)",
    "function getResolver(string label) view returns (address)",
    "function getExpiry(uint256 anyId) view returns (uint64)",
]);

const parent = byRole[SUBTREE_PARENT_ROLE]!;
const parentName = `${parent.label}.eth`;
const parentEntry = deployments[parent.label!];
const { account: parentAccount, client: parentClient } = walletFor(parent.index);

const save = () =>
    writeFileSync(new URL("deployments.json", import.meta.url), JSON.stringify(deployments, null, 2) + "\n");

const send = async (request: any) => {
    const hash = await parentClient.writeContract({ account: parentAccount, chain: sepolia, ...request });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction reverted ${hash}`);
    return receipt;
};

console.log(`subtree parent  ${parentName}\n`);

/* A registry, so the parent can mint subnames at all */

const parentLabelhash = BigInt(keccak256(toBytes(parent.label!)));

if (!parentEntry.registry) {
    const initData = encodeFunctionData({
        abi: registryAbi,
        functionName: "initialize",
        args: [parentAccount.address, ALL_ROLES],
    });
    const receipt = await send({
        address: VERIFIABLE_FACTORY,
        abi: factoryAbi,
        functionName: "deployProxy",
        args: [USER_REGISTRY_IMPL, BigInt(keccak256(toBytes(`rewall.registry.v1:${parent.label}`))), initData],
    });
    const log = receipt.logs.find(
        (l: any) => l.topics[0] === keccak256(toBytes("ProxyDeployed(address,address,uint256,address)")),
    );
    parentEntry.registry = `0x${log!.topics[2]!.slice(26)}`;
    save();
    console.log(`registry        ${parentEntry.registry}  deployed  gas ${receipt.gasUsed}`);
} else {
    console.log(`registry        ${parentEntry.registry}  exists`);
}

const currentSub = await publicClient.readContract({
    address: ETH_REGISTRY,
    abi: registryAbi,
    functionName: "getSubregistry",
    args: [parent.label!],
});
if (currentSub.toLowerCase() !== parentEntry.registry.toLowerCase()) {
    await send({
        address: ETH_REGISTRY,
        abi: registryAbi,
        functionName: "setSubregistry",
        args: [parentLabelhash, parentEntry.registry],
    });
    console.log(`subregistry     set on ${parentName}`);
}

/* Members, each a real subname pointed at the parent resolver */

const parentExpiry = await publicClient.readContract({
    address: ETH_REGISTRY,
    abi: registryAbi,
    functionName: "getExpiry",
    args: [parentLabelhash],
});

for (const m of SUBTREE_MEMBERS) {
    const configured = await publicClient.readContract({
        address: parentEntry.registry,
        abi: registryAbi,
        functionName: "getResolver",
        args: [m.label],
    });
    if (configured !== ZERO_ADDRESS) {
        console.log(`member          ${m.label}.${parentName} exists`);
        continue;
    }
    const receipt = await send({
        address: parentEntry.registry,
        abi: registryAbi,
        functionName: "register",
        args: [m.label, parentAccount.address, ZERO_ADDRESS, parentEntry.resolver, NAME_ROLES, parentExpiry],
    });
    console.log(`member          ${m.label}.${parentName} registered  gas ${receipt.gasUsed}`);
}

/* Publish the subtree public key and distribute the private half */

const parentIdentity = await identityOf(SUBTREE_PARENT_ROLE);
const published = await readRecords(parentName, [RECORD.subtreeVersion, RECORD.subtreePubkey]);
const version = Number(published[RECORD.subtreeVersion] || 0);
const subtree = await deriveSubtreeKey(parentIdentity, version);

console.log(`\nsubtree key     version ${version}  fingerprint ${subtree.fingerprint}`);

if (published[RECORD.subtreePubkey] !== toBase64(subtree.publicKey)) {
    await writeRecords(parent.index, parentName, [
        { key: RECORD.subtreePubkey, value: toBase64(subtree.publicKey) },
        { key: RECORD.subtreeVersion, value: String(version) },
    ]);
    console.log(`                published on ${parentName}`);
}

for (const m of SUBTREE_MEMBERS) {
    const memberName = `${m.label}.${parentName}`;
    const memberIdentity = await identityFor(m.index);

    // Both records are written by the parent, while the values come from the member's own wallet signature
    await writeRecords(parent.index, memberName, [
        { key: RECORD.pubkey, value: toBase64(memberIdentity.publicKey) },
        { key: RECORD.subtreeKey, value: await sealSubtreeKey(subtree, memberIdentity.publicKey) },
    ]);
    console.log(`                sealed to ${memberName}  ${memberIdentity.fingerprint}`);
}

/* The owner grants a secret to the subtree, not to any individual member */

const owner = byRole.owner!;
const ownerIdentity = await identityOf("owner");
const secret = secretNameFor(SECRET_LABEL, owner.label!);

const parentPublished = await readRecords(parentName, [RECORD.subtreePubkey]);
const subtreePublicKey = fromBase64(parentPublished[RECORD.subtreePubkey]!);

const secretKeys = [RECORD.blob, RECORD.wrap(ownerIdentity.fingerprint), RECORD.wrap(subtree.fingerprint)];
const before = await readRecords(secret, secretKeys);
if (!before[RECORD.blob]) throw new Error(`${secret} has no blob, run pnpm run secret first`);

if (!before[RECORD.wrap(subtree.fingerprint)]) {
    const grant = await planGrant(before, ownerIdentity, {
        fingerprint: subtree.fingerprint,
        publicKey: subtreePublicKey,
    });
    const receipt = await writeRecords(owner.index, secret, grant);
    console.log(`\ngranted         ${secret} to the subtree  gas ${receipt.gasUsed}`);
} else {
    console.log(`\ngranted         ${secret} already wrapped to the subtree`);
}

/* A member reads it using only what is on chain plus its own wallet */

const records = await readRecords(secret, [...secretKeys, RECORD.wrap(subtree.fingerprint)]);

for (const m of SUBTREE_MEMBERS) {
    const memberName = `${m.label}.${parentName}`;
    const memberIdentity = await identityFor(m.index);

    const held = await readRecords(memberName, [RECORD.subtreeKey]);
    const subtreeHeld = await openSubtreeKey(held[RECORD.subtreeKey]!, memberIdentity);

    const plaintext = new TextDecoder().decode(await openSecret(records, [memberIdentity, subtreeHeld], secret));
    if (!plaintext.startsWith("sk-proj-")) throw new Error(`FAIL ${memberName} decrypted the wrong value`);
    console.log(`PASS  ${memberName} read the secret through the subtree key`);
}

/* Someone outside the subtree still cannot */

const strangerIdentity = await identityOf("stranger");
try {
    await openSecret(records, strangerIdentity, secret);
    throw new Error("FAIL the stranger opened a subtree granted secret");
} catch (error) {
    if (!(error instanceof NoWrapError)) throw error;
    console.log(`PASS  stranger outside the subtree refused with ${error.name}`);
}
