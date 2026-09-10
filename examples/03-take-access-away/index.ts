// Bob leaves the team. Alice takes his access away and proves it stuck

import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Rewall } from "@rewall/sdk";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";

const SECRET = "deploy-token.rewall.rewall-test-1.eth";
const TOKEN = "ghp_not_a_real_deploy_token";
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

const text = (b: Uint8Array) => new TextDecoder().decode(b);

const alice = connect(0, "rewall-test-1.eth");
const bob = connect(1, BOB);

await alice.create(SECRET, new TextEncoder().encode(TOKEN), {
    type: "apikey",
    grantees: [BOB],
    recovery: ["rewall-test-3.eth"],
    overwrite: true,
});

console.log(`Bob reads: ${text(await bob.get(SECRET))}`);

// Bob copies the value before he goes. This is what a real leaver would keep
const stolen = text(await bob.get(SECRET));

await alice.revoke(SECRET, BOB);
console.log(`\nAlice revoked ${BOB}.`);

try {
    await bob.get(SECRET);
    console.log("Bob still reads it, which should not happen.");
} catch (error) {
    console.log(`Bob is locked out: ${(error as Error).name}`);
}

console.log(`Alice still reads: ${text(await alice.get(SECRET))}`);
console.log(`\nBob kept a copy of the old value: ${stolen}`);
console.log("He did not even need to keep it. The old wrap and the old blob are in chain history forever,");
console.log("so his key still opens them. Revoking protects the next value. Rotate the real token too.");
