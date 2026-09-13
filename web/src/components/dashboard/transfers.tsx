"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useWorkspace } from "./dashboard-shell";
import { usePrivateData } from "./private-data";
import { useRail } from "./rail";
import { PendingTicket, PublishShielded, receiptAmount } from "./transfer-forms";

import { FadeIn } from "./amicro";
import { DotGrid } from "./dot-grid";
import { LiquidMetalButton } from "./liquid-metal-button";
import { DAY, MOMENT, sharedTitle, sharedWith } from "./secrets-table";
import { Glyph, Icon, SkeletonRows } from "./ui";
import { ownerName } from "@/src/lib/vault";
import { unwatchName, watchedNames, watchName } from "@/src/lib/account";

export function TransfersTable({ direction, compact = false }: { direction: "sent" | "shared"; compact?: boolean }) {
    const { vault, busy, error, setPanel } = useWorkspace();
    const { shared, receipts, scanning, pending, openReceipt } = usePrivateData();
    const { token } = useRail();

    const rows =
        direction === "sent"
            ? (vault?.secrets || [])
                  .filter((secret) => secret.type === "receipt")
                  .map((secret) => ({ secret, from: "" }))
            : shared.map((entry) => ({ secret: entry.secret, from: entry.owner }));

    const shown = compact ? rows.slice(0, 4) : rows;
    const loading = direction === "sent" ? busy : busy || scanning;
    return (
        <div className="secrets-browser transfer-browser" aria-busy={loading}>
            <div className="table-scroll">
                <table className="transfer-table">
                    <colgroup>
                        <col className="table-select-col" />
                        <col className="table-name-col" />
                        <col className="transfer-party-col" />
                        <col className="transfer-shared-col" />
                        <col className="transfer-date-col" />
                        <col className="transfer-amount-col" />
                    </colgroup>
                    <thead>
                        <tr>
                            <th scope="col" colSpan={2}>
                                Receipt
                            </th>
                            <th scope="col">{direction === "sent" ? "Paid" : "From"}</th>
                            <th scope="col">Shared with</th>
                            <th scope="col">Created</th>
                            <th scope="col">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && <SkeletonRows rows={4} columns={6} />}
                        {!loading &&
                            !error &&
                            shown.map(({ secret, from }) => {
                                const receipt = receipts[secret.name];
                                // Who sent you a receipt is public on their vault, while who you paid is sealed inside yours
                                const party = from || receipt?.counterparty;
                                return (
                                    <tr key={secret.name}>
                                        <td colSpan={2}>
                                            <button className="secret-name" onClick={() => setPanel(secret)}>
                                                <span className="secret-icon">
                                                    <Icon name="wallet" />
                                                </span>
                                                <span>
                                                    <strong>{secret.label}</strong>
                                                    <small>{secret.name}</small>
                                                </span>
                                            </button>
                                        </td>
                                        <td className="transfer-party mono" title={party}>
                                            {party || <span className="unset">—</span>}
                                        </td>
                                        <td className="access-cell" title={sharedTitle(secret)}>
                                            {sharedWith(secret) || <span className="unset">Only you</span>}
                                        </td>
                                        <td className="date-cell">
                                            {secret.created ? (
                                                <time
                                                    dateTime={new Date(secret.created * 1000).toISOString()}
                                                    title={MOMENT.format(secret.created * 1000)}
                                                >
                                                    {DAY.format(secret.created * 1000)}
                                                </time>
                                            ) : (
                                                "—"
                                            )}
                                        </td>
                                        <td>
                                            {receipt ? (
                                                <span className="mono">{receiptAmount(receipt, token)}</span>
                                            ) : (
                                                <button
                                                    className="transfer-locked"
                                                    disabled={pending === secret.name}
                                                    onClick={() => void openReceipt(secret.name)}
                                                >
                                                    <Icon name="lock" size={15} />
                                                    {pending === secret.name ? "Opening…" : "Reveal"}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                    </tbody>
                </table>
            </div>
            {loading && (
                <p className="sr-only" role="status">
                    Loading receipts
                </p>
            )}
            {!loading && (error || !shown.length) && (
                <div className="quiet-empty" role="status">
                    {error
                        ? "Sent transfers unavailable"
                        : direction === "sent"
                          ? "No receipts yet"
                          : "No shared receipts"}
                </div>
            )}
        </div>
    );
}

/* Balance */

export function BalanceBar() {
    const { setPanel } = useWorkspace();
    const rail = useRail();
    const { token, balance, walletBalance, configured } = rail;
    const [held, setHeld] = useState<bigint | null>(null);

    // A wallet balance is a public read, so it can say where the money is without costing a signature
    useEffect(() => {
        if (!configured) return;
        let active = true;
        void walletBalance()
            .then((amount) => {
                if (active) setHeld(amount);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [configured, walletBalance]);

    const hidden = balance === null || !token;
    const inWallet = held !== null && token ? `${formatUnits(held, token.decimals)} ${token.symbol}` : "";

    return (
        <>
            <aside className="extension-banner balance-banner" aria-label="Transfer balance">
                <DotGrid />
                <div className="extension-copy">
                    {/* Refreshing belongs to the number rather than to the three money actions */}
                    <span className="balance-label">
                        Balance
                        {!hidden && (
                            <button
                                className="icon-button"
                                aria-label="Refresh balance"
                                disabled={rail.loading}
                                onClick={() => void rail.refresh()}
                            >
                                <Glyph name="refresh" size={14} />
                            </button>
                        )}
                    </span>
                    <h2 className="balance-figure mono">
                        {hidden ? "—" : formatUnits(balance, token.decimals)} {token?.symbol ?? ""}
                    </h2>
                    <p>
                        {hidden
                            ? "Reading it takes a signature."
                            : "Spendable by name, without gas and without a transaction."}
                        {inWallet && (
                            <>
                                {" "}
                                <span className="mono balance-wallet">{inWallet}</span> sits in your wallet outside the
                                vault.
                            </>
                        )}
                    </p>
                </div>
                <div className="extension-actions">
                    {hidden ? (
                        <button className="button primary" disabled={rail.loading} onClick={() => void rail.refresh()}>
                            {rail.loading ? "Reading…" : "Show balance"}
                        </button>
                    ) : (
                        // Moving your own money in and out is what the banner itself offers
                        <div className="balance-pair">
                            <button className="button" onClick={() => setPanel("fund")}>
                                Deposit
                            </button>
                            <button className="button" onClick={() => setPanel("withdraw")}>
                                Withdraw
                            </button>
                        </div>
                    )}
                </div>
            </aside>

            {/* Below the banner rather than inside it, since paying somebody is the page's own action */}
            {!hidden && (
                <div className="balance-send">
                    <LiquidMetalButton fullWidth label="Send confidential transfer" onClick={() => setPanel("send")} />
                </div>
            )}

            <PendingTicket />
            {rail.error && (
                <p className="form-error" role="alert">
                    {rail.error}
                </p>
            )}
        </>
    );
}

/* Watching */

// Receipts live in the sender's vault, so a name has to be named before this side can find one
function WatchNames() {
    const { account } = useWorkspace();
    const { rescan } = usePrivateData();
    const [names, setNames] = useState(() => (account ? watchedNames(account) : []));
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState("");

    function add(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        try {
            watchName(account, ownerName(String(new FormData(event.currentTarget).get("name"))));
            setNames(watchedNames(account));
            setAdding(false);
            rescan();
        } catch {
            setError("Enter a complete ENS name ending in .eth.");
        }
    }

    function drop(name: string) {
        unwatchName(account, name);
        setNames(watchedNames(account));
        rescan();
    }

    return (
        <>
            <div className="section-heading">
                <h2>Shared with you</h2>
                <button className="text-button" onClick={() => setAdding(!adding)}>
                    {adding ? "Cancel" : "Watch a name"}
                </button>
            </div>

            {adding && (
                <form onSubmit={add} className="table-toolbar">
                    <input
                        className="watch-input"
                        name="name"
                        placeholder="alice.eth"
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        autoFocus
                        required
                    />
                    <button className="button primary">Watch</button>
                </form>
            )}

            {names.length > 0 && (
                <div className="watch-chips">
                    {names.map((name) => (
                        <span key={name} className="watch-chip mono">
                            {name}
                            <button
                                className="icon-button"
                                aria-label={`Stop watching ${name}`}
                                onClick={() => drop(name)}
                            >
                                <Glyph name="close" size={13} />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
        </>
    );
}

export function TransfersPage() {
    return (
        <FadeIn className="secrets-page">
            <div className="page-heading">
                <h1>Transfers</h1>
                <div className="page-actions">
                    <PublishShielded />
                </div>
            </div>

            <BalanceBar />

            <div className="transfer-sections transfers-page-tables">
                <section>
                    <div className="section-heading">
                        <h2>Sent</h2>
                    </div>
                    <TransfersTable direction="sent" />
                </section>
                <section>
                    <WatchNames />
                    <TransfersTable direction="shared" />
                </section>
            </div>
        </FadeIn>
    );
}
