// Registers the ENS subnames the examples write to. Run this once before the numbered examples.
// Each secret has to exist as a real subname before any record can be written under it.

import { createPublicClient, createWalletClient, http, parseAbi, keccak256, toBytes } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { connect, PEOPLE } from "./rewall.ts";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const ETH_REGISTRY = "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2";
const ZERO = "0x0000000000000000000000000000000000000000";

// Alice's registry for names under rewall.rewall-test-1.eth, and the resolver holding her records
const NAMESPACE_REGISTRY = "0xC2aF679BAC5d8314543aA1672e3730634Ab059cD";
const ALICE_RESOLVER = "0x1A0578825afDf388F5107117F81A57375cf7060f";

const LABELS = ["database", "stripe-key", "deploy-token", "team-secret", "lost-wallet-demo"];

const registryAbi = parseAbi([
    "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
    "function getResolver(string label) view returns (address)",
    "function getExpiry(uint256 anyId) view returns (uint64)",
]);

const mnemonic = process.env.REWALL_MNEMONIC;
if (!mnemonic) throw new Error("Set REWALL_MNEMONIC in examples/.env. Copy .env.example to start.");

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
const account = mnemonicToAccount(mnemonic, { addressIndex: PEOPLE.alice.wallet });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });

const roleSetResolver = 1n << 24n;
const expiry = await publicClient.readContract({
    address: ETH_REGISTRY,
    abi: registryAbi,
    functionName: "getExpiry",
    args: [BigInt(keccak256(toBytes("rewall-test-1")))],
});

for (const label of LABELS) {
    const existing = await publicClient.readContract({
        address: NAMESPACE_REGISTRY,
        abi: registryAbi,
        functionName: "getResolver",
        args: [label],
    });

    if (existing !== ZERO) {
        console.log(`${label}.rewall.rewall-test-1.eth already exists`);
        continue;
    }

    const hash = await wallet.writeContract({
        address: NAMESPACE_REGISTRY,
        abi: registryAbi,
        functionName: "register",
        args: [label, account.address, ZERO, ALICE_RESOLVER, roleSetResolver | (roleSetResolver << 128n), expiry],
        account,
        chain: sepolia,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`registered ${label}.rewall.rewall-test-1.eth`);
}

// Everyone who receives a secret needs a public key on chain. This publishes one for each person.
for (const [who, person] of Object.entries(PEOPLE)) {
    const client = connect(person);
    const published = await client.publishIdentity();
    console.log(`${who.padEnd(12)} ${person.name.padEnd(26)} ${published ? "published a key" : "already had a key"}`);
}

console.log("\nSetup done. Run the numbered examples in order.");
