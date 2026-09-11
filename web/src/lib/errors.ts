// Matched on name rather than instanceof, which survives the SDK being a linked package
const MESSAGES: Record<string, string> = {
    NoWrapError: "You do not have access to this secret.",
    MissingBlobError: "No secret is stored at this name.",
    SecretExistsError: "A secret already lives at this name.",
    KeyCommitmentError: "This value does not belong to this name. It may have been tampered with.",
    PaddingError: "The stored value is corrupt and could not be read.",
    UnauthorizedListError: "The access list was signed by someone who does not own this name.",
    ForgedShareError: "One of the guardian shares was malformed and was rejected.",
    RecoveryFailedError: "Those guardian shares do not rebuild the recovery key.",
    UserRejectedRequestError: "You turned down the wallet request.",
};

// The rail names its failures in the body, which is more precise than the status they arrive with
const RAIL: Record<string, string> = {
    insufficient_balance: "Your balance is below that amount.",
    policy_denied: "The transfer policy refused this payment.",
    "request authentication failed": "The transfer rail refused the signature. Check your device clock, then retry.",
    invalid_request: "The transfer rail could not read that request.",
    not_found: "The transfer rail has no record of that account yet.",
    internal_error: "The transfer rail is having trouble. Try again in a moment.",
};

const FALLBACK = "Something went wrong. Try again.";

export function explain(error: unknown): string {
    if (!(error instanceof Error)) return FALLBACK;
    if (MESSAGES[error.name]) return MESSAGES[error.name];

    // viem nests the cause the user actually triggered, most often a rejected prompt
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && MESSAGES[cause.name]) return MESSAGES[cause.name];

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
    if (/schema version/i.test(error.message)) return "This secret was written by a newer version of Rewall.";
    if (/no resolver configured/i.test(error.message)) return "This name is not set up for Rewall yet.";
    if (/has published no rewall\.pubkey/i.test(error.message)) return "That name has not set up Rewall yet.";

    return FALLBACK;
}
