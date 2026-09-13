import "server-only";
import { PrivyClient } from "@privy-io/node";

// Both sponsored endpoints spend project funds, so the caller has to prove the wallet is theirs
let cached: PrivyClient | null = null;

function privy(): PrivyClient {
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    const secret = process.env.PRIVY_APP_SECRET;
    if (!appId || !secret)
        throw new Error("NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET are required to verify a caller");
    cached ??= new PrivyClient({ appId, appSecret: secret });
    return cached;
}

export class NotYoursError extends Error {
    override name = "NotYoursError";
}

// The address is checked against the token's own linked wallets, never taken on the body's word
export async function assertOwns(request: Request, address: string): Promise<void> {
    const token = request.headers
        .get("authorization")
        ?.replace(/^Bearer /i, "")
        .trim();
    if (!token) throw new NotYoursError("Sign in before asking the project to pay.");

    const client = privy();
    const { user_id } = await client
        .utils()
        .auth()
        .verifyAccessToken(token)
        .catch(() => {
            throw new NotYoursError("That session is not valid.");
        });

    // Wrapped, or a Privy outage crashes the route and the caller is told nothing at all
    const user = await client
        .users()
        ._get(user_id)
        .catch((failure) => {
            throw new Error(`Privy could not be reached to check your wallets, ${(failure as Error).message}`);
        });
    // Only wallet accounts carry a signable address, so emails and OAuth links can never match
    const owned = user.linked_accounts.flatMap((account) =>
        account.type === "wallet" || account.type === "smart_wallet" ? [account.address.toLowerCase()] : [],
    );

    if (!owned.includes(address.toLowerCase())) throw new NotYoursError("That wallet is not linked to your account.");
}
