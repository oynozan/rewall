// Alice grants a secret to Bob's whole team at once, without naming anyone on it

import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Rewall } from "@rewall/sdk";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";

const SECRET = "team-secret.rewall.rewall-test-1.eth";
const VALUE = "shared-across-the-whole-team";

const BOB = "rewall-test-2.eth";
const CI = "ci.rewall-test-2.eth";
const DEPLOY = "deploy.rewall-test-2.eth";

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
const ci = connect(4, CI);
const deploy = connect(5, DEPLOY);

// Bob publishes a team key, then hands a copy to each machine under his name
await bob.subtree.init();
await bob.subtree.distribute([CI, DEPLOY]);
console.log(`Bob shared his team key with ${CI} and ${DEPLOY}.`);

await alice.create(SECRET, new TextEncoder().encode(VALUE), {
    type: "generic",
    subtreeGrantees: [BOB],
    recovery: ["rewall-test-3.eth"],
    overwrite: true,
});
console.log(`\nAlice granted the secret to ${BOB} and everything under it.`);

// Neither machine was named by Alice. Both can read
console.log(`${CI} reads: ${text(await ci.get(SECRET))}`);
console.log(`${DEPLOY} reads: ${text(await deploy.get(SECRET))}`);

// Removing a machine means changing the team key, then handing out the new one
await bob.subtree.rotate();
console.log(`\nBob rotated the team key to version ${await bob.subtree.version()}.`);

await alice.grant(SECRET, BOB, { subtree: true });
await bob.subtree.distribute([CI]);

console.log(`${CI} still reads: ${text(await ci.get(SECRET))}`);

try {
    await deploy.get(SECRET);
    console.log(`${DEPLOY} still reads it, which should not happen.`);
} catch (error) {
    console.log(`${DEPLOY} is out: ${(error as Error).name}`);
}
