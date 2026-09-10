"use client";

import { useWorkspace } from "./dashboard-shell";
import { FadeIn } from "./amicro";
import { Icon } from "./ui";

import { MOCKS_ENABLED, mockTransfers } from "../../../scripts/dashboard-mocks";

export function TransfersTable({ direction, compact = false }: { direction: "sent" | "shared"; compact?: boolean }) {
    const { vault, busy, error, setPanel } = useWorkspace();
    const receipts = (vault?.secrets || []).filter((secret) => secret.type === "receipt");
    const rows = MOCKS_ENABLED
        ? mockTransfers[direction]
        : direction === "sent"
          ? receipts.map((secret) => ({ secret, counterparty: secret.grantees.join(", ") || "Only you", amount: null }))
          : [];
    const shown = compact ? rows.slice(0, 4) : rows;
    const unavailable = !MOCKS_ENABLED && direction === "shared";
    return (
        <div className="secrets-browser transfer-browser" aria-busy={busy}>
            <div className="table-scroll">
                <table className="transfer-table">
                    <colgroup>
                        <col className="transfer-receipt-col" />
                        <col className="transfer-party-col" />
                        <col className="transfer-amount-col" />
                    </colgroup>
                    <thead>
                        <tr>
                            <th scope="col">Receipt</th>
                            <th scope="col">{direction === "sent" ? "Shared with" : "From"}</th>
                            <th scope="col">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!busy &&
                            !error &&
                            shown.map(({ secret, counterparty, amount }) => (
                                <tr key={secret.name}>
                                    <td>
                                        <button className="secret-name" onClick={() => setPanel(secret)}>
                                            <span className="secret-icon">
                                                <Icon name="wallet" />
                                            </span>
                                            <span>
                                                <strong>{secret.label}</strong>
                                                <small>
                                                    {secret.created
                                                        ? new Date(secret.created * 1000).toLocaleDateString("en-GB", {
                                                              day: "numeric",
                                                              month: "short",
                                                              timeZone: "UTC",
                                                          })
                                                        : "—"}
                                                </small>
                                            </span>
                                        </button>
                                    </td>
                                    <td className="transfer-recipient">{counterparty}</td>
                                    <td>
                                        {amount ? (
                                            <span className="mono">{amount}</span>
                                        ) : (
                                            <span className="transfer-locked">
                                                <Icon name="lock" size={15} />
                                                Encrypted
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            </div>
            {(unavailable || busy || error || !shown.length) && (
                <div className="quiet-empty" role="status">
                    {unavailable
                        ? "Shared transfers unavailable"
                        : busy
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

export function TransfersPage() {
    return (
        <FadeIn className="secrets-page">
            <div className="page-heading">
                <h1>Transfers</h1>
            </div>
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
                </section>
            </div>
        </FadeIn>
    );
}
