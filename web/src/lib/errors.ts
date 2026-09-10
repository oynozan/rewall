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

const FALLBACK = "Something went wrong. Try again.";

export function explain(error: unknown): string {
    if (!(error instanceof Error)) return FALLBACK;
    if (MESSAGES[error.name]) return MESSAGES[error.name];

    // viem nests the cause the user actually triggered, most often a rejected prompt
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && MESSAGES[cause.name]) return MESSAGES[cause.name];

    if (/user rejected|user denied/i.test(error.message)) return MESSAGES.UserRejectedRequestError!;

    // A contract account returns an ERC-1271 signature, which has no recoverable key to derive from
    if (/expected a 65 byte signature/i.test(error.message)) {
        return "This wallet signs as a smart contract, which Rewall cannot derive a key from. Connect a standard wallet.";
    }
    if (/schema version/i.test(error.message)) return "This secret was written by a newer version of Rewall.";
    if (/no resolver configured/i.test(error.message)) return "This name is not set up for Rewall yet.";
    if (/has published no rewall\.pubkey/i.test(error.message)) return "That name has not set up Rewall yet.";

    return FALLBACK;
}
