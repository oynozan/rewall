"use client";

import type { TransferVolume } from "@/src/lib/volume";

export function VolumeChart({
    volume = null,
    onShow,
    busy = false,
}: {
    volume?: TransferVolume | null;
    onShow?: () => void;
    busy?: boolean;
}) {
    const points = volume?.points || [];
    const highest = Math.max(1, ...points.flatMap((point) => [point.sent, point.shared]));
    const magnitude = 10 ** Math.floor(Math.log10(highest / 3));
    const step = Math.ceil(highest / 3 / magnitude) * magnitude;
    const maximum = step * 3;
    const y = (value: number) => 152 - (value / maximum) * 140;
    const line = (direction: "sent" | "shared") =>
        points
            .map((point, index) => `${12 + (index / Math.max(1, points.length - 1)) * 376},${y(point[direction])}`)
            .join(" ");
    const formatTick = (value: number) =>
        new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
    return (
        <section className="terminal-card volume-card" aria-label="Confidential transfer volume">
            <header>
                <h2>Transfer volume</h2>
                <span className="mono">30D{volume ? ` · ${volume.asset}` : ""}</span>
            </header>
            <div className="volume-legend">
                <span>
                    <i />
                    Sent <b>{volume?.sentTotal ?? "—"}</b>
                </span>
                <span>
                    <i className="shared-line" />
                    Shared <b>{volume?.sharedTotal ?? "—"}</b>
                </span>
            </div>
            <div className="volume-plot">
                <div className="chart-y-axis mono" aria-hidden="true">
                    {[3, 2, 1, 0].map((tick) => (
                        <span key={tick}>{volume ? formatTick(step * tick) : "—"}</span>
                    ))}
                </div>
                <svg
                    viewBox="0 0 400 164"
                    role="img"
                    aria-label={
                        volume
                            ? `Daily sent and shared volume in ${volume.asset}, from 0 to ${formatTick(maximum)}`
                            : "Transfer volume unavailable"
                    }
                    preserveAspectRatio="none"
                >
                    {[0, 1, 2, 3].map((tick) => (
                        <line
                            key={`y${tick}`}
                            x1="12"
                            x2="388"
                            y1={y(step * tick)}
                            y2={y(step * tick)}
                            className="chart-grid"
                        />
                    ))}
                    {[12, 87, 162, 237, 312, 388].map((x) => (
                        <line key={`x${x}`} x1={x} x2={x} y1="12" y2="152" className="chart-grid" />
                    ))}
                    {points.length > 1 && (
                        <>
                            <polyline points={line("sent")} className="chart-sent" />
                            <polyline points={line("shared")} className="chart-shared" />
                        </>
                    )}
                    {points.length === 1 && (
                        <>
                            <circle cx="12" cy={y(points[0].sent)} r="2" fill="var(--foreground)" />
                            <circle cx="12" cy={y(points[0].shared)} r="2" fill="var(--muted)" />
                        </>
                    )}
                </svg>
                {/* An amount lives inside the receipt, so the plot is drawn from the ones that are open */}
                {!volume &&
                    (onShow ? (
                        <button type="button" className="chart-empty chart-show" onClick={onShow} disabled={busy}>
                            {busy ? "Opening receipts…" : "Open receipts to plot volume"}
                        </button>
                    ) : (
                        <span className="chart-empty">No transfers yet</span>
                    ))}
            </div>
            <div className="chart-axis mono">
                <span>{points[0]?.label || "30 days ago"}</span>
                <span>{points.at(-1)?.label || "Today"}</span>
            </div>
        </section>
    );
}
