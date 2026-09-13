"use client";

import { useState } from "react";
import { volumeOf } from "@/src/lib/volume";
import { useWorkspace } from "./dashboard-shell";
import { usePrivateData } from "./private-data";
import { useRail } from "./rail";
import { SegmentedProgress, Skeleton } from "./ui";
import { VolumeChart } from "./volume-chart";

export function TerminalOverview() {
    const { vault, busy, error } = useWorkspace();
    const { accounts, shared, receipts, openReceipt, pending } = usePrivateData();
    const { token } = useRail();
    const [opening, setOpening] = useState(false);
    const ready = Boolean(vault) && !busy && !error;
    // A value the chain has not answered for yet is a bar, one it cannot answer for is a dash
    const show = (value: string, width: number, height: number) =>
        ready ? value : busy ? <Skeleton width={width} height={height} /> : "—";
    const secrets = (vault?.secrets || []).filter((secret) => !["totp", "receipt"].includes(secret.type));
    const encrypted = secrets.filter((secret) => secret.encryption === "aes-256-gcm").length;
    const totp = (vault?.secrets || []).filter((secret) => secret.type === "totp");
    const unlocked = totp.filter((secret) => accounts[secret.name]).length;
    const sentReceipts = (vault?.secrets || []).filter((secret) => secret.type === "receipt");
    const sharedReceipts = shared.map((entry) => entry.secret);
    const volume = volumeOf(sentReceipts, sharedReceipts, receipts, token);
    const closed = [...sentReceipts, ...sharedReceipts].filter((secret) => !receipts[secret.name]);

    // One pass over the closed ones, and the first decrypt is the only wallet prompt the rest reuse
    async function showVolume() {
        setOpening(true);
        for (const secret of closed) await openReceipt(secret.name);
        setOpening(false);
    }
    return (
        <div className="terminal-overview" aria-label="Workspace overview" aria-busy={busy}>
            <section className="terminal-card secrets-card">
                <header>
                    <h2>Secrets</h2>
                </header>
                <div className="terminal-value mono">{show(secrets.length.toString().padStart(2, "0"), 52, 30)}</div>
                <div className="terminal-meter">
                    <div className="terminal-meta mono">
                        <span>Encrypted</span>
                        <span>{show(`${encrypted} / ${secrets.length}`, 40, 10)}</span>
                    </div>
                    {!busy && (
                        <SegmentedProgress
                            label="Encrypted secrets"
                            value={ready ? encrypted : 0}
                            max={Math.max(1, secrets.length)}
                        />
                    )}
                </div>
            </section>
            <section className="terminal-card otp-card">
                <header>
                    <h2>2FA</h2>
                </header>
                <div className="terminal-value mono">{show(totp.length.toString().padStart(2, "0"), 52, 30)}</div>
                <div className="terminal-meter">
                    <div className="terminal-meta mono">
                        <span>Unlocked</span>
                        <span>{show(`${unlocked} / ${totp.length}`, 40, 10)}</span>
                    </div>
                    {!busy && (
                        <SegmentedProgress
                            label="Unlocked 2FA accounts"
                            value={ready ? unlocked : 0}
                            max={Math.max(1, totp.length)}
                        />
                    )}
                </div>
            </section>
            <section className="terminal-card transfers-card">
                <header>
                    <h2>Confidential Transfers</h2>
                </header>
                <div className="terminal-transfer-counts">
                    <div>
                        <span className="mono">Sent</span>
                        <strong className="mono">
                            {show(sentReceipts.length.toString().padStart(2, "0"), 44, 26)}
                        </strong>
                    </div>
                    <div>
                        <span className="mono">Shared</span>
                        <strong className="mono">{show(shared.length.toString().padStart(2, "0"), 44, 26)}</strong>
                    </div>
                </div>
            </section>
            <VolumeChart
                volume={volume}
                onShow={ready && closed.length > 0 ? showVolume : undefined}
                busy={opening || Boolean(pending)}
            />
        </div>
    );
}
