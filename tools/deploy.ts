// Deploys one PermissionedResolver per participant and the registry tree the owner needs to mint secrets.
// Deployed addresses land in deployments.json because VerifiableFactory reverts on a repeated salt,
// so re-running without that record would collide rather than skip.

import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, encodeFunctionData, keccak256, toBytes, encodeAbiParameters, stringToHex, formatEther } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ETH_REGISTRY, ZERO_ADDRESS, PARTICIPANTS, NAMESPACE_LABEL } from "./participants.ts";

const VERIFIABLE_FACTORY = "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef";
const RESOLVER_IMPL = "0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e";
const USER_REGISTRY_IMPL = "0x624a25d67b59d587752ebec8dded8827dae52050";

const ALL_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111n;
const ROLE_SET_SUBREGISTRY = 1n << 20n;
const ROLE_SET_RESOLVER = 1n << 24n;
const NAME_ROLES = ROLE_SET_SUBREGISTRY | (ROLE_SET_SUBREGISTRY << 128n) | ROLE_SET_RESOLVER | (ROLE_SET_RESOLVER << 128n);

const DEPLOYMENTS = new URL("deployments.json", import.meta.url);

const factoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);
const resolverAbi = parseAbi(["function initialize(address admin, uint256 roleBitmap, bytes[] setters)"]);
const registryAbi = parseAbi([
  "function initialize(address rootAccount, uint256 roleBitmap)",
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "function setResolver(uint256 anyId, address resolver)",
  "function setSubregistry(uint256 anyId, address registry)",
  "function getExpiry(uint256 anyId) view returns (uint64)",
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
]);

/* Setup */

const rpc = process.env.SEPOLIA_RPC_URL;
const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!rpc) throw new Error("SEPOLIA_RPC_URL is not set");
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set, run pnpm run wallets first");

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
if ((await publicClient.getChainId()) !== sepolia.id) throw new Error("refusing to run off Sepolia");

const state = existsSync(DEPLOYMENTS) ? JSON.parse(readFileSync(DEPLOYMENTS, "utf8")) : {};
const save = () => writeFileSync(DEPLOYMENTS, JSON.stringify(state, null, 2) + "\n");

function walletFor(index: number) {
  const account = mnemonicToAccount(mnemonic!, { addressIndex: index });
  const client = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
  return {
    account,
    async send(request: any) {
      const hash = await client.writeContract({ account, chain: sepolia, ...request });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`transaction reverted ${hash}`);
      return receipt;
    },
  };
}

const salt = (kind: string, scope: string) =>
  BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "string" }], [keccak256(stringToHex(kind)), scope])));

async function deployed(address: string | undefined) {
  if (!address) return false;
  const code = await publicClient.getCode({ address: address as `0x${string}` });
  return Boolean(code && code !== "0x");
}

async function deployProxy(send: any, impl: string, kind: string, scope: string, initData: `0x${string}`) {
  const receipt = await send({
    address: VERIFIABLE_FACTORY, abi: factoryAbi, functionName: "deployProxy",
    args: [impl, salt(kind, scope), initData],
  });
  const [event] = parseEventLogs({ abi: factoryAbi, eventName: "ProxyDeployed", logs: receipt.logs });
  if (!event) throw new Error("ProxyDeployed event missing from receipt");
  return { address: event.args.proxyAddress as string, gas: receipt.gasUsed as bigint };
}

/* Resolvers, one per participant */

for (const p of PARTICIPANTS) {
  if (!p.label) continue;

  const { account, send } = walletFor(p.index);
  const entry = (state[p.label] ??= {});

  if (await deployed(entry.resolver)) {
    console.log(`${p.role.padEnd(9)} resolver  ${entry.resolver}  exists`);
  } else {
    const initData = encodeFunctionData({ abi: resolverAbi, functionName: "initialize", args: [account.address, ALL_ROLES, []] });
    const { address, gas } = await deployProxy(send, RESOLVER_IMPL, "rewall.resolver.v1", p.label, initData);
    entry.resolver = address;
    save();
    console.log(`${p.role.padEnd(9)} resolver  ${address}  deployed  gas ${gas}`);
  }

  const labelhash = BigInt(keccak256(toBytes(p.label)));
  const current = await publicClient.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getResolver", args: [p.label] });
  if (current.toLowerCase() !== entry.resolver.toLowerCase()) {
    await send({ address: ETH_REGISTRY, abi: registryAbi, functionName: "setResolver", args: [labelhash, entry.resolver] });
    console.log(`${p.role.padEnd(9)} resolver set on ${p.label}.eth`);
  }
}

/* Registry tree, owner only, because only the owner mints secrets */

const owner = PARTICIPANTS.find((p) => p.role === "owner")!;
const { account, send } = walletFor(owner.index);
const entry = state[owner.label!];
const labelhash = BigInt(keccak256(toBytes(owner.label!)));

if (await deployed(entry.registry)) {
  console.log(`\nowner     registry  ${entry.registry}  exists`);
} else {
  const initData = encodeFunctionData({ abi: registryAbi, functionName: "initialize", args: [account.address, ALL_ROLES] });
  const { address, gas } = await deployProxy(send, USER_REGISTRY_IMPL, "rewall.registry.v1", owner.label!, initData);
  entry.registry = address;
  save();
  console.log(`\nowner     registry  ${address}  deployed  gas ${gas}`);
}

const currentSub = await publicClient.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getSubregistry", args: [owner.label!] });
if (currentSub.toLowerCase() !== entry.registry.toLowerCase()) {
  await send({ address: ETH_REGISTRY, abi: registryAbi, functionName: "setSubregistry", args: [labelhash, entry.registry] });
  console.log(`owner     subregistry set on ${owner.label}.eth`);
}

/* Namespace, the rewall label that holds every secret */

if (await deployed(entry.namespaceRegistry)) {
  console.log(`owner     namespace registry  ${entry.namespaceRegistry}  exists`);
} else {
  const initData = encodeFunctionData({ abi: registryAbi, functionName: "initialize", args: [account.address, ALL_ROLES] });
  const { address, gas } = await deployProxy(send, USER_REGISTRY_IMPL, "rewall.registry.v1", `${NAMESPACE_LABEL}.${owner.label}`, initData);
  entry.namespaceRegistry = address;
  save();
  console.log(`owner     namespace registry  ${address}  deployed  gas ${gas}`);
}

const nsSub = await publicClient.readContract({ address: entry.registry, abi: registryAbi, functionName: "getSubregistry", args: [NAMESPACE_LABEL] });
if (nsSub === ZERO_ADDRESS) {
  const expiry = await publicClient.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getExpiry", args: [labelhash] });
  const receipt = await send({
    address: entry.registry, abi: registryAbi, functionName: "register",
    args: [NAMESPACE_LABEL, account.address, entry.namespaceRegistry, entry.resolver, NAME_ROLES, expiry],
  });
  console.log(`owner     registered ${NAMESPACE_LABEL}.${owner.label}.eth  gas ${receipt.gasUsed}`);
} else {
  console.log(`owner     ${NAMESPACE_LABEL}.${owner.label}.eth already registered`);
}

console.log(`\nowner ETH remaining ${formatEther(await publicClient.getBalance({ address: account.address }))}`);
