"use client";

export type VolumePoint = { label: string; sent: number; shared: number };
export type TransferVolume = { asset: string; sentTotal: string; sharedTotal: string; points: VolumePoint[] };

export function VolumeChart({ volume = null }: { volume?: TransferVolume | null }) {
    const points = volume?.points || [];
    const maximum = Math.max(1, ...points.flatMap((point) => [point.sent, point.shared]));
    const line = (direction: "sent" | "shared") =>
        points
            .map(
                (point, index) =>
                    `${12 + (index / Math.max(1, points.length - 1)) * 376},${77 - (point[direction] / maximum) * 62}`,
            )
            .join(" ");
    return (
        <section className="terminal-card volume-card" aria-label="Confidential transfer volume">
            <header>
                <h2>Transfer volume</h2>
                <span className="mono">30D{volume ? ` · ${volume.asset}` : ""}</span>
            </header>
            <div className="volume-legend mono">
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
                <svg
                    viewBox="0 0 400 88"
                    role="img"
                    aria-label={
                        volume ? `Daily sent and shared volume in ${volume.asset}` : "Transfer volume unavailable"
                    }
                    preserveAspectRatio="none"
                >
                    {[15, 46, 77].map((y) => (
                        <line key={`y${y}`} x1="12" x2="388" y1={y} y2={y} className="chart-grid" />
                    ))}
                    {[12, 87, 162, 237, 312, 388].map((x) => (
                        <line key={`x${x}`} x1={x} x2={x} y1="15" y2="77" className="chart-grid" />
                    ))}
                    {points.length > 1 && (
                        <>
                            <polyline points={line("sent")} className="chart-sent" />
                            <polyline points={line("shared")} className="chart-shared" />
                        </>
                    )}
                    {points.length === 1 && (
                        <>
                            <circle cx="12" cy={77 - (points[0].sent / maximum) * 62} r="2" fill="var(--foreground)" />
                            <circle cx="12" cy={77 - (points[0].shared / maximum) * 62} r="2" fill="var(--muted)" />
                        </>
                    )}
                </svg>
                {!volume && <span className="chart-empty">Volume unavailable</span>}
            </div>
            <div className="chart-axis mono">
                <span>{points[0]?.label || "30 days ago"}</span>
                <span>{points.at(-1)?.label || "Today"}</span>
            </div>
        </section>
    );
}
