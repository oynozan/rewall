import "server-only";
import { PrivyClient } from "@privy-io/server-auth";

// Both sponsored endpoints spend project funds, so the caller has to prove the wallet is theirs
// ponytail: @privy-io/server-auth is deprecated, swap for JWKS verification against auth.privy.io if it breaks
let cached: PrivyClient | null = null;

function privy(): PrivyClient {
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    const secret = process.env.PRIVY_APP_SECRET;
    if (!appId || !secret)
        throw new Error("NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET are required to verify a caller");
    cached ??= new PrivyClient(appId, secret);
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
    const { userId } = await client.verifyAuthToken(token).catch(() => {
        throw new NotYoursError("That session is not valid.");
    });

    const user = await client.getUser(userId);
    const owned = user.linkedAccounts
        .map((account) =>
            "address" in account && typeof account.address === "string" ? account.address.toLowerCase() : "",
        )
        .filter(Boolean);

    if (!owned.includes(address.toLowerCase())) throw new NotYoursError("That wallet is not linked to your account.");
}
