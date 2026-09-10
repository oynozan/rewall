import { createPublicClient, createWalletClient, http, parseAbi, namehash, keccak256, toBytes } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import {
    deriveIdentity,
    randomDek,
    encrypt,
    decrypt,
    seal,
    unseal,
    toBase64,
    fromBase64,
    buildSecretRecords,
    encodeSetTextCalls,
    readTexts,
    resolverFor,
    IDENTITY_MESSAGE,
    RECORD,
    resolverAbi,
    type Identity,
} from "@rewall/sdk";
import { ETH_REGISTRY, ZERO_ADDRESS, PARTICIPANTS, NAMESPACE_LABEL, UNIVERSAL_RESOLVER } from "./participants.ts";

const SECRET_LABEL = process.env.REWALL_SECRET_LABEL ?? "openai";
const PLAINTEXT = "sk-proj-this-is-not-a-real-key-9f3a2b";
const ROLE_SET_SUBREGISTRY = 1n << 20n;
const ROLE_SET_RESOLVER = 1n << 24n;
const NAME_ROLES =
    ROLE_SET_SUBREGISTRY | (ROLE_SET_SUBREGISTRY << 128n) | ROLE_SET_RESOLVER | (ROLE_SET_RESOLVER << 128n);

const registryAbi = parseAbi([
    "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
    "function getSubregistry(string label) view returns (address)",
    "function getResolver(string label) view returns (address)",
    "function getExpiry(uint256 anyId) view returns (uint64)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function getTokenId(uint256 anyId) view returns (uint256)",
]);

const rpc = process.env.SEPOLIA_RPC_URL;
const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!rpc) throw new Error("SEPOLIA_RPC_URL is not set");
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set");

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
if ((await publicClient.getChainId()) !== sepolia.id) throw new Error("refusing to run off Sepolia");

const state = JSON.parse(readFileSync(new URL("deployments.json", import.meta.url), "utf8"));
const byRole = Object.fromEntries(PARTICIPANTS.map((p) => [p.role, p]));

async function identityFor(index: number): Promise<Identity> {
    const account = mnemonicToAccount(mnemonic!, { addressIndex: index });
    return deriveIdentity(await account.signMessage({ message: IDENTITY_MESSAGE }));
}

const owner = byRole.owner!;
const ownerAccount = mnemonicToAccount(mnemonic, { addressIndex: owner.index });
const ownerWallet = createWalletClient({ account: ownerAccount, chain: sepolia, transport: http(rpc) });

const namespaceName = `${NAMESPACE_LABEL}.${owner.label}.eth`;
const secretFullName = `${SECRET_LABEL}.${namespaceName}`;
const namespaceRegistry = state[owner.label!].namespaceRegistry;

console.log(`secret   ${secretFullName}`);

/* Grantees, read from chain rather than derived locally, which is how a real client finds them */

const ownerIdentity = await identityFor(owner.index);
const grantees: { role: string; fingerprint: string; publicKey: Uint8Array }[] = [
    { role: "owner", fingerprint: ownerIdentity.fingerprint, publicKey: ownerIdentity.publicKey },
];

for (const role of ["grantee", "recovery"]) {
    const p = byRole[role]!;
    const records = await readTexts(publicClient, UNIVERSAL_RESOLVER, `${p.label}.eth`, [RECORD.pubkey]);
    const encoded = records[RECORD.pubkey];
    if (!encoded) throw new Error(`${p.label}.eth has no ${RECORD.pubkey}, run pnpm run identity first`);
    const publicKey = fromBase64(encoded);
    const identity = await identityFor(p.index);
    grantees.push({ role, fingerprint: identity.fingerprint, publicKey });
}

console.log(`grantees ${grantees.map((g) => `${g.role}=${g.fingerprint}`).join("  ")}\n`);

/* Register the secret subname */

const existingOwner = await publicClient.readContract({
    address: namespaceRegistry,
    abi: registryAbi,
    functionName: "getResolver",
    args: [SECRET_LABEL],
});

