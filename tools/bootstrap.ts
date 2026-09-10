// Separate from the product loop because commit-reveal costs MIN_COMMITMENT_AGE of real wall clock

import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, formatEther, toHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const ETH_REGISTRAR = "0xa88553f454b77203b0d036a05c894d555eaaa2cc";
const ETH_REGISTRY = "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2";
const MOCK_USDC = "0x768f42455a2d082e23ceef7d51e5787c82d67a39";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

const LABEL = process.env.REWALL_ORG_LABEL ?? "rewall";
const DURATION = 31536000n;

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

/* Setup */

const rpc = process.env.SEPOLIA_RPC_URL;
const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!rpc) throw new Error("SEPOLIA_RPC_URL is not set");
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set, run pnpm run wallets first");

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
const chainId = await publicClient.getChainId();
if (chainId !== sepolia.id) throw new Error(`refusing to run against chain ${chainId}, expected Sepolia ${sepolia.id}`);

const owner = mnemonicToAccount(mnemonic, { addressIndex: 0 });
const wallet = createWalletClient({ account: owner, chain: sepolia, transport: http(rpc) });

async function send(request: any) {
  const hash = await wallet.writeContract({ account: owner, chain: sepolia, ...request });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction reverted ${hash}`);
  return receipt;
}

console.log(`owner ${owner.address}`);
console.log(`label ${LABEL}.eth\n`);

/* Availability */

const available = await publicClient.readContract({
  address: ETH_REGISTRAR, abi: registrarAbi, functionName: "isAvailable", args: [LABEL],
});

if (!available) {
  console.log(`${LABEL}.eth is already registered, nothing to do`);
  process.exit(0);
}

const [base, premium] = await publicClient.readContract({
  address: ETH_REGISTRAR, abi: registrarAbi, functionName: "getRegisterPrice", args: [LABEL, DURATION, MOCK_USDC],
});
const price = base + premium;
console.log(`price ${formatUnits(price, 6)} USDC for ${DURATION / 86400n} days`);

/* Payment */

const balance = await publicClient.readContract({
  address: MOCK_USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner.address],
});
if (balance < price) {
  console.log(`minting ${formatUnits(price - balance, 6)} USDC`);
  await send({ address: MOCK_USDC, abi: erc20Abi, functionName: "mint", args: [owner.address, price - balance] });
}

const allowance = await publicClient.readContract({
  address: MOCK_USDC, abi: erc20Abi, functionName: "allowance", args: [owner.address, ETH_REGISTRAR],
});
// Allowance from a fresh address is zero and register does safeTransferFrom, so this is not optional
if (allowance < price) {
  console.log("approving the registrar");
  await send({ address: MOCK_USDC, abi: erc20Abi, functionName: "approve", args: [ETH_REGISTRAR, price] });
}

/* Commit and reveal */

const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
const fields = [LABEL, owner.address, secret, ZERO_ADDRESS, ZERO_ADDRESS, DURATION] as const;

const commitment = await publicClient.readContract({
  address: ETH_REGISTRAR, abi: registrarAbi, functionName: "makeCommitment", args: [...fields, ZERO_BYTES32],
});

console.log(`committing ${commitment}`);
await send({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: "commit", args: [commitment] });

const minAge = await publicClient.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: "MIN_COMMITMENT_AGE" });
const waitMs = Number(minAge) * 1000 + 15000;
console.log(`waiting ${waitMs / 1000}s for the commitment to mature`);
await new Promise((r) => setTimeout(r, waitMs));

// Every field must match the commitment or this reverts without saying which one differed
console.log("registering");
const receipt = await send({
  address: ETH_REGISTRAR, abi: registrarAbi, functionName: "register",
  args: [...fields, MOCK_USDC, ZERO_BYTES32],
});

console.log(`\nregistered in block ${receipt.blockNumber}`);
console.log(`gas used ${receipt.gasUsed}`);
console.log(`tx https://sepolia.etherscan.io/tx/${receipt.transactionHash}`);
console.log(`owner ETH remaining ${formatEther(await publicClient.getBalance({ address: owner.address }))}`);
