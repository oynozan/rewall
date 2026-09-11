// Alice pays Bob, then decides who may know she did. Not even Bob is on that list by default

import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Rewall, Transfers, encodeReceipt, decodeReceipt, receiptLabel } from "@rewall/sdk";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";

const RAIL = process.env.RAIL_API!;
const VAULT = process.env.VAULT_ADDRESS as `0x${string}`;
const TOKEN = process.env.TOKEN_ADDRESS!;
const AMOUNT = 10n ** 18n;

const ALICE = "rewall-test-1.eth";
const BOB = "rewall-test-2.eth";
// A third party to the payment, on Bob's team, who Alice can let in without Bob doing anything
const CHARLIE = "ci.rewall-test-2.eth";

if (!RAIL || !VAULT || !TOKEN)
    throw new Error("Start the rail first, see rail/README.md, then set RAIL_API, VAULT_ADDRESS and TOKEN_ADDRESS");

function wallet(walletIndex: number) {
    return mnemonicToAccount(process.env.REWALL_MNEMONIC!, { addressIndex: walletIndex });
}

function connect(walletIndex: number, ensName: string) {
    const account = wallet(walletIndex);
    return new Rewall({
        publicClient: createPublicClient({ chain: sepolia, transport: http(RPC) }),
        walletClient: createWalletClient({ account, chain: sepolia, transport: http(RPC) }),
        account,
        name: ensName,
        universalResolver: UNIVERSAL_RESOLVER,
    });
}

const pay = (walletIndex: number) => new Transfers({ account: wallet(walletIndex), api: RAIL, vault: VAULT });

const alice = connect(0, ALICE);
const bob = connect(1, BOB);
const charlie = connect(4, CHARLIE);
const stranger = connect(2, "");

// Checked before anything is written on chain, since publishing an address costs gas
if ((await pay(0).held(TOKEN)) < AMOUNT) {
    throw new Error(
        `Alice has nothing to spend. In rail/, run pnpm run deposit, then send her ${wallet(0).address} a balance`,
    );
}

// Bob publishes somewhere to be paid. It looks like an ordinary address and leads nowhere on chain
await bob.publishShielded(await pay(1).shieldedAddress());
const shielded = await alice.shieldedOf(BOB);
console.log(`Alice resolved ${BOB} to ${shielded}, which is all she ever learns about him.`);

const before = await pay(1).held(TOKEN);
const transactionId = await pay(0).pay(shielded!, TOKEN, AMOUNT);
console.log(`Alice paid him. Nothing about it reached the chain.`);
console.log(`Bob's balance went ${before} to ${await pay(1).held(TOKEN)}, so he knows he was paid.`);

// The payment left no trace, so this receipt is the only account of who paid whom and how much
const receipt = `${receiptLabel(transactionId)}.rewall.${ALICE}`;
await alice.create(
    receipt,
    encodeReceipt({ amount: AMOUNT.toString(), token: TOKEN, counterparty: BOB, tx: transactionId, direction: "sent" }),
    { type: "receipt", recovery: ["rewall-test-3.eth"] },
);

// Being paid does not come with the details. Bob saw a number move and nothing else
for (const [who, reader] of [
    [BOB, bob],
    [CHARLIE, charlie],
] as const) {
    try {
        await reader.get(receipt);
        console.log(`${who} read the receipt, which should not happen yet.`);
    } catch (error) {
        console.log(`${who} cannot read it yet: ${(error as Error).name}`);
    }
}

// Alice picks the list. Bob is on it because she says so, not because he was paid
await alice.grant(receipt, BOB);
await alice.grant(receipt, BOB, { subtree: true });
console.log(`\nAlice granted ${BOB} and his team.`);

for (const [who, reader] of [
    [BOB, bob],
    [CHARLIE, charlie],
] as const) {
    const read = decodeReceipt(await reader.get(receipt));
    console.log(`${who} reads: ${read.direction} ${read.amount} to ${read.counterparty}`);
}

try {
    await stranger.get(receipt);
    console.log("A stranger read it, which should not happen.");
} catch (error) {
    console.log(`A stranger still cannot: ${(error as Error).name}`);
}
