/*
 * Client for the private transfer rail SPEC section 9 names, Chainlink's vault plus its private
 * token API. Only the five endpoints that service documents are used, so the rail stays swappable
 * and pointing at another deployment is a matter of passing api and vault. Every request carries an
 * EIP-712 signature in an auth field. The primary type names contain spaces exactly as the service
 * defines them, and a private transfer signs the payer as sender while the body sends the same
 * address as account, so the signed message and the request body are built separately below.
 */

import { concatHex, numberToHex, type Address, type Hex } from "viem";

export const TRANSFER_API = "https://convergence2026-token-api.cldev.cloud";
export const TRANSFER_VAULT: Address = "0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13";

export const TRANSFER_DOMAIN_NAME = "CompliantPrivateTokenDemo";
export const TRANSFER_DOMAIN_VERSION = "0.0.1";

export const transferDomain = (verifyingContract: Address, chainId = 11155111) =>
    ({
        name: TRANSFER_DOMAIN_NAME,
        version: TRANSFER_DOMAIN_VERSION,
        chainId,
        verifyingContract,
    }) as const;

export const TRANSFER_FIELDS = {
    "Retrieve Balances": [
        { name: "account", type: "address" },
        { name: "timestamp", type: "uint256" },
    ],
    "Generate Shielded Address": [
        { name: "account", type: "address" },
        { name: "timestamp", type: "uint256" },
    ],
    "List Transactions": [
        { name: "account", type: "address" },
        { name: "timestamp", type: "uint256" },
        { name: "cursor", type: "string" },
        { name: "limit", type: "uint256" },
    ],
    "Private Token Transfer": [
        { name: "sender", type: "address" },
        { name: "recipient", type: "address" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "flags", type: "string[]" },
        { name: "timestamp", type: "uint256" },
    ],
    "Withdraw Tokens": [
        { name: "account", type: "address" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "timestamp", type: "uint256" },
    ],
} as const;

// Signed by the service and sliced apart by the vault, which is why the widths are fixed
export const WITHDRAW_TICKET_FIELDS = {
    WithdrawTicket: [
        { name: "withdrawer", type: "address" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint128" },
        { name: "deadline", type: "uint64" },
    ],
} as const;

export const encodeTicket = (nonce: bigint, deadline: bigint, signature: Hex): Hex =>
    concatHex([numberToHex(nonce, { size: 16 }), numberToHex(deadline, { size: 8 }), signature]);

export type TransferSigner = {
    address: Address;
    signTypedData: (data: any) => Promise<Hex>;
};

export type Balance = { token: string; amount: string };
export type Ticket = { id: string; account: string; token: string; amount: string; deadline: number; ticket: Hex };

export class TransferError extends Error {
    status: number;
    body: unknown;

    constructor(endpoint: string, status: number, body: unknown) {
        super(`${endpoint} failed ${status} ${JSON.stringify(body)}`);
        this.status = status;
        this.body = body;
    }
}

export class Transfers {
    readonly api: string;
    readonly vault: Address;
    private readonly account: TransferSigner;

    constructor(options: { account: TransferSigner; api?: string; vault?: Address }) {
        this.account = options.account;
        this.api = options.api ?? TRANSFER_API;
        this.vault = options.vault ?? TRANSFER_VAULT;
    }

    get address(): Address {
        return this.account.address;
    }

    async balances(): Promise<Balance[]> {
        const result = await this.call("/balances", "Retrieve Balances", { account: this.account.address }, {});
        return (result as { balances: Balance[] }).balances;
    }

    // Base units, so the caller never has to reason about decimals
    async held(token: string): Promise<bigint> {
        const balances = await this.balances();
        return BigInt(balances.find((b) => b.token.toLowerCase() === token.toLowerCase())?.amount ?? 0n);
    }

    async transactions(limit = 10, cursor = ""): Promise<{ transactions: unknown[]; has_more: boolean }> {
        const result = await this.call(
            "/transactions",
            "List Transactions",
            { account: this.account.address, cursor, limit: BigInt(limit) },
            { cursor, limit },
        );
        return result as { transactions: unknown[]; has_more: boolean };
    }

    // A fresh one per payer is what stops two senders from linking their payments to one account
    async shieldedAddress(): Promise<Address> {
        const result = await this.call(
            "/shielded-address",
            "Generate Shielded Address",
            { account: this.account.address },
            {},
        );
        return (result as { address: Address }).address;
    }

    // The signed message calls the payer sender while the body calls it account, matching the service
    async pay(recipient: string, token: string, amount: bigint, flags: string[] = []): Promise<string> {
        const result = await this.call(
            "/private-transfer",
            "Private Token Transfer",
            { sender: this.account.address, recipient, token, amount, flags },
            { recipient, token, amount: amount.toString(), flags },
        );
        return (result as { transaction_id: string }).transaction_id;
    }

    async withdraw(token: string, amount: bigint): Promise<Ticket> {
        const result = await this.call(
            "/withdraw",
            "Withdraw Tokens",
            { account: this.account.address, token, amount },
            { token, amount: amount.toString() },
        );
        return result as Ticket;
    }

    private async call(
        endpoint: string,
        primaryType: keyof typeof TRANSFER_FIELDS,
        message: Record<string, unknown>,
        body: Record<string, unknown>,
    ): Promise<unknown> {
        const timestamp = Math.floor(Date.now() / 1000);

        const auth = await this.account.signTypedData({
            domain: transferDomain(this.vault),
            types: { [primaryType]: TRANSFER_FIELDS[primaryType] },
            primaryType,
            message: { ...message, timestamp: BigInt(timestamp) },
        });

        const response = await fetch(`${this.api}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account: this.account.address, ...body, timestamp, auth }),
        });

        const data = await response.json();
        if (!response.ok) throw new TransferError(endpoint, response.status, data);
        return data;
    }
}
