// Alice stores her database connection string, then reads it back

import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Rewall } from "@rewall/sdk";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";

const SECRET = "database.rewall.rewall-test-1.eth";
const CONNECTION_STRING = "postgres://app:hunter2@db.internal:5432/production";

// One wallet, one ENS name. In a real app this would be the browser wallet
const account = mnemonicToAccount(process.env.REWALL_MNEMONIC!, { addressIndex: 0 });

const alice = new Rewall({
    publicClient: createPublicClient({ chain: sepolia, transport: http(RPC) }),
    walletClient: createWalletClient({ account, chain: sepolia, transport: http(RPC) }),
    account,
    name: "rewall-test-1.eth",
    universalResolver: UNIVERSAL_RESOLVER,
});

// The SDK refuses to create a secret without someone who can recover it
await alice.create(SECRET, new TextEncoder().encode(CONNECTION_STRING), {
    type: "generic",
    recovery: ["rewall-test-3.eth"],
    overwrite: true,
});

console.log(`Stored a secret at ${SECRET}`);

// Reading takes one wallet signature. The plaintext never touches disk
const value = new TextDecoder().decode(await alice.get(SECRET));

console.log(`Read it back: ${value}`);
console.log(value === CONNECTION_STRING ? "\nIt matches." : "\nIt does not match, something is wrong.");
