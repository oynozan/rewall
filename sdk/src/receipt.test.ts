import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeReceipt, encodeReceipt, ReceiptError, RECEIPT_VERSION, type Receipt } from "./receipt.ts";

const base = {
    amount: "1000000000000000000",
    token: "0x60d941370C582B741abbA665cEBFec5447A0Ac59",
    counterparty: "rewall-test-2.eth",
    tx: "7c55b320-1429-4151-8720-388af2f351b8",
    direction: "sent" as const,
};

const corrupt = (changes: Record<string, unknown>) =>
    new TextEncoder().encode(JSON.stringify({ v: RECEIPT_VERSION, ...base, ...changes }));

/* Round trip */

test("a receipt survives a round trip and carries the current version", () => {
    const decoded = decodeReceipt(encodeReceipt(base));
    assert.equal(decoded.v, RECEIPT_VERSION);
    assert.deepEqual({ ...decoded, v: undefined }, { ...base, v: undefined });
});

test("an amount larger than a safe integer keeps every digit", () => {
    const amount = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    assert.equal(decodeReceipt(encodeReceipt({ ...base, amount })).amount, amount);
});

/* Rejection, since a delegate can write the blob this parses */

test("a payload of another version is refused rather than guessed at", () => {
    assert.throws(() => decodeReceipt(corrupt({ v: 2 })), ReceiptError);
});

test("an amount that is not base units is refused", () => {
    for (const amount of ["1.5", "1e18", "-1", "", "0x10"]) {
        assert.throws(() => decodeReceipt(corrupt({ amount })), ReceiptError, `accepted ${amount}`);
    }
});

test("a token that is not an address is refused", () => {
    assert.throws(() => decodeReceipt(corrupt({ token: "rewall-test-1.eth" })), ReceiptError);
});

test("a missing counterparty or tx is refused", () => {
    assert.throws(() => decodeReceipt(corrupt({ counterparty: "" })), ReceiptError);
    assert.throws(() => decodeReceipt(corrupt({ tx: "" })), ReceiptError);
});

test("an unknown direction is refused", () => {
    assert.throws(() => decodeReceipt(corrupt({ direction: "inbound" })), ReceiptError);
});

test("plaintext that is not JSON is refused", () => {
    assert.throws(() => decodeReceipt(new TextEncoder().encode("not json")), ReceiptError);
});

test("encoding refuses to write a payload that could not be decoded", () => {
    assert.throws(() => encodeReceipt({ ...base, amount: "1.5" } as unknown as Omit<Receipt, "v">), ReceiptError);
});
