import { createPublicClient, http, parseAbi, formatEther, formatUnits, keccak256, toBytes } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const ETH_REGISTRAR = "0xa88553f454b77203b0d036a05c894d555eaaa2cc";
const ETH_REGISTRY = "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2";
const MOCK_USDC = "0x768f42455a2d082e23ceef7d51e5787c82d67a39";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const LABEL = process.env.REWALL_ORG_LABEL ?? "rewall";
const ROLES = ["owner", "grantee", "stranger", "recovery"];

const registryAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getTokenId(uint256 anyId) view returns (uint256)",
  "function getExpiry(uint256 anyId) view returns (uint64)",
  "function getResolver(string label) view returns (address)",
  "function getSubregistry(string label) view returns (address)",
]);

const rpc = process.env.SEPOLIA_RPC_URL;
const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!rpc) throw new Error("SEPOLIA_RPC_URL is not set");
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set, run pnpm run wallets first");

const client = createPublicClient({ chain: sepolia, transport: http(rpc) });
const read = <T>(p: Promise<T>) => p.then((v) => v as T | null).catch(() => null);
const shown = (a: string | null) => (a && a !== ZERO_ADDRESS ? a : null);

/* Identities */

console.log("\nIDENTITIES");
for (const [i, name] of ROLES.entries()) {
  const { address } = mnemonicToAccount(mnemonic, { addressIndex: i });
  const eth = await client.getBalance({ address });
  const usdc = await read(client.readContract({
    address: MOCK_USDC, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf", args: [address],
  }));
  console.log(`  ${name.padEnd(9)} ${address}  ${formatEther(eth).padEnd(22)} ETH  ${usdc === null ? "?" : formatUnits(usdc, 6)} USDC`);
}

/* Org name */

const labelhash = BigInt(keccak256(toBytes(LABEL)));
const tokenId = await read(client.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getTokenId", args: [labelhash] }));
const nameOwner = tokenId === null ? null : await read(client.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "ownerOf", args: [tokenId] }));
const expiry = await read(client.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getExpiry", args: [labelhash] }));
const resolver = await read(client.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getResolver", args: [LABEL] }));
const subregistry = await read(client.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getSubregistry", args: [LABEL] }));
const available = await read(client.readContract({
  address: ETH_REGISTRAR, abi: parseAbi(["function isAvailable(string) view returns (bool)"]), functionName: "isAvailable", args: [LABEL],
}));

console.log(`\nORG NAME  ${LABEL}.eth`);
console.log(`  available    ${available}`);
console.log(`  owner        ${nameOwner ?? "none"}`);
console.log(`  tokenId      ${tokenId ?? "none"}`);
console.log(`  expires      ${expiry ? new Date(Number(expiry) * 1000).toISOString() : "none"}`);
console.log(`  resolver     ${shown(resolver) ?? "not set"}`);
console.log(`  subregistry  ${shown(subregistry) ?? "not set, cannot mint subnames yet"}`);
console.log(`\n  explorer     https://sepolia.etherscan.io/address/${nameOwner ?? ETH_REGISTRY}\n`);
