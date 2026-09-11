import { createPublicClient, createWalletClient, http, formatEther, parseEther } from "viem";
import { privateKeyToAccount, mnemonicToAccount, generateMnemonic, english } from "viem/accounts";
import { sepolia } from "viem/chains";
import { readFileSync, writeFileSync } from "node:fs";

const ENV_PATH = new URL(".env", import.meta.url);

// The owner sends nearly every transaction, so it carries most of the balance
const ROLES = [
    { index: 0, name: "owner", target: parseEther("0.01") },
    { index: 1, name: "grantee", target: parseEther("0.002") },
    { index: 2, name: "stranger", target: 0n },
    { index: 3, name: "recovery", target: parseEther("0.001") },
];

/* Mnemonic */

function loadOrCreateMnemonic(): string {
    const existing = process.env.REWALL_TEST_MNEMONIC?.trim();
    if (existing) return existing;

    const phrase = generateMnemonic(english);
    const env = readFileSync(ENV_PATH, "utf8");
    if (!/^REWALL_TEST_MNEMONIC=\s*$/m.test(env)) {
        throw new Error("REWALL_TEST_MNEMONIC line missing or already set in .env, refusing to overwrite");
    }
    // Written straight to disk so the phrase never reaches a shell argument or a log line
    writeFileSync(ENV_PATH, env.replace(/^REWALL_TEST_MNEMONIC=\s*$/m, `REWALL_TEST_MNEMONIC=${phrase}`));
    console.log("generated a new test mnemonic and wrote it to .env");
    return phrase;
}

/* Setup */

const rpc = process.env.SEPOLIA_RPC_URL;
const funderKey = process.env.REWALL_FUNDER_KEY;
if (!rpc) throw new Error("SEPOLIA_RPC_URL is not set");
if (!funderKey) throw new Error("REWALL_FUNDER_KEY is not set");

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });

const chainId = await publicClient.getChainId();
if (chainId !== sepolia.id) throw new Error(`refusing to run against chain ${chainId}, expected Sepolia ${sepolia.id}`);

const funder = privateKeyToAccount(funderKey as `0x${string}`);
const wallet = createWalletClient({ account: funder, chain: sepolia, transport: http(rpc) });

const mnemonic = loadOrCreateMnemonic();
const accounts = ROLES.map((r) => ({ ...r, account: mnemonicToAccount(mnemonic, { addressIndex: r.index }) }));

/* Funding */

const funderBalance = await publicClient.getBalance({ address: funder.address });
console.log(`\nfunder   ${funder.address}  ${formatEther(funderBalance)} ETH\n`);

// Testnet ETH is finite in practice, so a role sitting well above its target hands the surplus back first
const gasPrice = await publicClient.getGasPrice();
const sendCost = gasPrice * 21000n * 2n;

for (const a of accounts) {
    const balance = await publicClient.getBalance({ address: a.account.address });
    const surplus = balance > a.target * 2n ? balance - a.target - sendCost : 0n;
    if (surplus <= 0n) continue;

    const role = createWalletClient({ account: a.account, chain: sepolia, transport: http(rpc) });
    const hash = await role.sendTransaction({ to: funder.address, value: surplus });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`${a.name.padEnd(9)}returned ${formatEther(surplus)} ETH  ${hash}`);
}

// What is actually short, not the sum of targets, or a rerun refuses over balances already funded
const available = await publicClient.getBalance({ address: funder.address });
const balances = await Promise.all(accounts.map((a) => publicClient.getBalance({ address: a.account.address })));
const needed = accounts.reduce((sum, a, i) => sum + (a.target > balances[i]! ? a.target - balances[i]! : 0n), 0n);
if (available < needed) {
    throw new Error(
        `funder holds ${formatEther(available)} ETH but ${formatEther(needed)} ETH is short, top it up from a faucet`,
    );
}

for (const [index, a] of accounts.entries()) {
    const balance = balances[index]!;
    const short = a.target > balance ? a.target - balance : 0n;

    if (short === 0n) {
        console.log(`${a.name.padEnd(9)}${a.account.address}  ${formatEther(balance)} ETH  funded`);
        continue;
    }

    const hash = await wallet.sendTransaction({ to: a.account.address, value: short });
    await publicClient.waitForTransactionReceipt({ hash });
    const after = await publicClient.getBalance({ address: a.account.address });
    console.log(
        `${a.name.padEnd(9)}${a.account.address}  ${formatEther(after)} ETH  sent ${formatEther(short)}  ${hash}`,
    );
}

console.log(`\nfunder remaining ${formatEther(await publicClient.getBalance({ address: funder.address }))} ETH`);
