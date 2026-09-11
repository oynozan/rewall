// Proves the project can provision a whole vault that only the user controls, for a user who sends nothing

import {
    createPublicClient,
    createWalletClient,
    http,
    parseAbi,
    encodeFunctionData,
    keccak256,
    toHex,
    toBytes,
    namehash,
    formatEther,
    type Address,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { ownerAddressOf, readTexts, RECORD } from "@rewall/sdk";
import { ETH_REGISTRAR, ETH_REGISTRY, MOCK_USDC, UNIVERSAL_RESOLVER } from "./participants.ts";

const VERIFIABLE_FACTORY = "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef";
const RESOLVER_IMPL = "0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e";
const USER_REGISTRY_IMPL = "0x624a25d67b59d587752ebec8dded8827dae52050";
const ALL_ROLES = BigInt("0x1111111111111111111111111111111111111111111111111111111111111111");
const ROOT_RESOURCE = BigInt(0);
const ADMIN_SHIFT = BigInt(128);
const ROLE_SET_SUBREGISTRY = BigInt(1) << BigInt(20);
const ROLE_SET_RESOLVER = BigInt(1) << BigInt(24);
const NAME_ROLES =
    ROLE_SET_SUBREGISTRY |
    (ROLE_SET_SUBREGISTRY << ADMIN_SHIFT) |
    ROLE_SET_RESOLVER |
    (ROLE_SET_RESOLVER << ADMIN_SHIFT);
const DURATION = BigInt(31536000);
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as const;
const NAMESPACE_LABEL = "rewall";

const factoryAbi = parseAbi([
    "function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)",
]);
const resolverAbi = parseAbi([
    "function initialize(address admin, uint256 roleBitmap, bytes[] setters)",
    "function setText(bytes32 node, string key, string value)",
    "function text(bytes32 node, string key) view returns (string)",
    "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
]);
const registryAbi = parseAbi([
    "function initialize(address rootAccount, uint256 roleBitmap)",
    "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
    "function getSubregistry(string label) view returns (address)",
    "function getResolver(string label) view returns (address)",
    "function getExpiry(uint256 anyId) view returns (uint64)",
    "function grantRootRoles(uint256 roleBitmap, address account) returns (bool)",
    "function revokeRootRoles(uint256 roleBitmap, address account) returns (bool)",
    "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
    "function ownerOf(uint256 tokenId) view returns (address)",
]);
const registrarAbi = parseAbi([
    "function isAvailable(string label) view returns (bool)",
    "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
    "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
    "function commit(bytes32 commitment)",
    "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256 tokenId)",
    "function MIN_COMMITMENT_AGE() view returns (uint256)",
]);
const erc20Abi = parseAbi([
    "function mint(address to, uint256 amount)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address account) view returns (uint256)",
]);

const rpc = process.env.SEPOLIA_RPC_URL;
const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!rpc || !mnemonic) throw new Error("SEPOLIA_RPC_URL and REWALL_TEST_MNEMONIC are required");

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
if ((await publicClient.getChainId()) !== sepolia.id) throw new Error("refusing to run off Sepolia");

// Index 4 is the sponsor the web server holds, index 2 owns nothing and stands in for a newcomer
const project = mnemonicToAccount(mnemonic, { addressIndex: 4 });
const user = mnemonicToAccount(mnemonic, { addressIndex: 2 });
const wallet = createWalletClient({ account: project, chain: sepolia, transport: http(rpc) });

const checks: string[] = [];
const pass = (m: string) => checks.push(`PASS  ${m}`);
const fail = (m: string) => {
    checks.push(`FAIL  ${m}`);
    process.exitCode = 1;
};

async function send(request: Parameters<typeof wallet.writeContract>[0]) {
    const hash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`reverted ${hash}`);
    return receipt;
}

async function deployProxy(impl: string, salt: bigint, initData: `0x${string}`): Promise<Address> {
    const { request, result } = await publicClient.simulateContract({
        address: VERIFIABLE_FACTORY,
        abi: factoryAbi,
        functionName: "deployProxy",
        args: [impl, salt, initData],
        account: project,
    });
    await send({ ...request, chain: sepolia });
    return result as Address;
}

const label = `rw${keccak256(toBytes(`${Date.now()}`)).slice(2, 9)}`;
const node = namehash(`${label}.eth`);
const PUBKEY = "c3BvbnNvcmVkLWlkZW50aXR5LXB1YmxpYy1rZXktMzJi";
const RECOVERY_PUBKEY = "c3BvbnNvcmVkLXJlY292ZXJ5LXB1YmxpYy1rZXktMzJi";

console.log(
    `project ${project.address}  ${formatEther(await publicClient.getBalance({ address: project.address }))} ETH`,
);
console.log(`user    ${user.address}  ${formatEther(await publicClient.getBalance({ address: user.address }))} ETH`);
console.log(`name    ${label}.eth\n`);

const userBefore = await publicClient.getTransactionCount({ address: user.address });

/* Everything the user would otherwise have signed */

const salt = (purpose: string) => BigInt(keccak256(toBytes(`rewall.${purpose}.${label}`)));

const setters = [
    encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [node, RECORD.pubkey, PUBKEY] }),
    encodeFunctionData({
        abi: resolverAbi,
        functionName: "setText",
        args: [node, RECORD.recoveryPubkey, RECOVERY_PUBKEY],
    }),
];
const resolver = await deployProxy(
    RESOLVER_IMPL,
    salt("resolver"),
    encodeFunctionData({ abi: resolverAbi, functionName: "initialize", args: [user.address, ALL_ROLES, setters] }),
);
console.log(`resolver           ${resolver}`);

