import "server-only";
import { createPublicClient, createWalletClient, http, type Address, type Hash, type TransactionReceipt } from "viem";
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

// Polled faster than the four second default, because a setup waits on receipts a dozen times over
export const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc), pollingInterval: 1000 });

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

export type WriteRequest = Parameters<ReturnType<typeof sponsor>["client"]["writeContract"]>[0];

// Independent calls ride consecutive nonces, so six of them cost one block rather than six
export async function sendAll(requests: WriteRequest[]): Promise<TransactionReceipt[]> {
    if (!requests.length) return [];
    const { account, client } = sponsor();

    // The nonce is claimed inside the queue, the receipts are awaited outside it
    const hashes = await serialized(async () => {
        const first = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
        const sent: Hash[] = [];
        // Submitted in order, because a gap left by a failed send would strand every nonce above it
        for (const [index, request] of requests.entries()) {
            sent.push(await client.writeContract({ ...request, nonce: first + index }));
        }
        return sent;
    });

    const receipts = await Promise.all(hashes.map((hash) => publicClient.waitForTransactionReceipt({ hash })));
    const reverted = receipts.findIndex((receipt) => receipt.status !== "success");
    if (reverted >= 0) throw new Error(`transaction reverted ${hashes[reverted]}`);
    return receipts;
}

export async function send(request: WriteRequest): Promise<Address> {
    const [receipt] = await sendAll([request]);
    return receipt!.transactionHash as Address;
}
