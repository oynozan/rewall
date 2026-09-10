// Alice loses her wallet. Three of her four guardians bring her secret back

import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Rewall, openSecret, readTexts, RECORD } from "@rewall/sdk";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";

const SECRET = "lost-wallet-demo.rewall.rewall-test-1.eth";
const VALUE = "the-value-alice-cannot-afford-to-lose";
const ALICE = "rewall-test-1.eth";

const GUARDIANS = [
    { wallet: 1, name: "rewall-test-2.eth" },
    { wallet: 3, name: "rewall-test-3.eth" },
    { wallet: 4, name: "ci.rewall-test-2.eth" },
    { wallet: 5, name: "deploy.rewall-test-2.eth" },
];
const THRESHOLD = 3;

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });

function connect(walletIndex: number, ensName: string) {
    const account = mnemonicToAccount(process.env.REWALL_MNEMONIC!, { addressIndex: walletIndex });
    return new Rewall({
        publicClient,
        walletClient: createWalletClient({ account, chain: sepolia, transport: http(RPC) }),
        account,
        name: ensName,
        universalResolver: UNIVERSAL_RESOLVER,
    });
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const alice = connect(0, ALICE);

// Any three of the four can rebuild the key, and it is destroyed as soon as the pieces are made
await alice.guardians.init(
    GUARDIANS.map((g) => g.name),
    THRESHOLD,
);
console.log(`Alice set up ${THRESHOLD} of ${GUARDIANS.length} guardians.`);

await alice.create(SECRET, new TextEncoder().encode(VALUE), {
    type: "generic",
    recovery: [alice.guardians.entry()],
});
console.log(`Alice reads: ${text(await alice.get(SECRET))}`);

/* Alice loses her laptop and sets up a new wallet, index 9 */

const newAlice = connect(9, ALICE);

try {
    await newAlice.get(SECRET);
    console.log("\nThe new wallet read it, which should not happen.");
} catch (error) {
    console.log(`\nAlice's new wallet cannot read anything: ${(error as Error).name}`);
}

/* Each guardian re-seals their piece to the new wallet */

const newKey = (await newAlice.identity()).publicKey;
const pieces = [];

for (const guardian of GUARDIANS.slice(0, THRESHOLD)) {
    pieces.push(await connect(guardian.wallet, guardian.name).guardians.reshare(ALICE, newKey));
    console.log(`${guardian.name} handed over their piece.`);
}

const recovered = await newAlice.guardians.recover(pieces);
console.log(`\nRebuilt the recovery key: ${recovered.fingerprint}`);

const records = await readTexts(publicClient, UNIVERSAL_RESOLVER, SECRET, [
    RECORD.blob,
    RECORD.wrap(recovered.fingerprint),
]);
console.log(`Alice reads again: ${text(await openSecret(records, recovered, SECRET))}`);
