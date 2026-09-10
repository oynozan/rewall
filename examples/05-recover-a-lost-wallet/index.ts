// Alice loses her wallet. Three of her four guardians bring her secret back.

import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Rewall, openSecret, readTexts, RECORD } from "@rewall/sdk";
import { connect, PEOPLE, bytes, text } from "../rewall.ts";

const SECRET = "lost-wallet-demo.rewall.rewall-test-1.eth";
const VALUE = "the-value-alice-cannot-afford-to-lose";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";
const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

const GUARDIANS = [PEOPLE.bob, PEOPLE.coldStorage, PEOPLE.ci, PEOPLE.deploy];
const THRESHOLD = 3;

const alice = connect(PEOPLE.alice);

// Alice splits a recovery key across four guardians. Any three can put it back together.
// The recovery key itself is destroyed as soon as the pieces are made. Nobody holds it.
await alice.guardians.init(
    GUARDIANS.map((g) => g.name),
    THRESHOLD,
);
console.log(`Alice set up ${THRESHOLD} of ${GUARDIANS.length} guardians.`);

await alice.create(SECRET, bytes(VALUE), {
    type: "generic",
    recovery: [alice.guardians.entry()],
});
console.log(`Alice reads: ${text(await alice.get(SECRET))}`);

/* Alice loses her laptop and sets up a new wallet */

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
const newAccount = mnemonicToAccount(process.env.REWALL_MNEMONIC!, { addressIndex: 9 });
const newAlice = new Rewall({
    publicClient,
    walletClient: createWalletClient({ account: newAccount, chain: sepolia, transport: http(RPC) }),
    account: newAccount,
    name: PEOPLE.alice.name,
    universalResolver: UNIVERSAL_RESOLVER,
});

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
    pieces.push(await connect(guardian).guardians.reshare(PEOPLE.alice.name, newKey));
    console.log(`${guardian.name} handed over their piece.`);
}

const recovered = await newAlice.guardians.recover(pieces);
console.log(`\nRebuilt the recovery key: ${recovered.fingerprint}`);

const records = await readTexts(publicClient, UNIVERSAL_RESOLVER, SECRET, [
    RECORD.blob,
    RECORD.wrap(recovered.fingerprint),
]);
console.log(`Alice reads again: ${text(await openSecret(records, recovered, SECRET))}`);
