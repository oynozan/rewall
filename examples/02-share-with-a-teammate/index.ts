// Alice stores an API key, then lets Bob read it. Bob never sends her anything

import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Rewall } from "@rewall/sdk";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";

const SECRET = "stripe-key.rewall.rewall-test-1.eth";
const API_KEY = "sk_live_not_a_real_stripe_key";
const BOB = "rewall-test-2.eth";

function connect(walletIndex: number, ensName: string) {
    const account = mnemonicToAccount(process.env.REWALL_MNEMONIC!, { addressIndex: walletIndex });
    return new Rewall({
        publicClient: createPublicClient({ chain: sepolia, transport: http(RPC) }),
        walletClient: createWalletClient({ account, chain: sepolia, transport: http(RPC) }),
        account,
        name: ensName,
        universalResolver: UNIVERSAL_RESOLVER,
    });
}

const alice = connect(0, "rewall-test-1.eth");
const bob = connect(1, BOB);

await alice.create(SECRET, new TextEncoder().encode(API_KEY), {
    type: "apikey",
    recovery: ["rewall-test-3.eth"],
});
console.log("Alice stored the API key.");

// Before the grant, Bob is just another stranger
try {
    await bob.get(SECRET);
    console.log("Bob read it, which should not happen.");
} catch (error) {
    console.log(`Bob cannot read it yet: ${(error as Error).name}`);
}

// Alice only needs Bob's ENS name. She looks up his public key from it
await alice.grant(SECRET, BOB);
console.log(`Alice granted ${BOB}.`);

console.log(`Bob reads: ${new TextDecoder().decode(await bob.get(SECRET))}`);
