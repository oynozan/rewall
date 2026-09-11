// A shared wallet whose signing key is a secret. Spending is a grant, not a copied private key

import { createPublicClient, createWalletClient, http, toHex } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Rewall, Transfers, SecretExistsError } from "@rewall/sdk";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";

const RAIL = process.env.RAIL_API!;
const VAULT = process.env.VAULT_ADDRESS as `0x${string}`;
const TOKEN = process.env.TOKEN_ADDRESS!;
const AMOUNT = 10n ** 18n;

const ALICE = "rewall-test-1.eth";
const BOB = "rewall-test-2.eth";
const SECRET = `treasury.rewall.${ALICE}`;

// Holds the shared balance and never pays gas, so nobody has to fund it
const TREASURY_WALLET = 7;

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

const spend = (account: any) => new Transfers({ account, api: RAIL, vault: VAULT });

const alice = connect(0, ALICE);
const bob = connect(1, BOB);
const stranger = connect(2, "");
const treasury = wallet(TREASURY_WALLET);

// Alice funds the shared wallet out of her own balance
if ((await spend(treasury).held(TOKEN)) < AMOUNT) {
    if ((await spend(wallet(0)).held(TOKEN)) < 2n * AMOUNT) {
        throw new Error(
            `Alice has nothing to fund it with. In rail/, run pnpm run deposit, then send her ${wallet(0).address} a balance`,
        );
    }
    await spend(wallet(0)).pay(treasury.address, TOKEN, 2n * AMOUNT);
}
console.log(`The treasury holds ${await spend(treasury).held(TOKEN)}.`);

// The key that spends it is a secret, so granting it is the whole of granting access
try {
    await alice.create(SECRET, new TextEncoder().encode(toHex(treasury.getHdKey().privateKey!)), {
        type: "privkey",
        grantees: [BOB],
        recovery: ["rewall-test-3.eth"],
    });
    console.log(`Alice stored the treasury key and granted ${BOB}.`);
} catch (error) {
    if (!(error instanceof SecretExistsError)) throw error;
    console.log(`${SECRET} already holds the key.`);
}

// Bob never had the key. He reads it, and it only lives in memory
const recovered = privateKeyToAccount(new TextDecoder().decode(await bob.get(SECRET)) as `0x${string}`);
console.log(`Bob opened the treasury ${recovered.address}.`);

const before = await spend(recovered).held(TOKEN);
await spend(recovered).pay(wallet(1).address, TOKEN, AMOUNT);
console.log(`Bob spent from it: ${before} to ${await spend(recovered).held(TOKEN)}.`);

try {
    await stranger.get(SECRET);
    console.log("A stranger opened the treasury, which should not happen.");
} catch (error) {
    console.log(`A stranger cannot: ${(error as Error).name}`);
}
