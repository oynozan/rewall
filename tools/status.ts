import { createPublicClient, http, parseAbi, formatEther, formatUnits, keccak256, toBytes } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { ETH_REGISTRAR, ETH_REGISTRY, MOCK_USDC, ZERO_ADDRESS, PARTICIPANTS, secretName } from "./participants.ts";

const registryAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getTokenId(uint256 anyId) view returns (uint256)",
  "function getExpiry(uint256 anyId) view returns (uint64)",
  "function getResolver(string label) view returns (address)",
  "function getSubregistry(string label) view returns (address)",
]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const registrarAbi = parseAbi(["function isAvailable(string) view returns (bool)"]);

const rpc = process.env.SEPOLIA_RPC_URL;
const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!rpc) throw new Error("SEPOLIA_RPC_URL is not set");
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set, run pnpm run wallets first");

const client = createPublicClient({ chain: sepolia, transport: http(rpc) });
const read = <T>(p: Promise<T>) => p.then((v) => v as T | null).catch(() => null);
const shown = (a: string | null) => (a && a !== ZERO_ADDRESS ? a : null);

for (const p of PARTICIPANTS) {
  const { address } = mnemonicToAccount(mnemonic, { addressIndex: p.index });
  const eth = await client.getBalance({ address });
  const usdc = await read(client.readContract({ address: MOCK_USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] }));

  console.log(`\n${p.role.toUpperCase()}`);
  console.log(`  address      ${address}`);
  console.log(`  balance      ${formatEther(eth)} ETH  ${usdc === null ? "?" : formatUnits(usdc, 6)} USDC`);

  if (!p.label) {
    console.log(`  name         none by design, read permission is cryptographic`);
    continue;
  }

  const labelhash = BigInt(keccak256(toBytes(p.label)));
  const tokenId = await read(client.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getTokenId", args: [labelhash] }));
  const nameOwner = tokenId === null ? null : await read(client.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "ownerOf", args: [tokenId] }));
  const expiry = await read(client.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getExpiry", args: [labelhash] }));
  const resolver = await read(client.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getResolver", args: [p.label] }));
  const subregistry = await read(client.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getSubregistry", args: [p.label] }));

  console.log(`  name         ${p.label}.eth`);
  console.log(`  held by      ${nameOwner ?? "nobody"}${nameOwner && nameOwner.toLowerCase() === address.toLowerCase() ? "  matches" : nameOwner ? "  MISMATCH" : ""}`);
  console.log(`  expires      ${expiry ? new Date(Number(expiry) * 1000).toISOString().slice(0, 10) : "never"}`);
  console.log(`  resolver     ${shown(resolver) ?? "not set"}`);
  console.log(`  subregistry  ${shown(subregistry) ?? "not set, cannot mint subnames yet"}`);
  console.log(`  secrets go   ${secretName("<secret>", p.label)}`);
}

const projectName = await read(client.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: "isAvailable", args: ["rewall"] }));
console.log(`\nPROJECT NAME\n  rewall.eth   ${projectName === false ? "registered, held for the project and not used in tests" : "AVAILABLE, expected it to be registered"}\n`);
