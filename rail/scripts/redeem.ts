/*
 * Redeems a withdraw ticket against the vault. This is the only leg that costs gas and the only one
 * that proves the off chain signer and the on chain vault agree, since the vault recovers the
 * signature itself and refuses any ticket it did not issue.
 */

import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { REDEEMER_INDEX, rpcUrl, tokenAddress, vaultAddress } from "../src/config.ts";

const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set");

const ticket = (process.env.TICKET ?? process.argv[2]) as Hex;
// Base units, and USDC carries six decimals rather than the eighteen an ether amount would
const amount = BigInt(process.env.WITHDRAW_AMOUNT ?? process.argv[3] ?? 10n ** 6n);
if (!ticket) throw new Error("pass the ticket as TICKET or the first argument");

const account = mnemonicToAccount(mnemonic, { addressIndex: REDEEMER_INDEX });
const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl()) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl()) });

const vaultAbi = parseAbi(["function withdrawWithTicket(address token, uint256 amount, bytes ticket)"]);
const erc20Abi = parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
]);

const token = tokenAddress();
const balanceOf = () =>
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
const [decimals, symbol] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
]);

const before = await balanceOf();

const hash = await wallet.writeContract({
    address: vaultAddress(),
    abi: vaultAbi,
    functionName: "withdrawWithTicket",
    args: [token, amount, ticket],
    account,
    chain: sepolia,
});

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`withdrawWithTicket reverted ${hash}`);

console.log(`redeemed in ${hash}`);
console.log(
    `${account.address} holds ${formatUnits(before, decimals)} to ${formatUnits(await balanceOf(), decimals)} ${symbol}`,
);
