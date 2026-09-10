// Separate from the product loop because commit-reveal costs MIN_COMMITMENT_AGE of real wall clock

import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, toHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { ETH_REGISTRAR, MOCK_USDC, ZERO_ADDRESS, ZERO_BYTES32, PARTICIPANTS } from "./participants.ts";

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

/* Commit */

const pending = [];

for (const p of PARTICIPANTS) {
  if (!p.label) continue;

  const { account, send } = walletFor(p.index);
  const available = await publicClient.readContract({
    address: ETH_REGISTRAR, abi: registrarAbi, functionName: "isAvailable", args: [p.label],
  });

  if (!available) {
    console.log(`${p.label}.eth already registered, skipping`);
    continue;
  }

  const [base, premium] = await publicClient.readContract({
    address: ETH_REGISTRAR, abi: registrarAbi, functionName: "getRegisterPrice", args: [p.label, DURATION, MOCK_USDC],
  });
  const price = base + premium;

  const balance = await publicClient.readContract({
    address: MOCK_USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
  });
  if (balance < price) {
    await send({ address: MOCK_USDC, abi: erc20Abi, functionName: "mint", args: [account.address, price - balance] });
  }

  const allowance = await publicClient.readContract({
    address: MOCK_USDC, abi: erc20Abi, functionName: "allowance", args: [account.address, ETH_REGISTRAR],
  });
  // Allowance from a fresh address is zero and register does safeTransferFrom, so this is not optional
  if (allowance < price) {
    await send({ address: MOCK_USDC, abi: erc20Abi, functionName: "approve", args: [ETH_REGISTRAR, price] });
  }

  const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const fields = [p.label, account.address, secret, ZERO_ADDRESS, ZERO_ADDRESS, DURATION] as const;
  const commitment = await publicClient.readContract({
    address: ETH_REGISTRAR, abi: registrarAbi, functionName: "makeCommitment", args: [...fields, ZERO_BYTES32],
  });

  await send({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: "commit", args: [commitment] });
  console.log(`${p.role.padEnd(9)} ${p.label}.eth  committed  ${formatUnits(price, 6)} USDC`);
  pending.push({ ...p, fields, send });
}

if (pending.length === 0) {
  console.log("\nnothing to register");
  process.exit(0);
}

/* Reveal */

// Commitments stay valid for MAX_COMMITMENT_AGE, so all of them share one wait
const minAge = await publicClient.readContract({ address: ETH_REGISTRAR, abi: registrarAbi, functionName: "MIN_COMMITMENT_AGE" });
const waitMs = Number(minAge) * 1000 + 15000;
console.log(`\nwaiting ${waitMs / 1000}s for ${pending.length} commitment(s) to mature`);
await new Promise((r) => setTimeout(r, waitMs));

for (const p of pending) {
  // Every field must match the commitment or this reverts without saying which one differed
  const receipt = await p.send({
    address: ETH_REGISTRAR, abi: registrarAbi, functionName: "register",
    args: [...p.fields, MOCK_USDC, ZERO_BYTES32],
  });
  console.log(`${p.role.padEnd(9)} ${p.label}.eth  registered  block ${receipt.blockNumber}  gas ${receipt.gasUsed}`);
  console.log(`          https://sepolia.etherscan.io/tx/${receipt.transactionHash}`);
}
