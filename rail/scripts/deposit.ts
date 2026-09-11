/*
 * Deposits into the vault, which is how tokens enter the off chain ledger. The approval is set to
 * the maximum at deploy time, so this only moves tokens and waits for the receipt. The balance
 * appears once the indexer has seen the Deposit event CONFIRMATIONS blocks deep.
 */

import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { DEPLOYER_INDEX, rpcUrl, tokenAddress, vaultAddress } from "../src/config.ts";

const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set");

// Base units, and USDC carries six decimals rather than the eighteen an ether amount would
const amount = BigInt(process.env.DEPOSIT_AMOUNT ?? 10n ** 7n);
const account = mnemonicToAccount(mnemonic, { addressIndex: DEPLOYER_INDEX });

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl()) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl()) });

const vaultAbi = parseAbi(["function deposit(address token, uint256 amount)"]);
const erc20Abi = parseAbi([
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
]);

const token = tokenAddress();
const vault = vaultAddress();
const read = (functionName: "decimals" | "symbol") =>
    publicClient.readContract({ address: token, abi: erc20Abi, functionName });
const [decimals, symbol] = await Promise.all([read("decimals"), read("symbol")]);

const held = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
});
// Nothing here can mint Circle's USDC, so an empty deployer is a funding problem rather than a bug
if (held < amount)
    throw new Error(`${account.address} holds ${formatUnits(held, decimals)} ${symbol}, send it some first`);

const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, vault],
});
if (allowance < amount) throw new Error(`allowance ${allowance} is below ${amount}, redeploy or approve first`);

const hash = await wallet.writeContract({
    address: vault,
    abi: vaultAbi,
    functionName: "deposit",
    args: [token, amount],
    account,
    chain: sepolia,
});

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`deposit reverted ${hash}`);

const vaultHolds = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [vault],
});

console.log(`deposited ${formatUnits(amount, decimals)} ${symbol} in block ${receipt.blockNumber}`);
console.log(`vault now holds ${formatUnits(vaultHolds, decimals)} ${symbol}`);
console.log(`tx ${hash}`);
