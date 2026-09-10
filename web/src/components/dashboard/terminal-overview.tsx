"use client";

import { useWorkspace } from "./dashboard-shell";
import { usePrivateData } from "./private-data";
import { SegmentedProgress } from "./ui";
import { VolumeChart } from "./volume-chart";
import { MOCKS_ENABLED, mockTransfers, mockVolume } from "../../../scripts/dashboard-mocks";

export function TerminalOverview() {
    const { vault, busy, error } = useWorkspace();
    const { accounts } = usePrivateData();
    const ready = Boolean(vault) && !busy && !error;
    const secrets = (vault?.secrets || []).filter((secret) => !["totp", "receipt"].includes(secret.type));
    const encrypted = secrets.filter((secret) => secret.encryption === "aes-256-gcm").length;
    const totp = (vault?.secrets || []).filter((secret) => secret.type === "totp");
    const unlocked = totp.filter((secret) => accounts[secret.name]).length;
    const sent = (vault?.secrets || []).filter((secret) => secret.type === "receipt").length;
    return (
        <div className="terminal-overview" aria-label="Workspace overview">
            <section className="terminal-card">
                <header>
                    <h2>Secrets</h2>
                </header>
                <div className="terminal-value mono">{ready ? secrets.length.toString().padStart(2, "0") : "—"}</div>
                <div className="terminal-meter">
                    <div className="terminal-meta mono">
                        <span>Encrypted</span>
                        <span>{ready ? `${encrypted} / ${secrets.length}` : "—"}</span>
                    </div>
                    <SegmentedProgress
                        label="Encrypted secrets"
                        value={ready ? encrypted : 0}
                        max={Math.max(1, secrets.length)}
                    />
                </div>
            </section>
            <section className="terminal-card">
                <header>
                    <h2>2FA</h2>
                </header>
                <div className="terminal-value mono">{ready ? totp.length.toString().padStart(2, "0") : "—"}</div>
                <div className="terminal-meter">
                    <div className="terminal-meta mono">
                        <span>Unlocked</span>
                        <span>{ready ? `${unlocked} / ${totp.length}` : "—"}</span>
                    </div>
                    <SegmentedProgress
                        label="Unlocked 2FA accounts"
                        value={ready ? unlocked : 0}
                        max={Math.max(1, totp.length)}
                    />
                </div>
            </section>
            <section className="terminal-card">
                <header>
                    <h2>Confidential Transfers</h2>
                </header>
                <div className="terminal-transfer-counts">
                    <div>
                        <span className="mono">Sent</span>
                        <strong className="mono">{ready ? sent.toString().padStart(2, "0") : "—"}</strong>
                    </div>
                    <div>
                        <span className="mono">Shared</span>
                        <strong className="mono">{MOCKS_ENABLED ? mockTransfers.shared.length.toString().padStart(2, "0") : "—"}</strong>
                    </div>
                </div>
            </section>
            <VolumeChart volume={MOCKS_ENABLED ? mockVolume : null} />
        </div>
    );
}
