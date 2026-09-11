import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverTypedDataAddress, size, slice } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
    encodeTicket,
    transferDomain,
    Transfers,
    TRANSFER_FIELDS,
    TRANSFER_VAULT,
    WITHDRAW_TICKET_FIELDS,
} from "./transfer.ts";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const TOKEN = "0x60d941370C582B741abbA665cEBFec5447A0Ac59";
const SIG = `0x${"ab".repeat(65)}` as const;

/* Ticket encoding, which the vault slices back apart at fixed widths */

test("a ticket is 89 bytes of nonce, deadline and signature", () => {
    const ticket = encodeTicket(1n, 0x6aa3624bn, SIG);
    assert.equal(size(ticket), 89);
    assert.equal(slice(ticket, 0, 16), `0x${"00".repeat(15)}01`);
    assert.equal(slice(ticket, 16, 24), "0x000000006aa3624b");
    assert.equal(slice(ticket, 24, 89), SIG);
});

test("a nonce at the top of uint128 still fits its slot", () => {
    const ticket = encodeTicket(2n ** 128n - 1n, 1n, SIG);
    assert.equal(size(ticket), 89);
    assert.equal(slice(ticket, 0, 16), `0x${"ff".repeat(16)}`);
});

/* Request signing, the part the service checks */

test("a balances request recovers to the account that signed it", async () => {
    const message = { account: account.address, timestamp: 1767225600n };
    const signature = await account.signTypedData({
        domain: transferDomain(TRANSFER_VAULT),
        types: { "Retrieve Balances": TRANSFER_FIELDS["Retrieve Balances"] },
        primaryType: "Retrieve Balances",
        message,
    });

    const recovered = await recoverTypedDataAddress({
        domain: transferDomain(TRANSFER_VAULT),
        types: { "Retrieve Balances": TRANSFER_FIELDS["Retrieve Balances"] },
        primaryType: "Retrieve Balances",
        message,
        signature,
    });
    assert.equal(recovered, account.address);
});

// The signed message names the payer sender while the body names it account, so this would break silently
test("a private transfer signs sender and never account", async () => {
    const captured: any[] = [];
    const transfers = new Transfers({
        account: {
            address: account.address,
            signTypedData: async (data: any) => {
                captured.push(data);
                return SIG;
            },
        },
        api: "http://127.0.0.1:1",
    });

    await transfers.pay("0x000000000000000000000000000000000000dEaD", TOKEN, 1n).catch(() => {});

    assert.equal(captured.length, 1);
    assert.equal(captured[0].primaryType, "Private Token Transfer");
    assert.equal(captured[0].message.sender, account.address);
    assert.equal(captured[0].message.account, undefined);
    assert.equal(captured[0].message.amount, 1n);
});

test("the vault the domain binds to is the one the client was given", () => {
    const other = "0x73131Bfe56106642E91DE5B34868BC590181A7ec" as const;
    assert.equal(transferDomain(other).verifyingContract, other);
    assert.notEqual(transferDomain(other).verifyingContract, TRANSFER_VAULT);
});

test("the withdraw ticket type matches the typehash the vault computes", () => {
    const fields = WITHDRAW_TICKET_FIELDS.WithdrawTicket.map((f) => `${f.type} ${f.name}`).join(",");
    assert.equal(fields, "address withdrawer,address token,uint256 amount,uint128 nonce,uint64 deadline");
});
