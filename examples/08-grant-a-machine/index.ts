// A CI machine reads a secret with no wallet of its own, and Alice takes it away again

import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Rewall, deriveIdentity, IDENTITY_TYPED_DATA, ReadOnlyError } from "@rewall/sdk";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";

const SECRET = "ci-token.rewall.rewall-test-1.eth";
const TOKEN = "ghp_not_a_real_ci_token";
const CI = "ci.rewall-test-2.eth";
const CI_WALLET_INDEX = 4;

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

const alice = connect(0, "rewall-test-1.eth");

// Derived once by a human at a keyboard, then handed to the process that runs unattended
const ciAccount = mnemonicToAccount(process.env.REWALL_MNEMONIC!, { addressIndex: CI_WALLET_INDEX });
const identity = await deriveIdentity(await ciAccount.signTypedData(IDENTITY_TYPED_DATA));

// No walletClient and no account, so this client can read and nothing else
const ci = new Rewall({ publicClient, name: CI, universalResolver: UNIVERSAL_RESOLVER, identity });

await alice.create(SECRET, new TextEncoder().encode(TOKEN), {
    type: "apikey",
    grantees: [CI],
    recovery: ["rewall-test-3.eth"],
    allow: ["api.github.com"],
    overwrite: true,
});

console.log(`Alice granted ${CI}, a machine that never signs anything.`);
console.log(`The machine reads: ${text(await ci.get(SECRET))}`);

try {
    await ci.grant(SECRET, "rewall-test-3.eth");
    console.log("The machine granted the secret to someone else, which should not happen.");
} catch (error) {
    console.log(`The machine cannot pass it on: ${(error as Error).name}`);
    if (!(error instanceof ReadOnlyError)) throw error;
}

await alice.revoke(SECRET, CI);
console.log(`\nAlice revoked ${CI}.`);

try {
    await ci.get(SECRET);
    console.log("The machine still reads it, which should not happen.");
} catch (error) {
    console.log(`The machine is locked out: ${(error as Error).name}`);
}

console.log(`Alice still reads: ${text(await alice.get(SECRET))}`);
console.log("\nOne thing did not get solved here. The machine's key was derived by a human and handed over,");
console.log("so it now lives in that process, and read access can never be taken back from whoever holds it.");
console.log("Revoking protects the next value, not the ones already read. See cre/ for where that key can live");
console.log("instead: an enclave that is granted the same way and holds the key on no machine at all.");
