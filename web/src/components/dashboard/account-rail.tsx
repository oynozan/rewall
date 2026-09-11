"use client";

import { useWorkspace } from "./dashboard-shell";
import { useCapabilities } from "./identity";
import { Glyph, SegmentedProgress } from "./ui";
import { SidebarFade, SidebarSection } from "./amicro";

export function AccountRail() {
    const { vault, account, walletLabel, setPanel } = useWorkspace();
    const { canRead, canDecrypt, canWrite } = useCapabilities(vault?.owner, account);
    const entries = vault?.secrets ?? [];
    const encrypted = entries.filter((secret) => secret.encryption === "aes-256-gcm").length;
    return (
        <SidebarFade className="account-rail" label="Account and vault">
            <SidebarSection delay={0.0}>
                <h2>Account</h2>
                {account ? (
                    <>
                        <p className="rail-address mono">{account}</p>
                        <div className="rail-row">
                            <span>Wallet</span>
                            <span>{walletLabel || "Connected"}</span>
                        </div>
                    </>
                ) : (
                    <button className="button small wallet-connect" onClick={() => setPanel("wallet")}>
                        Connect wallet
                        <Glyph name="chevron_right" size={18} />
                    </button>
                )}
            </SidebarSection>
            <SidebarSection delay={0.08}>
                <h2>Vault</h2>
                <p className="rail-namespace mono">{vault?.namespace || "—"}</p>
                <div className="rail-meter">
                    <div className="rail-row">
                        <span>Encrypted entries</span>
                        <span className="mono">
                            {encrypted} / {entries.length}
                        </span>
                    </div>
                    <SegmentedProgress
                        value={encrypted}
                        max={Math.max(1, entries.length)}
                        label="Encrypted vault entries"
                        segments={22}
                    />
                </div>
                <div className="rail-row">
                    <span>Identity key</span>
                    <span>{vault?.identityPublished ? "Published" : "Not published"}</span>
                </div>
            </SidebarSection>
            <SidebarSection delay={0.16}>
                <h2>Access</h2>
                <ul className="rail-access">
                    <li className={canRead ? "granted" : ""}>Read metadata</li>
                    <li className={canDecrypt ? "granted" : ""}>Decrypt values</li>
                    <li className={canWrite ? "granted" : ""}>Write records</li>
                </ul>
            </SidebarSection>
        </SidebarFade>
    );
}
