// Registers the subnames the examples write to and publishes a key for each person

import { createPublicClient, createWalletClient, http, parseAbi, keccak256, toBytes } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Rewall } from "@rewall/sdk";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";
const ETH_REGISTRY = "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2";
const ZERO = "0x0000000000000000000000000000000000000000";

// Alice's registry for names under rewall.rewall-test-1.eth, and the resolver holding her records
const NAMESPACE_REGISTRY = "0xC2aF679BAC5d8314543aA1672e3730634Ab059cD";
const ALICE_RESOLVER = "0x1A0578825afDf388F5107117F81A57375cf7060f";

const LABELS = ["database", "stripe-key", "deploy-token", "team-secret", "lost-wallet-demo"];

const PEOPLE = [
    { wallet: 0, name: "rewall-test-1.eth" },
    { wallet: 1, name: "rewall-test-2.eth" },
    { wallet: 3, name: "rewall-test-3.eth" },
    { wallet: 4, name: "ci.rewall-test-2.eth" },
    { wallet: 5, name: "deploy.rewall-test-2.eth" },
];

const registryAbi = parseAbi([
    "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
    "function getResolver(string label) view returns (address)",
    "function getExpiry(uint256 anyId) view returns (uint64)",
]);

if (!process.env.REWALL_MNEMONIC) throw new Error("Set REWALL_MNEMONIC in examples/.env. Copy .env.example to start.");

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
const account = mnemonicToAccount(process.env.REWALL_MNEMONIC, { addressIndex: 0 });
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

// Everyone who receives a secret needs a public key on chain
for (const person of PEOPLE) {
    const signer = mnemonicToAccount(process.env.REWALL_MNEMONIC, { addressIndex: person.wallet });
    const client = new Rewall({
        publicClient,
        walletClient: createWalletClient({ account: signer, chain: sepolia, transport: http(RPC) }),
        account: signer,
        name: person.name,
        universalResolver: UNIVERSAL_RESOLVER,
    });

    const published = await client.publishIdentity();
    console.log(`${person.name.padEnd(26)} ${published ? "published a key" : "already had a key"}`);
}

console.log("\nSetup done. Run the numbered examples in order.");
