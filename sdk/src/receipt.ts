/*
 * Payload of a secret whose rewall.type is "receipt", written by the payer after a private transfer
 * and granted to the names that should see it. The transfer itself leaves no trace on chain, so the
 * receipt is the only record of it, which makes the grant list the entire visibility control.
 * The blob carries no version of its own, so the version lives in the payload and decode refuses
 * anything it does not recognise rather than guessing at an older shape.
 */

const AMOUNT = /^[0-9]+$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const RECEIPT_VERSION = 1;

export type Receipt = {
    v: number;
    // Base units as a decimal string, since a uint256 does not survive a JavaScript number
    amount: string;
    token: string;
    // The ENS name of the other party, which is what makes a receipt readable rather than an address log
    counterparty: string;
    tx: string;
    direction: "sent" | "received";
};

export class ReceiptError extends Error {
    constructor(reason: string) {
        super(`receipt payload is malformed, ${reason}`);
    }
}

// A transaction id can hold characters an ENS label cannot, and a short label keeps the index small
export function receiptLabel(transactionId: string): string {
    const cleaned = transactionId.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (!cleaned) throw new ReceiptError("transaction id has no label safe characters");
    return `r-${cleaned.slice(0, 12)}`;
}

export function encodeReceipt(receipt: Omit<Receipt, "v">): Uint8Array {
    const payload: Receipt = { v: RECEIPT_VERSION, ...receipt };
    assertReceipt(payload);
    return new TextEncoder().encode(JSON.stringify(payload));
}

// A receipt can be written by a delegate, so a decoded payload is untrusted until it passes this
export function decodeReceipt(plaintext: Uint8Array): Receipt {
    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
        throw new ReceiptError("not valid JSON");
    }

    assertReceipt(parsed);
    return parsed;
}

function assertReceipt(value: unknown): asserts value is Receipt {
    if (typeof value !== "object" || value === null) throw new ReceiptError("not an object");
    const receipt = value as Record<string, unknown>;

    if (receipt.v !== RECEIPT_VERSION) throw new ReceiptError(`unsupported version ${String(receipt.v)}`);
    if (typeof receipt.amount !== "string" || !AMOUNT.test(receipt.amount)) {
        throw new ReceiptError("amount must be a decimal string in base units");
    }
    if (typeof receipt.token !== "string" || !ADDRESS.test(receipt.token)) {
        throw new ReceiptError("token must be an address");
    }
    if (typeof receipt.counterparty !== "string" || !receipt.counterparty) {
        throw new ReceiptError("counterparty must be a name");
    }
    if (typeof receipt.tx !== "string" || !receipt.tx) throw new ReceiptError("tx must be an identifier");
    if (receipt.direction !== "sent" && receipt.direction !== "received") {
        throw new ReceiptError("direction must be sent or received");
    }
}
