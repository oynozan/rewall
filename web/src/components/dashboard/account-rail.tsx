"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "./dashboard-shell";
import { useCapabilities } from "./identity";
import { vaultSetup, type VaultSetup } from "@/src/lib/account";
import { SegmentedProgress } from "./ui";
import { LiquidMetalButton } from "./liquid-metal-button";
import { SidebarFade, SidebarSection } from "./amicro";

// Keyed by the name it describes, so a reply for a vault you have left is ignored
function useVaultSetup(name: string, address: string) {
    const [resolved, setResolved] = useState<{ question: string; setup: VaultSetup } | null>(null);
    const question = `${name}|${address}`;

    useEffect(() => {
        let active = true;
        if (!name || !address) return;

        void vaultSetup(name, address)
            .then((setup) => {
                if (active) setResolved({ question, setup });
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [question, name, address]);

    return resolved?.question === question ? resolved.setup : null;
}

export function AccountRail() {
    const { vault, account, walletLabel, ownName, isOwnVault, setPanel } = useWorkspace();
    const { canRead, canDecrypt, canWrite } = useCapabilities(vault?.owner, account);
    const setup = useVaultSetup(isOwnVault ? ownName : "", account);
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
                    <LiquidMetalButton fullWidth label="Connect wallet" onClick={() => setPanel("wallet")} />
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
                {setup && !setup.ready && (
                    <>
                        <p className="rail-setup-note">This name cannot hold secrets yet.</p>
                        <ul className="rail-access rail-setup">
                            <li className={setup.resolver ? "granted" : ""}>Resolver</li>
                            <li className={setup.registry ? "granted" : ""}>Registry</li>
                            <li className={setup.namespace ? "granted" : ""}>Rewall namespace</li>
                            <li className={setup.identity ? "granted" : ""}>Identity key</li>
                        </ul>
                    </>
                )}
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
