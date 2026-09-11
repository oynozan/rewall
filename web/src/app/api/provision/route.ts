import { isAddress, type Address } from "viem";
import { assertOwns, NotYoursError } from "@/src/lib/auth";
import { accountFor, accounts, seeAccount, updateAccount } from "@/src/lib/mongo";
import { finishProvision, labelOk, startProvision } from "@/src/lib/provision";

const CAP = Number(process.env.REWALL_PROVISION_CAP || 25);

type Body = {
    phase?: "start" | "finish";
    address?: string;
    label?: string;
    publicKey?: string;
    recoveryPublicKey?: string;
};

const refuse = (reason: string, status = 400, extra: Record<string, unknown> = {}) =>
    Response.json({ error: reason, ...extra }, { status });

export async function POST(request: Request) {
    const body = (await request.json().catch(() => ({}))) as Body;
    const { phase, address, label } = body;

    if (!address || !isAddress(address)) return refuse("Send a wallet address.");
    if (!label || !labelOk(label)) return refuse("Pick a name of 5 or more letters, numbers or hyphens.");

    try {
        await assertOwns(request, address);
    } catch (failure) {
        if (failure instanceof NotYoursError) return refuse(failure.message, 401);
        throw failure;
    }

    const existing = await accountFor(address);
    // One sponsored vault per wallet, and the name that comes back is the one they actually hold
    // Saying done for a label nobody registered would send them to a vault that does not exist
    if (existing?.completedAt) return Response.json({ done: true, already: true, name: existing.name });

    // A sponsored deploy costs the project real money, so the ledger caps how many can ever run
    if (
        !existing?.provisioned &&
        (await (await accounts()).countDocuments({ provisioned: { $exists: true } })) >= CAP
    ) {
        return refuse("Sponsored setup is full for now.", 503);
    }

    if (phase === "start") {
        const { publicKey, recoveryPublicKey } = body;
        if (!publicKey || !recoveryPublicKey)
            return refuse("Both public keys are required before anything is deployed.");

        await seeAccount(address);
        const state = await startProvision({
            address: address as Address,
            label,
            publicKey,
            recoveryPublicKey,
            existing: existing?.provisioned,
        });
        await updateAccount(address, { provisioned: state, name: `${label}.eth` });
        return Response.json({ committedAt: state.committedAt, resolver: state.resolver });
    }

    if (phase === "finish") {
        if (!existing?.provisioned) return refuse("This setup was never started.");
        try {
            const state = await finishProvision({ address: address as Address, label, state: existing.provisioned });
            await updateAccount(address, {
                provisioned: state,
                name: `${label}.eth`,
                completedAt: Math.floor(Date.now() / 1000),
            });
            return Response.json({ done: true, name: `${label}.eth` });
        } catch (failure) {
            // Still maturing is a wait, not a failure, so the client is told exactly how long is left
            const retryAfter = (failure as { retryAfter?: number }).retryAfter;
            if (retryAfter) return refuse("The commitment is still maturing.", 425, { retryAfter });
            throw failure;
        }
    }

    return refuse("Send a phase of start or finish.");
}
