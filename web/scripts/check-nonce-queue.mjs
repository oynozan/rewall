// Proves the faucet hang was a reentrant mutex and not a slow RPC, against real Sepolia
import { AsyncLocalStorage } from "node:async_hooks";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync("./.env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]] ??= m[2].replace(/^["']|["']$/g, "").trim();
}

const rpc = env.SEPOLIA_RPC_URL || env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const RECEIPT_TIMEOUT = 90_000;

const race = (promise) =>
    Promise.race([promise.then(() => "resolved"), new Promise((r) => setTimeout(() => r("HUNG"), 1500))]);

/* The mutex, before and after */

function oldMutex() {
    let tail = Promise.resolve();
    return (work) => {
        const next = tail.then(work, work);
        tail = next.catch(() => {});
        return next;
    };
}

function newMutex() {
    let tail = Promise.resolve();
    const holding = new AsyncLocalStorage();
    const turn = () => Promise.race([tail, new Promise((r) => setTimeout(r, RECEIPT_TIMEOUT + 15_000).unref())]);
    const serialized = (work) => {
        if (holding.getStore()) return work();
        const run = () => holding.run(true, work);
        const next = turn().then(run, run);
        tail = next.catch(() => {});
        return next;
    };
    return serialized;
}

const before = oldMutex();
console.log("old mutex, nested call      :", await race(before(() => before(async () => 1))));
console.log("old mutex, next call after  :", await race(before(async () => 1)), "  <- the queue is poisoned");

const after = newMutex();
console.log("new mutex, nested call      :", await race(after(() => after(async () => 1))));
console.log("new mutex, next call after  :", await race(after(async () => 1)));

/* The same nesting, now against the real chain */

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc), pollingInterval: 1000 });
const account = privateKeyToAccount(env.REWALL_SPONSOR_KEY);
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
const serialized = newMutex();

const awaitReceipt = (hash) => publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT });

async function sendAll(count) {
    const hashes = await serialized(async () => {
        const first = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
        const sent = [];
        for (let i = 0; i < count; i++) {
            sent.push(await wallet.sendTransaction({ to: account.address, value: 0n, nonce: first + i }));
        }
        return sent;
    });
    return Promise.all(hashes.map(awaitReceipt));
}

console.log(`\nrpc: ${rpc.replace(/\/[A-Za-z0-9_-]{20,}$/, "/<key>")}`);
const block = await publicClient.getBlockNumber();
console.log(`block: ${block}`);

// The exact shape that used to deadlock, an outer serialized wrapping an inner one
const started = process.hrtime.bigint();
const receipts = await serialized(() => sendAll(2));
const seconds = Number(process.hrtime.bigint() - started) / 1e9;

console.log(`two nested sends confirmed in ${seconds.toFixed(1)}s`);
for (const r of receipts) console.log(`  block ${r.blockNumber}  nonce ok  status ${r.status}  ${r.transactionHash}`);
console.log(receipts.every((r) => r.status === "success") ? "\nPASS" : "\nFAIL");
