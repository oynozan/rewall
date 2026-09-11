/*
 * Deposits into the vault, which is how tokens enter the off chain ledger. The approval is set to
 * the maximum at deploy time, so this only moves tokens and waits for the receipt. The balance
 * appears once the indexer has seen the Deposit event CONFIRMATIONS blocks deep.
 */

import { createPublicClient, createWalletClient, http, parseAbi, formatEther } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { DEPLOYER_INDEX, rpcUrl, tokenAddress, vaultAddress } from "../src/config.ts";

const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set");

const amount = BigInt(process.env.DEPOSIT_AMOUNT ?? 10n ** 19n);
const account = mnemonicToAccount(mnemonic, { addressIndex: DEPLOYER_INDEX });

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl()) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl()) });

const vaultAbi = parseAbi(["function deposit(address token, uint256 amount)"]);
const erc20Abi = parseAbi([
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
]);

const token = tokenAddress();
const vault = vaultAddress();

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

console.log(`deposited ${formatEther(amount)} in block ${receipt.blockNumber}`);
console.log(`vault now holds ${formatEther(vaultHolds)}`);
console.log(`tx ${hash}`);
