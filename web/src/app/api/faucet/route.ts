import { formatEther, isAddress, parseEther } from "viem";
import { sepolia } from "viem/chains";
import { assertOwns, NotYoursError } from "@/src/lib/auth";
import { accountFor, drippedTotal, seeAccount, updateAccount } from "@/src/lib/mongo";
import { publicClient, serialized, sponsor } from "@/src/lib/server-chain";

const DRIP = parseEther(process.env.REWALL_DRIP_ETH || "0.005");
const CAP = parseEther(process.env.REWALL_FAUCET_CAP_ETH || "0.05");

const refuse = (reason: string, status = 400) => Response.json({ error: reason }, { status });

export async function POST(request: Request) {
    const { address } = (await request.json().catch(() => ({}))) as { address?: string };
    if (!address || !isAddress(address)) return refuse("Send a wallet address.");

    try {
        await assertOwns(request, address);
    } catch (failure) {
        if (failure instanceof NotYoursError) return refuse(failure.message, 401);
        throw failure;
    }

    const existing = await accountFor(address).catch(() => {
        throw new Error("mongo");
    });
    // Idempotent per wallet, because the ledger is the only thing standing between a faucet and zero
    if (existing?.dripped) {
        return Response.json({ already: true, hash: existing.dripped.hash, wei: existing.dripped.wei });
    }

    if ((await drippedTotal()) + DRIP > CAP) return refuse("The faucet is empty for now.", 503);

    const { account, client } = sponsor();
    const balance = await publicClient.getBalance({ address: account.address });
    if (balance < DRIP) return refuse("The faucet is empty for now.", 503);

    await seeAccount(address);

    const hash = await serialized(() => client.sendTransaction({ to: address, value: DRIP, chain: sepolia }));
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") return refuse("The drip did not confirm, try again.", 502);

    await updateAccount(address, { dripped: { hash, wei: DRIP.toString(), at: Math.floor(Date.now() / 1000) } });
    return Response.json({ already: false, hash, wei: DRIP.toString(), eth: formatEther(DRIP) });
}
