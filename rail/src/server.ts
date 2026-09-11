/*
 * Local stand in for the Chainlink private token API. It speaks the same five endpoints with the
 * same request and response shapes, authenticates every call by recovering the EIP-712 signature
 * against the claimed account, and asks the real ACE policy engine on chain before moving anything.
 * Balances and shielded address mappings live in SQLite, and withdrawals are released as tickets
 * the vault verifies against this process's signing key.
 */

import { createServer } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { createPublicClient, http, getAddress, parseAbi, toHex, verifyTypedData, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
    MAX_REQUEST_AGE_SECONDS,
    PORT,
    TICKET_SIGNER_INDEX,
    TICKET_TTL_SECONDS,
    rpcUrl,
    vaultAddress,
} from "./config.ts";
import {
    TRANSFER_FIELDS as REQUEST_FIELDS,
    WITHDRAW_TICKET_FIELDS,
    transferDomain as domain,
    encodeTicket,
} from "@rewall/sdk";
import * as db from "./db.ts";
import { startIndexer } from "./indexer.ts";

const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set");

const signer = mnemonicToAccount(mnemonic, { addressIndex: TICKET_SIGNER_INDEX });
const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl()) });

const vaultAbi = parseAbi([
    "function checkPrivateTransferAllowed(address from, address to, address token, uint256 amount) view",
    "function checkWithdrawAllowed(address withdrawer, address token, uint256 amount) view",
]);

class ApiError extends Error {
    status: number;
    code: string;
    detail: string;

    constructor(status: number, code: string, detail: string) {
        super(detail);
        this.status = status;
        this.code = code;
        this.detail = detail;
    }
}

/* Authentication */

// Recovers the signature against the account the body claims, which is what makes the body trustworthy
async function authenticate(
    body: Record<string, any>,
    primaryType: keyof typeof REQUEST_FIELDS,
    message: Record<string, unknown>,
) {
    const account = body.account;
    if (typeof account !== "string") throw new ApiError(400, "invalid_request", "account is required");

    const timestamp = Number(body.timestamp);
    if (!Number.isFinite(timestamp)) throw new ApiError(400, "invalid_request", "timestamp is required");

    // The deployed UI sends milliseconds while its CLI sends seconds, so both are accepted
    const seconds = timestamp > 1e12 ? Math.floor(timestamp / 1000) : timestamp;
    if (Math.abs(Math.floor(Date.now() / 1000) - seconds) > MAX_REQUEST_AGE_SECONDS) {
        throw new ApiError(401, "request authentication failed", "timestamp outside the accepted window");
    }

    const valid = await verifyTypedData({
        address: getAddress(account),
        domain: domain(vaultAddress()),
        types: { [primaryType]: REQUEST_FIELDS[primaryType] },
        primaryType,
        message: { ...message, timestamp: BigInt(body.timestamp) },
        signature: body.auth as Hex,
    }).catch(() => false);

    if (!valid) throw new ApiError(401, "request authentication failed", "signature does not match account");
    return getAddress(account);
}

// Reverts carry the policy failure, so a rejection is reported rather than treated as a server fault
async function assertPolicyAllows(functionName: "checkPrivateTransferAllowed" | "checkWithdrawAllowed", args: any[]) {
    try {
        await client.readContract({ address: vaultAddress(), abi: vaultAbi, functionName, args });
    } catch (error) {
        throw new ApiError(403, "policy_denied", (error as Error).message.split("\n")[0]);
    }
}

/* Endpoints */

const handlers: Record<string, (body: Record<string, any>) => Promise<unknown>> = {
    "/balances": async (body) => {
        const account = await authenticate(body, "Retrieve Balances", { account: body.account });
        return { balances: db.balancesOf(account) };
    },

    "/transactions": async (body) => {
        const limit = Number(body.limit ?? 10);
        const account = await authenticate(body, "List Transactions", {
            account: body.account,
            cursor: body.cursor ?? "",
            limit: BigInt(limit),
        });
        const rows = db.transactionsOf(account, limit + 1, body.cursor || undefined);
        const page = rows.slice(0, limit);
        return {
            transactions: page,
            has_more: rows.length > limit,
            next_cursor: rows.length > limit ? (page[page.length - 1] as any).id : null,
        };
    },

    "/shielded-address": async (body) => {
        const account = await authenticate(body, "Generate Shielded Address", { account: body.account });
        const address = getAddress(toHex(randomBytes(20)));
        db.putShielded(address, account);
        return { address };
    },

    "/private-transfer": async (body) => {
        const sender = await authenticate(body, "Private Token Transfer", {
            sender: body.account,
            recipient: body.recipient,
            token: body.token,
            amount: BigInt(body.amount),
            flags: body.flags ?? [],
        });

        const amount = BigInt(body.amount);
        const recipient = getAddress(db.resolveShielded(body.recipient));
        const flags: string[] = body.flags ?? [];

        if (db.balanceOf(sender, body.token) < amount) {
            throw new ApiError(400, "insufficient_balance", "sender balance is below the requested amount");
        }
        await assertPolicyAllows("checkPrivateTransferAllowed", [sender, recipient, body.token, amount]);

        db.debit(sender, body.token, amount);
        db.credit(recipient, body.token, amount);

        const id = randomUUID();
        db.recordTransaction({
            id,
            account: sender,
            type: "transfer_out",
            counterparty: recipient,
            token: body.token,
            amount,
        });
        db.recordTransaction({
            id: randomUUID(),
            account: recipient,
            type: "transfer_in",
            // hide-sender keeps the payer out of the recipient's history, which is the flag's whole purpose
            counterparty: flags.includes("hide-sender") ? null : sender,
            token: body.token,
            amount,
        });

        return { transaction_id: id };
    },

    "/withdraw": async (body) => {
        const account = await authenticate(body, "Withdraw Tokens", {
            account: body.account,
            token: body.token,
            amount: BigInt(body.amount),
        });

        const amount = BigInt(body.amount);
        if (db.balanceOf(account, body.token) < amount) {
            throw new ApiError(400, "insufficient_balance", "balance is below the requested amount");
        }
        await assertPolicyAllows("checkWithdrawAllowed", [account, body.token, amount]);

        db.debit(account, body.token, amount);
        const deadline = Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS;
        const nonce = db.issueTicket(account, body.token, amount, deadline);

        const signature = await signer.signTypedData({
            domain: domain(vaultAddress()),
            types: WITHDRAW_TICKET_FIELDS,
            primaryType: "WithdrawTicket",
            message: { withdrawer: account, token: getAddress(body.token), amount, nonce, deadline: BigInt(deadline) },
        });

        return {
            id: randomUUID(),
            account,
            token: body.token,
            amount: amount.toString(),
            deadline,
            ticket: encodeTicket(nonce, BigInt(deadline), signature),
        };
    },
};

/* Transport */

const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
    };

    const handler = handlers[req.url ?? ""];
    if (!handler || req.method !== "POST") {
        return send(404, {
            error: "not_found",
            error_details: `no handler for ${req.method} ${req.url}`,
            request_id: requestId,
        });
    }

    try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        send(200, await handler(body));
    } catch (error) {
        if (error instanceof ApiError) {
            return send(error.status, { error: error.code, error_details: error.detail, request_id: requestId });
        }
        console.error(error);
        send(500, { error: "internal_error", error_details: (error as Error).message, request_id: requestId });
    }
});

startIndexer();
server.listen(PORT, () => {
    console.log(`rail listening on http://127.0.0.1:${PORT}`);
    console.log(`vault ${vaultAddress()}`);
    console.log(`ticket signer ${signer.address}`);
});
