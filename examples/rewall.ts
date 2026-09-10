import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Rewall } from "@rewall/sdk";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";

// The people in these examples. Each one is a separate wallet and a separate ENS name.
export const PEOPLE = {
    alice: { wallet: 0, name: "rewall-test-1.eth" },
    bob: { wallet: 1, name: "rewall-test-2.eth" },
    coldStorage: { wallet: 3, name: "rewall-test-3.eth" },
    ci: { wallet: 4, name: "ci.rewall-test-2.eth" },
    deploy: { wallet: 5, name: "deploy.rewall-test-2.eth" },
};

export type Person = (typeof PEOPLE)[keyof typeof PEOPLE];

export function connect(person: Person): Rewall {
    const mnemonic = process.env.REWALL_MNEMONIC;
    if (!mnemonic) throw new Error("Set REWALL_MNEMONIC in examples/.env. Copy .env.example to start.");

    const account = mnemonicToAccount(mnemonic, { addressIndex: person.wallet });

    return new Rewall({
        publicClient: createPublicClient({ chain: sepolia, transport: http(RPC) }),
        walletClient: createWalletClient({ account, chain: sepolia, transport: http(RPC) }),
        account,
        name: person.name,
        universalResolver: UNIVERSAL_RESOLVER,
    });
}

export const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
export const bytes = (value: string) => new TextEncoder().encode(value);
