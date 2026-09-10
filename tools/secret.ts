import { parseAbi, keccak256, toBytes } from "viem";
import { sepolia } from "viem/chains";
import { planSecret, openSecret, wrapFingerprints, RECORD, SCHEMA_VERSION, NoWrapError } from "@rewall/sdk";
import { ETH_REGISTRY, ZERO_ADDRESS } from "./participants.ts";
import {
    publicClient,
    deployments,
    byRole,
    walletFor,
    identityOf,
    publishedPublicKey,
    secretNameFor,
    readRecords,
    writeRecords,
} from "./chain.ts";

const SECRET_LABEL = process.env.REWALL_SECRET_LABEL ?? "openai";
const PLAINTEXT = "sk-proj-this-is-not-a-real-key-9f3a2b";

const ROLE_SET_SUBREGISTRY = 1n << 20n;
const ROLE_SET_RESOLVER = 1n << 24n;
const NAME_ROLES =
    ROLE_SET_SUBREGISTRY | (ROLE_SET_SUBREGISTRY << 128n) | ROLE_SET_RESOLVER | (ROLE_SET_RESOLVER << 128n);

const registryAbi = parseAbi([
    "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
    "function getResolver(string label) view returns (address)",
    "function getExpiry(uint256 anyId) view returns (uint64)",
]);

const owner = byRole.owner!;
const name = secretNameFor(SECRET_LABEL, owner.label!);
console.log(`secret   ${name}`);

/* Grantee set, public keys read from chain */

const ownerIdentity = await identityOf("owner");
const granteeIdentity = await identityOf("grantee");
const recoveryIdentity = await identityOf("recovery");

const holders = {
    owner: { fingerprint: ownerIdentity.fingerprint, publicKey: await publishedPublicKey("owner") },
    grantee: { fingerprint: granteeIdentity.fingerprint, publicKey: await publishedPublicKey("grantee") },
    recovery: { fingerprint: recoveryIdentity.fingerprint, publicKey: await publishedPublicKey("recovery") },
};
console.log(
    `holders  ${Object.entries(holders)
        .map(([role, h]) => `${role}=${h.fingerprint}`)
        .join("  ")}\n`,
);

/* Register the subname if it is not there yet */

const namespaceRegistry = deployments[owner.label!].namespaceRegistry;
const configured = await publicClient.readContract({
    address: namespaceRegistry,
    abi: registryAbi,
    functionName: "getResolver",
    args: [SECRET_LABEL],
});

if (configured === ZERO_ADDRESS) {
    const parentExpiry = await publicClient.readContract({
        address: ETH_REGISTRY,
        abi: registryAbi,
        functionName: "getExpiry",
        args: [BigInt(keccak256(toBytes(owner.label!)))],
    });
    const { account, client } = walletFor(owner.index);
    const hash = await client.writeContract({
        address: namespaceRegistry,
        abi: registryAbi,
        functionName: "register",
        args: [
            SECRET_LABEL,
            account.address,
            ZERO_ADDRESS,
            deployments[owner.label!].resolver,
            NAME_ROLES,
            parentExpiry,
        ],
        account,
        chain: sepolia,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`register reverted ${hash}`);
    console.log(`registered ${name}  gas ${receipt.gasUsed}`);
} else {
    console.log(`${name} already registered`);
}

/* Create */

const records = await planSecret({
    secretName: name,
    type: "apikey",
    plaintext: new TextEncoder().encode(PLAINTEXT),
    owner: holders.owner,
    recovery: [holders.recovery],
    grantees: [holders.grantee],
    createdAt: Math.floor(Date.now() / 1000),
    allow: ["api.openai.com"],
});

const indexRecord = [{ key: RECORD.index, value: SECRET_LABEL }];
const receipt = await writeRecords(owner.index, name, records);
await writeRecords(owner.index, `${name.split(".").slice(1).join(".")}`, indexRecord);

console.log(`wrote ${records.length} records in one multicall  gas ${receipt.gasUsed}`);
console.log(`tx https://sepolia.etherscan.io/tx/${receipt.transactionHash}\n`);

/* Positive control first, so a broken read path cannot pass as a denial */

const keys = [RECORD.blob, RECORD.version, RECORD.type, ...records.map((r) => r.key)];
const onchain = await readRecords(name, [...new Set(keys)]);

if (onchain[RECORD.version] !== SCHEMA_VERSION) throw new Error(`FAIL bad schema version ${onchain[RECORD.version]}`);

const opened = new TextDecoder().decode(await openSecret(onchain, granteeIdentity, name));
if (opened !== PLAINTEXT) throw new Error("FAIL the grantee decrypted the wrong value");
console.log(`PASS  grantee ${granteeIdentity.fingerprint} read and decrypted the secret`);

const recovered = new TextDecoder().decode(await openSecret(onchain, recoveryIdentity, name));
if (recovered !== PLAINTEXT) throw new Error("FAIL the recovery holder decrypted the wrong value");
console.log(`PASS  recovery ${recoveryIdentity.fingerprint} read and decrypted the secret`);

/* Deny */

const strangerIdentity = await identityOf("stranger");
const present = wrapFingerprints(onchain);

try {
    await openSecret(onchain, strangerIdentity, name);
    throw new Error("FAIL the stranger opened the secret");
} catch (error) {
    if (!(error instanceof NoWrapError)) throw error;
    console.log(
        `PASS  stranger ${strangerIdentity.fingerprint} refused with ${error.name}, ${present.length} wraps present`,
    );
}