const registry = await deployProxy(
    USER_REGISTRY_IMPL,
    salt("registry"),
    encodeFunctionData({ abi: registryAbi, functionName: "initialize", args: [project.address, ALL_ROLES] }),
);
console.log(`registry           ${registry}`);

const namespaceRegistry = await deployProxy(
    USER_REGISTRY_IMPL,
    salt("namespace"),
    encodeFunctionData({ abi: registryAbi, functionName: "initialize", args: [user.address, ALL_ROLES] }),
);
console.log(`namespace registry ${namespaceRegistry}\n`);

/* Pay for it */

const [base, premium] = await publicClient.readContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "getRegisterPrice",
    args: [label, DURATION, MOCK_USDC],
});
const price = base + premium;

const usdc = await publicClient.readContract({
    address: MOCK_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [project.address],
});
if (usdc < price)
    await send({
        address: MOCK_USDC,
        abi: erc20Abi,
        functionName: "mint",
        args: [project.address, price - usdc],
        account: project,
        chain: sepolia,
    });

const allowance = await publicClient.readContract({
    address: MOCK_USDC,
    abi: erc20Abi,
    functionName: "allowance",
    args: [project.address, ETH_REGISTRAR],
});
if (allowance < price)
    await send({
        address: MOCK_USDC,
        abi: erc20Abi,
        functionName: "approve",
        args: [ETH_REGISTRAR, price],
        account: project,
        chain: sepolia,
    });

// The resolver and the registry ride along in the commitment, so registering wires both in one call
const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
const commitment = await publicClient.readContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "makeCommitment",
    args: [label, user.address, secret, registry, resolver, DURATION, ZERO_BYTES32],
});
await send({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "commit",
    args: [commitment],
    account: project,
    chain: sepolia,
});

const minAge = await publicClient.readContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "MIN_COMMITMENT_AGE",
});
console.log(`committed, waiting ${Number(minAge) + 15}s`);
await new Promise((r) => setTimeout(r, (Number(minAge) + 15) * 1000));

const registered = await send({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "register",
    args: [label, user.address, secret, registry, resolver, DURATION, MOCK_USDC, ZERO_BYTES32],
    account: project,
    chain: sepolia,
});
console.log(`registered ${label}.eth  gas ${registered.gasUsed}\n`);

/* The namespace, then hand the registry over and step out */

const expiry = await publicClient.readContract({
    address: ETH_REGISTRY,
    abi: registryAbi,
    functionName: "getExpiry",
    args: [BigInt(keccak256(toBytes(label)))],
});
await send({
    address: registry,
    abi: registryAbi,
    functionName: "register",
    args: [NAMESPACE_LABEL, user.address, namespaceRegistry, resolver, NAME_ROLES, expiry],
    account: project,
    chain: sepolia,
});
await send({
    address: registry,
    abi: registryAbi,
    functionName: "grantRootRoles",
    args: [ALL_ROLES, user.address],
    account: project,
    chain: sepolia,
});
await send({
    address: registry,
    abi: registryAbi,
    functionName: "revokeRootRoles",
    args: [ALL_ROLES, project.address],
    account: project,
    chain: sepolia,
});

/* What the user ended up with, read back through the public resolution path */

// Token ids are regenerated on role changes, so ownership is resolved the way the SDK does it
const owner = await ownerAddressOf(publicClient, UNIVERSAL_RESOLVER, `${label}.eth`);
owner.toLowerCase() === user.address.toLowerCase()
    ? pass(`${label}.eth is owned by the user, who paid nothing`)
    : fail(`owner is ${owner}`);

const userAfter = await publicClient.getTransactionCount({ address: user.address });
userAfter === userBefore
    ? pass("the user sent zero transactions for the whole setup")
    : fail(`the user sent ${userAfter - userBefore} transactions`);

const records = await readTexts(publicClient, UNIVERSAL_RESOLVER, `${label}.eth`, [
    RECORD.pubkey,
    RECORD.recoveryPubkey,
]);
records[RECORD.pubkey] === PUBKEY
    ? pass("the identity key resolves through the Universal Resolver")
    : fail(`pubkey read back as ${JSON.stringify(records[RECORD.pubkey])}`);
records[RECORD.recoveryPubkey] === RECOVERY_PUBKEY
    ? pass("the recovery key resolves too, so a secret can name it")
    : fail("recovery pubkey missing");

const nsResolver = await publicClient.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "getResolver",
    args: [NAMESPACE_LABEL],
});
nsResolver.toLowerCase() === resolver.toLowerCase()
    ? pass(`${NAMESPACE_LABEL}.${label}.eth is registered and points at the user's resolver`)
    : fail(`namespace resolver is ${nsResolver}`);

const userRoot = await publicClient.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "hasRoles",
    args: [ROOT_RESOURCE, ALL_ROLES, user.address],
});
const projectRoot = await publicClient.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "hasRoles",
    args: [ROOT_RESOURCE, ALL_ROLES, project.address],
});
userRoot ? pass("the user holds root on their own registry") : fail("the user never received root");
projectRoot
    ? fail("the project kept root on the user's registry, which is a backdoor")
    : pass("the project renounced root, so it can no longer mint under the user's name");

const resolverAdmin = await publicClient.readContract({
    address: resolver,
    abi: resolverAbi,
    functionName: "hasRoles",
    args: [ROOT_RESOURCE, ALL_ROLES, project.address],
});
resolverAdmin
    ? fail("the project holds roles on the user's resolver")
    : pass("the project holds nothing on the resolver either");

console.log(checks.join("\n"));
console.log(`\nproject remaining ${formatEther(await publicClient.getBalance({ address: project.address }))} ETH`);
console.log(`https://sepolia.etherscan.io/name/${label}.eth`);
