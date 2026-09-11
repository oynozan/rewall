import "server-only";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

export const ETH_REGISTRAR = "0xa88553f454b77203b0d036a05c894d555eaaa2cc" as const;
export const ETH_REGISTRY = "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2" as const;
export const MOCK_USDC = "0x768f42455a2d082e23ceef7d51e5787c82d67a39" as const;
export const VERIFIABLE_FACTORY = "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef" as const;
export const RESOLVER_IMPL = "0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e" as const;
export const USER_REGISTRY_IMPL = "0x624a25d67b59d587752ebec8dded8827dae52050" as const;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const ALL_ROLES = BigInt("0x1111111111111111111111111111111111111111111111111111111111111111");
export const ROOT_RESOURCE = BigInt(0);

const rpc =
    process.env.SEPOLIA_RPC_URL ||
    process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ||
    "https://ethereum-sepolia-rpc.publicnode.com";

export const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });

export function sponsor() {
    const key = process.env.REWALL_SPONSOR_KEY;
    if (!key) throw new Error("REWALL_SPONSOR_KEY is not set, so the project cannot pay for anything");

    const account = privateKeyToAccount(key as `0x${string}`);
    return { account, client: createWalletClient({ account, chain: sepolia, transport: http(rpc) }) };
}

/* Nonce */

// One wallet sends both the drip and the provisioning calls, so two requests would race for a nonce
// ponytail: an in-process queue, swap for a nonce manager if this ever runs on more than one instance
let tail: Promise<unknown> = Promise.resolve();

export function serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = tail.then(work, work);
    tail = next.catch(() => {});
    return next;
}

export async function send(
    request: Parameters<ReturnType<typeof sponsor>["client"]["writeContract"]>[0],
): Promise<Address> {
    const { client } = sponsor();
    const hash = await client.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction reverted ${hash}`);
    return hash as Address;
}
