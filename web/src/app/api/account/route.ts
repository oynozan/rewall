import { isAddress } from "viem";
import { accountFor } from "@/src/lib/mongo";

// Tells the dashboard whether to open the wizard, so it answers for an unknown wallet rather than failing
export async function GET(request: Request) {
    const address = new URL(request.url).searchParams.get("address");
    if (!address || !isAddress(address)) return Response.json({ error: "Send a wallet address." }, { status: 400 });

    const account = await accountFor(address);
    // Booleans only, because the provisioning state carries the registrar commitment secret
    return Response.json({
        seen: Boolean(account),
        dripped: Boolean(account?.dripped),
        name: account?.completedAt ? (account.name ?? null) : null,
        started: Boolean(account?.provisioned),
        completed: Boolean(account?.completedAt),
    });
}
