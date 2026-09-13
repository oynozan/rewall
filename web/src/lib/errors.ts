// Matched on name rather than instanceof, which survives the SDK being a linked package
const MESSAGES: Record<string, string> = {
    NoWrapError: "You do not have access to this secret.",
    MissingBlobError: "No secret is stored at this name.",
    SecretExistsError: "A secret already lives at this name.",
    KeyCommitmentError: "This value does not belong to this name. It may have been tampered with.",
    PaddingError: "The stored value is corrupt and could not be read.",
    UnauthorizedListError: "The access list was signed by someone who does not own this name.",
    NonCanonicalRecordError: "The access list on this secret has been written to by someone else. Do not rotate it.",
    LegacyAuthorizationError:
        "This secret predates key binding. Re-sign its access list before granting, revoking or rotating.",
    RecoveryFailedError: "Those guardian shares do not rebuild the recovery key.",
    UserRejectedRequestError: "You turned down the wallet request.",
    NonDeterministicSignerError:
        "This wallet signs the same request differently every time, so Rewall cannot derive a stable key from it. Connect a different wallet.",
};

type KeyChange = { role: string; name: string; approved: string | null; resolved: string };

// Naming the drifted key is the whole point, so an owner can tell a rotation apart from a hijack
function explainKeyChange(changes: KeyChange[]): string {
    const listed = changes
        .map(
            (c) =>
                `${c.name} now publishes ${c.resolved.slice(0, 8)} where you approved ${c.approved?.slice(0, 8) ?? "nothing"}`,
        )
        .join(", ");

    return `The key behind a name on this secret changed, so nothing was sealed to it. ${listed}. Confirm the new key only if that name really rotated, otherwise remove it from the list.`;
}

// The rail names its failures in the body, which is more precise than the status they arrive with
const RAIL: Record<string, string> = {
    insufficient_balance: "Your balance is below that amount.",
    policy_denied: "The transfer policy refused this payment.",
    "request authentication failed": "The transfer rail refused the signature. Check your device clock, then retry.",
    invalid_request: "The transfer rail could not read that request.",
    not_found: "The transfer rail has no record of that account yet.",
    internal_error: "The transfer rail is having trouble. Try again in a moment.",
};

// The RPC phrases this several ways and viem passes the sentence through whole
const SHORT_OF_GAS = /insufficient funds|exceeds the balance of the account/i;

const FALLBACK = "Something went wrong. Try again.";

export function explain(error: unknown): string {
    if (!(error instanceof Error)) return FALLBACK;

    const changes = (error as { changes?: KeyChange[] }).changes;
    if (error.name === "KeyChangedError" && changes?.length) return explainKeyChange(changes);

    if (MESSAGES[error.name]) return MESSAGES[error.name];

    // viem nests the cause the user actually triggered, most often a rejected prompt
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && MESSAGES[cause.name]) return MESSAGES[cause.name];

    // Named before anything generic, because the fallback tells them to retry and retrying cannot work
    const nested = cause instanceof Error ? cause.message : "";
    if (SHORT_OF_GAS.test(error.message) || SHORT_OF_GAS.test(nested)) {
        return "This wallet does not hold enough Sepolia ETH to pay for this transaction. Top it up, then try again.";
    }

    // The rail client carries a status and a body but sets no name, so its failures are read off those
    const status = (error as { status?: number }).status;
    if (typeof status === "number") {
        const code = (error as { body?: { error?: string } }).body?.error ?? "";
        return RAIL[code] ?? "The transfer rail refused that request. Try again in a moment.";
    }

    if (/user rejected|user denied/i.test(error.message)) return MESSAGES.UserRejectedRequestError!;

    // A failed fetch is a TypeError with no name of its own, so the rail being down reads as network
    if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
        return "The transfer rail is unreachable. Check your connection and try again.";
    }

    // Some wallets refuse the transfer service's primary types, which contain spaces
    if (/invalid type|primarytype|unexpected token in type/i.test(error.message)) {
        return "This wallet will not sign the transfer service's request format. Connect a different wallet.";
    }

    if (/receipt payload is malformed/i.test(error.message)) {
        return "That receipt was written in a format Rewall cannot read.";
    }

    // A contract account returns an ERC-1271 signature, which has no recoverable key to derive from
    if (/expected a 65 byte signature/i.test(error.message)) {
        return "This wallet signs as a smart contract, which Rewall cannot derive a key from. Connect a standard wallet.";
    }
    if (/only the owner of/i.test(error.message)) {
        return "Only the wallet that holds this name can change who reads this secret.";
    }
    if (/no recovery entry|last recovery entry/i.test(error.message)) {
        return "A secret needs one recovery holder. Add another before removing this one.";
    }
    if (/owner's own key/i.test(error.message)) {
        return "Recovery points at your own key, so nothing could recover this. Name someone else or set up a recovery phrase.";
    }
    // A read that never reached the chain says nothing about the vault, only about the endpoint
    if (/rpc error|http request failed|timed out|rate limit|too many requests/i.test(error.message)) {
        return "The Sepolia endpoint did not answer. Try again in a moment.";
    }
    if (/schema version/i.test(error.message)) return "This secret was written by a newer version of Rewall.";
    if (/no resolver configured/i.test(error.message)) return "This name is not set up for Rewall yet.";
    if (/has published no rewall\.pubkey/i.test(error.message)) return "That name has not set up Rewall yet.";

    // A failure nobody has a sentence for still names itself, but viem prints the whole call it made
    // so only the opening line is worth reading and a long one is cut rather than pasted into the page
    const [first] = error.message.split("\n");
    if (!first) return FALLBACK;
    return `${FALLBACK} ${first.length > 120 ? `${first.slice(0, 120).trimEnd()}...` : first}`;
}
