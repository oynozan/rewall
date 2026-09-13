import { formatEther, formatUnits, isAddress, parseAbi, parseEther, parseUnits } from "viem";
import { sepolia } from "viem/chains";
import { assertOwns, NotYoursError } from "@/src/lib/auth";
import {
    accountFor,
    claimDrip,
    claimFunding,
    drippedTotal,
    fundedTotal,
    releaseDrip,
    releaseFunding,
    seeAccount,
    updateAccount,
} from "@/src/lib/mongo";
import { RAIL_TOKEN } from "@/src/lib/rail";
import { publicClient, send, serialized, sponsor } from "@/src/lib/server-chain";

const DRIP = parseEther(process.env.REWALL_DRIP_ETH || "0.005");
const CAP = parseEther(process.env.REWALL_FAUCET_CAP_ETH || "0.05");
// USDC carries six decimals, so an ether sized amount here would hand out a trillion times too much
const USDC_DECIMALS = 6;
const TOKENS = parseUnits(process.env.REWALL_USDC_DRIP || "1", USDC_DECIMALS);
// ponytail: nothing can mint Circle's USDC, so a dry faucet is refilled by sending the sponsor more
const TOKEN_CAP = parseUnits(process.env.REWALL_USDC_CAP || "100", USDC_DECIMALS);

const TOKEN = RAIL_TOKEN;

const erc20Abi = parseAbi([
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)",
]);

const refuse = (reason: string, status = 400) => Response.json({ error: reason }, { status });

export async function POST(request: Request) {
    // A literal null body parses fine and would crash the destructure, so it falls back to an object
    const body = ((await request.json().catch(() => null)) ?? {}) as { address?: string };
    const { address } = body;
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
    // Idempotent per delivered leg, so a claim still in flight does not read as one already handed over
    if (existing?.dripped && !existing.dripped.pending && existing.funded && !existing.funded.pending) {
        return Response.json({
            already: true,
            hash: existing.dripped.hash,
            wei: existing.dripped.wei,
            units: existing.funded?.units ?? null,
        });
    }

    await seeAccount(address);
    const { account, client } = sponsor();

    /* Gas */

    let dripped = existing?.dripped;
    if (dripped?.pending) return refuse("A drip for this wallet is already in flight.", 409);
    if (!dripped) {
        if ((await drippedTotal()) + DRIP > CAP) return refuse("The faucet is empty for now.", 503);
        if ((await publicClient.getBalance({ address: account.address })) < DRIP)
            return refuse("The faucet is empty for now.", 503);

        // Claimed before anything moves, so two requests for this wallet cannot both pay it
        if (!(await claimDrip(address, DRIP.toString()))) {
            return refuse("A drip for this wallet is already in flight.", 409);
        }

        // Re-read once the claim is in the ledger, or two wallets racing could both pass the cap check
        if ((await drippedTotal()) > CAP) {
            await releaseDrip(address);
            return refuse("The faucet is empty for now.", 503);
        }

        try {
            const hash = await serialized(() => client.sendTransaction({ to: address, value: DRIP, chain: sepolia }));
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            if (receipt.status !== "success") {
                await releaseDrip(address);
                return refuse("The drip did not confirm, try again.", 502);
            }

            dripped = { hash, wei: DRIP.toString(), at: Math.floor(Date.now() / 1000) };
            await updateAccount(address, { dripped });
        } catch (failure) {
            await releaseDrip(address);
            throw failure;
        }
    }

    /* Tokens */

    // Best effort, because the ether is already sent and a dry token faucet must not block onboarding
    let funded = existing?.funded;
    if (!funded) {
        const held = await publicClient.readContract({
            address: TOKEN,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [account.address],
        });

        // Checked rather than attempted, because nothing here can mint and a short balance only reverts
        if ((await fundedTotal()) + TOKENS <= TOKEN_CAP && held >= TOKENS && (await claimFunding(address, TOKENS.toString()))) {
            if ((await fundedTotal()) > TOKEN_CAP) {
                await releaseFunding(address);
            } else {
                const hash = await serialized(() =>
                    send({
                        address: TOKEN,
                        abi: erc20Abi,
                        functionName: "transfer",
                        args: [address, TOKENS],
                        chain: sepolia,
                        account,
                    }),
                ).catch(() => null);

                if (hash) {
                    funded = { hash, units: TOKENS.toString(), at: Math.floor(Date.now() / 1000) };
                    await updateAccount(address, { funded });
                } else {
                    await releaseFunding(address);
                    funded = undefined;
                }
            }
        }
    }

    return Response.json({
        already: false,
        hash: dripped.hash,
        wei: dripped.wei,
        eth: formatEther(BigInt(dripped.wei)),
        units: funded?.units ?? null,
        tokens: funded ? formatUnits(TOKENS, USDC_DECIMALS) : null,
    });
}
