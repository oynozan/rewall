"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useWorkspace } from "./dashboard-shell";
import { usePrivateData } from "./private-data";
import { useRail } from "./rail";
import { PendingTicket, PublishShielded, receiptAmount } from "./transfer-forms";
import { FadeIn } from "./amicro";
import { Glyph, Icon, TableColumns } from "./ui";
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
                  .map((secret) => ({ secret, counterparty: secret.grantees.join(", ") || "Only you" }))
            : shared.map((entry) => ({ secret: entry.secret, counterparty: entry.owner }));

    const shown = compact ? rows.slice(0, 4) : rows;
    const loading = direction === "sent" ? busy : scanning;
    return (
        <div className="secrets-browser transfer-browser" aria-busy={loading}>
            <div className="table-scroll">
                <table className="transfer-table">
                    <TableColumns />
                    <thead>
                        <tr>
                            <th scope="col" colSpan={2}>
                                Receipt
                            </th>
                            <th scope="col">{direction === "sent" ? "Shared with" : "From"}</th>
                            <th scope="col" colSpan={2}>
                                Amount
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {!loading &&
                            !error &&
                            shown.map(({ secret, counterparty }) => {
                                const receipt = receipts[secret.name];
                                return (
                                    <tr key={secret.name}>
                                        <td colSpan={2}>
                                            <button className="secret-name" onClick={() => setPanel(secret)}>
                                                <span className="secret-icon">
                                                    <Icon name="wallet" />
                                                </span>
                                                <span>
                                                    <strong>{secret.label}</strong>
                                                    <small>
                                                        {secret.created
                                                            ? new Date(secret.created * 1000).toLocaleDateString(
                                                                  "en-GB",
                                                                  { day: "numeric", month: "short", timeZone: "UTC" },
                                                              )
                                                            : "—"}
                                                    </small>
                                                </span>
                                            </button>
                                        </td>
                                        <td className="transfer-recipient">
                                            {receipt ? receipt.counterparty : counterparty}
                                        </td>
                                        <td colSpan={2}>
                                            {receipt ? (
                                                <span className="mono">{receiptAmount(receipt, token)}</span>
                                            ) : (
                                                <button
                                                    className="transfer-locked"
                                                    disabled={pending === secret.name}
                                                    onClick={() => void openReceipt(secret.name)}
                                                >
                                                    <Icon name="lock" size={15} />
                                                    {pending === secret.name ? "Opening…" : "Encrypted"}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                    </tbody>
                </table>
            </div>
            {(loading || error || !shown.length) && (
                <div className="quiet-empty" role="status">
                    {loading
                        ? "Loading receipts…"
                        : error
                          ? "Sent transfers unavailable"
                          : direction === "sent"
                            ? "No sent transfers"
                            : "No shared transfers"}
                </div>
            )}
        </div>
    );
}

/* Balance */

export function BalanceCard() {
    const { setPanel } = useWorkspace();
    const rail = useRail();
    return (
        <section className="terminal-card">
            <header>
                <h2>Balance</h2>
            </header>
            <div className="terminal-value mono">
                {rail.balance === null || !rail.token ? "—" : formatUnits(rail.balance, rail.token.decimals)}
            </div>
            <div className="balance-actions">
                <button className="button" disabled={rail.loading} onClick={() => void rail.refresh()}>
                    {rail.loading ? "Reading…" : rail.balance === null ? "Show balance" : "Refresh"}
                </button>
                <button className="button" onClick={() => setPanel("fund")}>
                    Add funds
                </button>
                <button className="button primary" onClick={() => setPanel("send")}>
                    Send
                </button>
                <button className="button" onClick={() => setPanel("withdraw")}>
                    Take out
                </button>
                <PublishShielded />
            </div>
            {(rail.ticket || rail.error) && (
                <div className="balance-extra">
                    <PendingTicket />
                    {rail.error && (
                        <p className="form-error" role="alert">
                            {rail.error}
                        </p>
                    )}
                </div>
            )}
        </section>
    );
}

/* Watching */

function WatchList() {
    const { account } = useWorkspace();
    const { rescan } = usePrivateData();
    const [names, setNames] = useState(() => (account ? watchedNames(account) : []));
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState("");

    function add(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        try {
            const name = ownerName(String(new FormData(event.currentTarget).get("name")));
            watchName(account, name);
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
        <div className="access-group">
            <div className="access-heading">
                <span>Watching</span>
                <button className="text-button" onClick={() => setAdding(!adding)}>
                    {adding ? "Cancel" : "Add"}
                </button>
            </div>

            {names.length === 0 ? (
                <p className="access-empty">Nobody yet</p>
            ) : (
                <ul className="access-list">
                    {names.map((name) => (
                        <li key={name}>
                            <span className="mono">{name}</span>
                            <button
                                className="icon-button"
                                aria-label={`Stop watching ${name}`}
                                onClick={() => drop(name)}
                            >
                                <Glyph name="close" size={15} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {adding && (
                <form onSubmit={add} className="access-form">
                    <input
                        name="name"
                        placeholder="alice.eth"
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        required
                    />
                    <button className="button primary">Watch</button>
                </form>
            )}

            <p className="field-help">
                Nothing is written on your name when someone shares a receipt with you, so their vault is where it is
                found. This list stays on this device.
            </p>

            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}

export function TransfersPage() {
    return (
        <FadeIn className="secrets-page">
            <div className="page-heading">
                <h1>Transfers</h1>
            </div>
            <BalanceCard />
            <div className="transfer-sections transfers-page-tables">
                <section>
                    <div className="section-heading">
                        <h2>Sent</h2>
                    </div>
                    <TransfersTable direction="sent" />
                </section>
                <section>
                    <div className="section-heading">
                        <h2>Shared with you</h2>
                    </div>
                    <TransfersTable direction="shared" />
                    <WatchList />
                </section>
            </div>
        </FadeIn>
    );
}
