/*
 * Checks that a private transfer is actually private rather than assuming it. Three claims are
 * tested against the chain and the rail. A private transfer leaves no trace on chain, a shielded
 * address cannot be linked to its owner by anything on chain, and one account cannot read another
 * account's ledger through the API. Deposits and withdrawals are public by design and are counted
 * rather than treated as leaks, which is why this reports semi confidential and not anonymous.
 */

import { createPublicClient, http, parseAbiItem, formatEther, getAddress } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { TRANSFER_FIELDS, Transfers, transferDomain } from "@rewall/sdk";
import { DEPLOYER_INDEX, REDEEMER_INDEX, PORT, rpcUrl, tokenAddress, vaultAddress } from "../src/config.ts";

const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set");

const api = process.env.RAIL_API ?? `http://127.0.0.1:${PORT}`;
const token = tokenAddress();
const vault = vaultAddress();
const fromBlock = BigInt(process.env.FROM_BLOCK ?? 0);

const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl()) });

const walletFor = (index: number) => mnemonicToAccount(mnemonic, { addressIndex: index });
const railFor = (index: number) => new Transfers({ account: walletFor(index), api, vault });

const payer = walletFor(DEPLOYER_INDEX);
const payee = walletFor(REDEEMER_INDEX);
// Any wallet nobody granted anything to, which is what an outsider looks like
const outsider = walletFor(2);

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const DEPOSIT = parseAbiItem("event Deposit(address indexed user, address indexed token, uint256 amount)");
const WITHDRAW = parseAbiItem(
    "event Withdraw(address indexed user, address indexed token, uint256 amount, bytes32 indexed withdrawTicketHash)",
);

const head = await client.getBlockNumber();
const start = fromBlock > 0n ? fromBlock : head - 45_000n;
console.log(`scanning blocks ${start} to ${head} against ${api}\n`);

let failures = 0;
const report = (claim: string, passed: boolean, detail: string) => {
    if (!passed) failures++;
    console.log(`  => ${passed ? "PASS" : "FAIL"}, ${detail}\n`);
};

/* Claim 1, private transfers leave no trace on chain */

const ledger = (await railFor(DEPLOYER_INDEX).transactions(50)).transactions as { type: string }[];
const offchain = ledger.filter((t) => t.type === "transfer_out" || t.type === "transfer_in").length;

const transfers = await client.getLogs({ address: token, event: TRANSFER, fromBlock: start, toBlock: head });
const deposits = await client.getLogs({ address: vault, event: DEPOSIT, fromBlock: start, toBlock: head });
const withdrawals = await client.getLogs({ address: vault, event: WITHDRAW, fromBlock: start, toBlock: head });

// Only movement through the vault can say anything about a private transfer, a mint cannot
const throughVault = transfers.filter((log) => {
    const { from, to } = log.args as { from: string; to: string };
    return from.toLowerCase() === vault.toLowerCase() || to.toLowerCase() === vault.toLowerCase();
});

console.log("claim 1, private transfers leave no trace on chain");
console.log(`  private transfers in the ledger    ${offchain}`);
console.log(`  Deposit events on chain            ${deposits.length}`);
console.log(`  Withdraw events on chain           ${withdrawals.length}`);
console.log(`  token movements through the vault  ${throughVault.length}`);
const unexplained = throughVault.length - (deposits.length + withdrawals.length);
report("no trace", unexplained === 0, `${offchain} private transfers moved no tokens through the vault`);

/* Claim 2, a shielded address is not linkable on chain */

const shielded = getAddress(await railFor(REDEEMER_INDEX).shieldedAddress());
const [code, balance, nonce] = await Promise.all([
    client.getCode({ address: shielded }),
    client.getBalance({ address: shielded }),
    client.getTransactionCount({ address: shielded }),
]);
const appears = transfers.some((log) => {
    const { from, to } = log.args as { from: string; to: string };
    return from.toLowerCase() === shielded.toLowerCase() || to.toLowerCase() === shielded.toLowerCase();
});

console.log("claim 2, a shielded address is not linkable on chain");
console.log(`  shielded address   ${shielded}`);
console.log(`  owned off chain by ${payee.address}`);
console.log(`  code ${code ?? "0x"}, balance ${formatEther(balance)} ETH, nonce ${nonce}`);
report("unlinkable", !appears && nonce === 0 && balance === 0n, "nothing on chain ties it to its owner");

/* Claim 3, one account cannot read another account's ledger */

const timestamp = Math.floor(Date.now() / 1000);
const forged = await outsider.signTypedData({
    domain: transferDomain(vault),
    types: { "Retrieve Balances": TRANSFER_FIELDS["Retrieve Balances"] },
    primaryType: "Retrieve Balances",
    message: { account: payer.address, timestamp: BigInt(timestamp) },
});
const response = await fetch(`${api}/balances`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: payer.address, timestamp, auth: forged }),
});

console.log("claim 3, one account cannot read another account's ledger");
console.log(`  ${outsider.address} claiming to be ${payer.address}`);
console.log(`  response ${response.status} ${JSON.stringify(await response.json())}`);
report("no cross reads", response.status === 401, "the signature must match the claimed account");

console.log(failures === 0 ? "all claims hold" : `${failures} claim(s) failed`);
process.exit(failures === 0 ? 0 : 1);
