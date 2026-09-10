"use client";

import { useWorkspace } from "./dashboard-shell";
import { FadeIn } from "./amicro";
import { Icon } from "./ui";

export type VolumePoint = { label: string; sent: number; shared: number };
export type TransferVolume = { asset: string; sentTotal: string; sharedTotal: string; points: VolumePoint[] };

export function VolumeChart({ volume = null }: { volume?: TransferVolume | null }) {
    const points = volume?.points || [];
    const maximum = Math.max(1, ...points.flatMap((point) => [point.sent, point.shared]));
    const line = (direction: "sent" | "shared") => points.map((point, index) => `${12 + (index / Math.max(1, points.length - 1)) * 376},${77 - (point[direction] / maximum) * 62}`).join(" ");
    return (
        <section className="terminal-card volume-card" aria-label="Confidential transfer volume">
            <header><h2>Transfer volume</h2><span className="mono">30D{volume ? ` · ${volume.asset}` : ""}</span></header>
            <div className="volume-legend mono"><span><i />Sent <b>{volume?.sentTotal ?? "—"}</b></span><span><i className="shared-line" />Shared <b>{volume?.sharedTotal ?? "—"}</b></span></div>
            <div className="volume-plot">
                <svg viewBox="0 0 400 88" role="img" aria-label={volume ? `Daily sent and shared volume in ${volume.asset}` : "Transfer volume unavailable"} preserveAspectRatio="none">
                    {[15, 46, 77].map((y) => <line key={`y${y}`} x1="12" x2="388" y1={y} y2={y} className="chart-grid" />)}
                    {[12, 87, 162, 237, 312, 388].map((x) => <line key={`x${x}`} x1={x} x2={x} y1="15" y2="77" className="chart-grid" />)}
                    {points.length > 1 && <><polyline points={line("sent")} className="chart-sent" /><polyline points={line("shared")} className="chart-shared" /></>}
                    {points.length === 1 && <><circle cx="12" cy={77 - points[0].sent / maximum * 62} r="2" fill="var(--foreground)" /><circle cx="12" cy={77 - points[0].shared / maximum * 62} r="2" fill="var(--muted)" /></>}
                </svg>
                {!volume && <span className="chart-empty">Volume unavailable</span>}
            </div>
            <div className="chart-axis mono"><span>{points[0]?.label || "30 days ago"}</span><span>{points.at(-1)?.label || "Today"}</span></div>
        </section>
    );
}

export function TransfersTable({ direction, compact = false }: { direction: "sent" | "shared"; compact?: boolean }) {
    const { vault, busy, error, setPanel } = useWorkspace();
    const receipts = (vault?.secrets || []).filter((secret) => secret.type === "receipt");
    const sent = compact ? receipts.slice(0, 4) : receipts;
    return <div className="secrets-browser transfer-browser" aria-busy={busy}>
        <div className="table-scroll"><table className="transfer-table"><thead><tr><th scope="col">Receipt</th><th scope="col">{direction === "sent" ? "Shared with" : "From"}</th><th scope="col">Amount</th></tr></thead><tbody>
            {direction === "sent" && !busy && !error && sent.map((secret) => <tr key={secret.name}><td><button className="secret-name" onClick={() => setPanel(secret)}><span className="secret-icon"><Icon name="wallet" /></span><span><strong>{secret.label}</strong><small>{secret.created ? new Date(secret.created * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "—"}</small></span></button></td><td className="transfer-recipient">{secret.grantees.join(", ") || "Only you"}</td><td><span className="transfer-locked"><Icon name="lock" size={15} />Encrypted</span></td></tr>)}
            {(direction === "shared" || busy || error || !sent.length) && <tr><td colSpan={3} className="quiet-empty">{direction === "shared" ? "Shared transfers unavailable" : busy ? "Loading receipts…" : error ? "Sent transfers unavailable" : "No sent transfers"}</td></tr>}
        </tbody></table></div>
    </div>;
}

export function TransfersPage() {
    return <FadeIn className="secrets-page"><div className="page-heading"><h1>Transfers</h1><span className="muted">Confidential</span></div><div className="transfers-page-chart"><VolumeChart /></div><div className="transfer-sections"><section><div className="section-heading"><h2>Sent</h2></div><TransfersTable direction="sent" /></section><section><div className="section-heading"><h2>Shared with you</h2></div><TransfersTable direction="shared" /></section></div></FadeIn>;
}
