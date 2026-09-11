"use client";

/*
 * Holds the transfer balance for the connected wallet. Every rail call signs an EIP-712 message, so a
 * naive poll would be a wallet prompt per tick. The rail's authentication has a five minute window
 * and no nonce, so one signed balance body is recorded and replayed until it goes stale, which makes
 * refreshing free. Nothing is read on mount, the first read is always something the user asked for.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createWalletClient, custom, maxUint256, parseAbi, type Address, type EIP1193Provider, type Hex } from "viem";
import { sepolia } from "viem/chains";
import type { Balance, Ticket, TransferSigner } from "@rewall/sdk";
import { railFor, railVault, RAIL_API, RAIL_TOKEN } from "@/src/lib/rail";
import { explain } from "@/src/lib/errors";
import { vaultClient } from "@/src/lib/vault";

// Sixty seconds under the rail's window, so a slightly skewed clock does not start failing silently
const REPLAY_MS = 240_000;

// A ticket is an authorization the vault only honours for the address that asked, not a secret
const ticketKey = (address: string) => `rewall.ticket.${address.toLowerCase()}`;

const erc20Abi = parseAbi([
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address owner) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
]);
const vaultAbi = parseAbi([
    "function deposit(address token, uint256 amount)",
    "function withdrawWithTicket(address token, uint256 amount, bytes ticket)",
]);

// Read once, since the vault comes from the build and a miss has to disable the feature rather than throw
const config = (() => {
    try {
        return { vault: railVault(), token: RAIL_TOKEN, error: "" };
    } catch (failure) {
        return { vault: null, token: null, error: (failure as Error).message };
    }
})();

export type Token = { address: Address; symbol: string; decimals: number };

type RailSession = {
    configured: boolean;
    token: Token | null;
    balance: bigint | null;
    loading: boolean;
    error: string;
    refresh: () => Promise<bigint | null>;
    awaitCredit: (previous: bigint) => Promise<bigint | null>;
    walletBalance: () => Promise<bigint>;
    shielded: () => Promise<Address>;
    pay: (recipient: Address, amount: bigint) => Promise<string>;
    deposit: (amount: bigint, step: (label: string) => void) => Promise<void>;
    withdraw: (amount: bigint) => Promise<Ticket>;
    redeem: (held: Ticket) => Promise<Hex>;
    ticket: Ticket | null;
    forgetTicket: () => void;
};

const RailContext = createContext<RailSession | null>(null);

export function useRail() {
    const session = useContext(RailContext);
    if (!session) throw new Error("Transfers must be inside the dashboard");
    return session;
}

export function RailProvider({
    children,
    address,
    getProvider,
}: {
    children: React.ReactNode;
    address: string;
    getProvider: () => Promise<EIP1193Provider | null>;
}) {
    const [token, setToken] = useState<Token | null>(null);
    const [balance, setBalance] = useState<bigint | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(config.error);
    // Read once at mount, which is every address change because the provider is keyed on the account
    const [ticket, setTicket] = useState<Ticket | null>(() => {
        try {
            const held = localStorage.getItem(ticketKey(address));
            return held ? JSON.parse(held) : null;
        } catch {
            return null;
        }
    });

    const transfers = useRef<ReturnType<typeof railFor> | null>(null);
    const wallet = useRef<ReturnType<typeof createWalletClient> | null>(null);
    const replay = useRef<{ body: string; at: number } | null>(null);

    /* Setup */

    useEffect(() => {
        if (!config.token) return;
        let active = true;
        void Promise.all([
            vaultClient.readContract({ address: config.token, abi: erc20Abi, functionName: "symbol" }),
            vaultClient.readContract({ address: config.token, abi: erc20Abi, functionName: "decimals" }),
        ])
            .then(([symbol, decimals]) => {
                if (active) setToken({ address: config.token!, symbol, decimals });
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    const clients = useCallback(async () => {
        if (transfers.current && wallet.current) return { rail: transfers.current, chain: wallet.current };
        const provider = await getProvider();
        if (!provider || !address) throw new Error("Connect your wallet first.");

        const chain = createWalletClient({ account: address as Address, chain: sepolia, transport: custom(provider) });
        // The signed balance body is the whole request, so recording it here needs no wire format of its own
        const signer: TransferSigner = {
            address: address as Address,
            signTypedData: async (data) => {
                const auth = await chain.signTypedData({ account: address as Address, ...data });
                if (data.primaryType === "Retrieve Balances") {
                    const timestamp = Number(data.message.timestamp);
                    replay.current = { body: JSON.stringify({ account: address, timestamp, auth }), at: Date.now() };
                }
                return auth;
            },
        };
        transfers.current = railFor(signer);
        wallet.current = chain;
        return { rail: transfers.current, chain };
    }, [address, getProvider]);

    /* Reads */

    const readBalances = useCallback(async (): Promise<Balance[]> => {
        const held = replay.current;
        if (held && Date.now() - held.at < REPLAY_MS) {
            const response = await fetch(`${RAIL_API}/balances`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: held.body,
            });
            // A stale or refused replay falls through to a fresh signature, so the window closing is not an error
            if (response.ok) return ((await response.json()) as { balances: Balance[] }).balances;
        }
        return (await clients()).rail.balances();
    }, [clients]);

    const refresh = useCallback(async () => {
        if (!config.token) return null;
        setLoading(true);
        setError("");
        try {
            const rows = await readBalances();
            const held = rows.find((row) => row.token.toLowerCase() === config.token!.toLowerCase());
            const now = BigInt(held?.amount ?? 0);
            setBalance(now);
            return now;
        } catch (failure) {
            setError(explain(failure));
            return null;
        } finally {
            setLoading(false);
        }
    }, [readBalances]);

    // A deposit credits only once the indexer has seen it confirmed, so one read after the receipt
    // lands is always too early and the balance would sit at its old value looking broken
    const awaitCredit = useCallback(
        async (previous: bigint) => {
            for (let attempt = 0; attempt < 12; attempt++) {
                const now = await refresh();
                if (now !== null && now > previous) return now;
                await new Promise((resume) => setTimeout(resume, 5000));
            }
            return null;
        },
        [refresh],
    );

    const walletBalance = useCallback(async () => {
        return vaultClient.readContract({
            address: config.token!,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address as Address],
        });
    }, [address]);

    /* Writes */

    const shielded = useCallback(async () => (await clients()).rail.shieldedAddress(), [clients]);

    // hide-sender keeps the payer out of the recipient's history, so the receipt grant is the only disclosure
    const pay = useCallback(
        async (recipient: Address, amount: bigint) =>
            (await clients()).rail.pay(recipient, config.token!, amount, ["hide-sender"]),
        [clients],
    );

    const deposit = useCallback(
        async (amount: bigint, step: (label: string) => void) => {
            const { chain } = await clients();
            const allowance = await vaultClient.readContract({
                address: config.token!,
                abi: erc20Abi,
                functionName: "allowance",
                args: [address as Address, config.vault!],
            });

            // Approved to the maximum once, so every deposit after the first is a single transaction
            if (allowance < amount) {
                step("Approving the vault…");
                const approval = await chain.writeContract({
                    address: config.token!,
                    abi: erc20Abi,
                    functionName: "approve",
                    args: [config.vault!, maxUint256],
                    account: address as Address,
                    chain: sepolia,
                });
                await vaultClient.waitForTransactionReceipt({ hash: approval });
            }

            step("Waiting for your wallet…");
            const hash = await chain.writeContract({
                address: config.vault!,
                abi: vaultAbi,
                functionName: "deposit",
                args: [config.token!, amount],
                account: address as Address,
                chain: sepolia,
            });
            step("Confirming on Sepolia…");
            const receipt = await vaultClient.waitForTransactionReceipt({ hash });
            if (receipt.status !== "success") throw new Error(`deposit reverted ${hash}`);
        },
        [address, clients],
    );

    const withdraw = useCallback(
        async (amount: bigint) => {
            const issued = await (await clients()).rail.withdraw(config.token!, amount);
            // The rail debits the moment this returns, so the ticket is stored before any render can fail
            try {
                localStorage.setItem(ticketKey(address), JSON.stringify(issued));
            } catch {}
            setTicket(issued);
            return issued;
        },
        [address, clients],
    );

    const forgetTicket = useCallback(() => {
        try {
            localStorage.removeItem(ticketKey(address));
        } catch {}
        setTicket(null);
    }, [address]);

    const redeem = useCallback(
        async (held: Ticket) => {
            const { chain } = await clients();
            const hash = await chain.writeContract({
                address: config.vault!,
                abi: vaultAbi,
                functionName: "withdrawWithTicket",
                args: [held.token as Address, BigInt(held.amount), held.ticket],
                account: address as Address,
                chain: sepolia,
            });
            const receipt = await vaultClient.waitForTransactionReceipt({ hash });
            if (receipt.status !== "success") throw new Error(`redeem reverted ${hash}`);
            forgetTicket();
            return hash;
        },
        [address, clients, forgetTicket],
    );

    const session: RailSession = {
        configured: Boolean(config.token && config.vault),
        token,
        balance,
        loading,
        error,
        refresh,
        awaitCredit,
        walletBalance,
        shielded,
        pay,
        deposit,
        withdraw,
        redeem,
        ticket,
        forgetTicket,
    };
    return <RailContext value={session}>{children}</RailContext>;
}
