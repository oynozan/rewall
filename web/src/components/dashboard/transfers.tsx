"use client";

import { useWorkspace } from "./dashboard-shell";
import { FadeIn } from "./amicro";
import { Icon } from "./ui";

import { VolumeChart } from "./volume-chart";

export function TransfersTable({ direction, compact = false }: { direction: "sent" | "shared"; compact?: boolean }) {
    const { vault, busy, error, setPanel } = useWorkspace();
    const receipts = (vault?.secrets || []).filter((secret) => secret.type === "receipt");
    const sent = compact ? receipts.slice(0, 4) : receipts;
    return (
        <div className="secrets-browser transfer-browser" aria-busy={busy}>
            <div className="table-scroll">
                <table className="transfer-table">
                    <thead>
                        <tr>
                            <th scope="col">Receipt</th>
                            <th scope="col">{direction === "sent" ? "Shared with" : "From"}</th>
                            <th scope="col">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {direction === "sent" &&
                            !busy &&
                            !error &&
                            sent.map((secret) => (
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
                                    <td className="transfer-recipient">{secret.grantees.join(", ") || "Only you"}</td>
                                    <td>
                                        <span className="transfer-locked">
                                            <Icon name="lock" size={15} />
                                            Encrypted
                                        </span>
                                    </td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            </div>
            {(direction === "shared" || busy || error || !sent.length) && (
                <div className="quiet-empty" role="status">
                    {direction === "shared"
                        ? "Shared transfers unavailable"
                        : busy
                          ? "Loading receipts…"
                          : error
                            ? "Sent transfers unavailable"
                            : "No sent transfers"}
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
                <span className="muted">Confidential</span>
            </div>
            <div className="transfers-page-chart">
                <VolumeChart />
            </div>
            <div className="transfer-sections">
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
