/*
 * Passes a signed transfer request through to the rail, which a browser cannot call directly because
 * the rail sends no CORS headers and answers the preflight with a 404. Nothing here signs, decrypts,
 * caches or reads a field, and the body arrives already signed by the user's own wallet, so this is a
 * hop rather than a party to the transfer. The rail recovers that signature itself, which is why
 * there is no session check here to add.
 */

// Loopback by literal, because Node resolves localhost to IPv6 first and the rail listens on IPv4
const RAIL = process.env.REWALL_RAIL_URL || "http://127.0.0.1:8788";

// The five endpoints Chainlink documents, and nothing else the local stand in happens to serve
const ALLOWED = new Set(["/balances", "/transactions", "/shielded-address", "/private-transfer", "/withdraw"]);

// Long enough for the ACE policy call the rail makes before a transfer or a withdrawal
const TIMEOUT_MS = 15000;

// Every one of the five is a few hundred bytes, so anything larger is not a transfer
const MAX_BODY_BYTES = 8192;

// No request_id, which is how a caller tells a refusal here apart from one the rail sent
const refuse = (reason: string, status: number) => Response.json({ error: reason }, { status });

// Optional catch all, so a bare POST to the proxy root is refused here rather than redirected by Next
export async function POST(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
    const endpoint = `/${((await params).path ?? []).join("/")}`;
    if (!ALLOWED.has(endpoint)) return refuse("That is not a transfer endpoint.", 404);

    // Refused on the declared length first, so an oversized body is not buffered before it is rejected
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return refuse("That is too large to be a transfer.", 413);

    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return refuse("That is too large to be a transfer.", 413);

    try {
        // Only the raw bytes travel, so no cookie, session token or browser header rides along
        const upstream = await fetch(`${RAIL}${endpoint}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            cache: "no-store",
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        return new Response(await upstream.text(), {
            status: upstream.status,
            headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
        });
    } catch (failure) {
        if ((failure as Error).name === "TimeoutError") return refuse("The transfer rail did not answer in time.", 504);
        return refuse("The transfer rail is not running. Start it with pnpm run serve in rail.", 503);
    }
}