if (existingOwner === ZERO_ADDRESS) {
    const parentExpiry = await publicClient.readContract({
        address: ETH_REGISTRY,
        abi: registryAbi,
        functionName: "getExpiry",
        args: [BigInt(keccak256(toBytes(owner.label!)))],
    });
    const hash = await ownerWallet.writeContract({
        address: namespaceRegistry,
        abi: registryAbi,
        functionName: "register",
        args: [
            SECRET_LABEL,
            ownerAccount.address,
            ZERO_ADDRESS,
            state[owner.label!].resolver,
            NAME_ROLES,
            parentExpiry,
        ],
        account: ownerAccount,
        chain: sepolia,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`register reverted ${hash}`);
    console.log(`registered ${secretFullName}  gas ${receipt.gasUsed}`);
} else {
    console.log(`${secretFullName} already registered`);
}

/* Encrypt, wrap, write */

const dek = randomDek();
const blob = await encrypt(new TextEncoder().encode(PLAINTEXT), dek);
const wraps = await Promise.all(
    grantees.map(async (g) => ({ fingerprint: g.fingerprint, wrapped: toBase64(await seal(dek, g.publicKey)) })),
);

const records = buildSecretRecords({
    type: "apikey",
    blob: toBase64(blob),
    wraps,
    createdAt: Math.floor(Date.now() / 1000),
    allow: ["api.openai.com"],
});

// Looked up rather than read from deployments.json, because the owner could have repointed the name
const resolver = await resolverFor(publicClient, UNIVERSAL_RESOLVER, secretFullName);
if (!resolver) throw new Error(`no resolver configured for ${secretFullName}`);

const node = namehash(secretFullName);
const indexCall = encodeSetTextCalls(namehash(namespaceName), [{ key: RECORD.index, value: SECRET_LABEL }]);
const writeHash = await ownerWallet.writeContract({
    address: resolver,
    abi: resolverAbi,
    functionName: "multicall",
    args: [[...encodeSetTextCalls(node, records), ...indexCall]],
    account: ownerAccount,
    chain: sepolia,
});
const writeReceipt = await publicClient.waitForTransactionReceipt({ hash: writeHash });
if (writeReceipt.status !== "success") throw new Error(`write reverted ${writeHash}`);
console.log(`wrote ${records.length + 1} records in one multicall  gas ${writeReceipt.gasUsed}`);
console.log(`tx https://sepolia.etherscan.io/tx/${writeReceipt.transactionHash}\n`);

/* Positive control, the grantee reads and decrypts */

const granteeIdentity = await identityFor(byRole.grantee!.index);
const wanted = [RECORD.blob, RECORD.version, RECORD.type, RECORD.wrap(granteeIdentity.fingerprint)];
const read = await readTexts(publicClient, UNIVERSAL_RESOLVER, secretFullName, wanted);

if (read[RECORD.version] !== "1") throw new Error(`FAIL bad schema version ${read[RECORD.version]}`);
const granteeWrap = read[RECORD.wrap(granteeIdentity.fingerprint)];
if (!granteeWrap) throw new Error("FAIL grantee has no wrap");

const granteeDek = await unseal(fromBase64(granteeWrap), granteeIdentity.publicKey, granteeIdentity.secretKey);
const recovered = new TextDecoder().decode(await decrypt(fromBase64(read[RECORD.blob]!), granteeDek));
if (recovered !== PLAINTEXT) throw new Error("FAIL grantee decrypted the wrong value");
console.log(`PASS  grantee ${granteeIdentity.fingerprint} read and decrypted the secret`);

/* Negative, the stranger cannot */

const strangerIdentity = await identityFor(byRole.stranger!.index);
const allWrapKeys = grantees.map((g) => RECORD.wrap(g.fingerprint));
const strangerView = await readTexts(publicClient, UNIVERSAL_RESOLVER, secretFullName, [
    RECORD.wrap(strangerIdentity.fingerprint),
    ...allWrapKeys,
]);

if (strangerView[RECORD.wrap(strangerIdentity.fingerprint)]) {
    throw new Error("FAIL a wrap exists for the stranger");
}

let opened = 0;
for (const key of allWrapKeys) {
    const wrapped = strangerView[key];
    if (!wrapped) continue;
    try {
        await unseal(fromBase64(wrapped), strangerIdentity.publicKey, strangerIdentity.secretKey);
        opened++;
    } catch {
        // expected, the stranger holds no key any of these were sealed to
    }
}
if (opened > 0) throw new Error(`FAIL the stranger opened ${opened} wraps`);
console.log(`PASS  stranger ${strangerIdentity.fingerprint} has no wrap and opened none of ${allWrapKeys.length}`);

console.log(`\nowner ETH remaining ${await publicClient.getBalance({ address: ownerAccount.address })}`);
