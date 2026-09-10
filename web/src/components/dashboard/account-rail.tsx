"use client";

import { useWorkspace } from "./dashboard-shell";
import { Icon, SegmentedProgress } from "./ui";

/* readVault refuses an index longer than this, so it is the vault size the viewer can open */
const VAULT_LIMIT = 128;

export function AccountRail() {
    const { vault, account, setPanel } = useWorkspace();
    const secrets = vault?.secrets ?? [];
    const encrypted = secrets.filter((secret) => secret.encryption === "aes-256-gcm").length;
    return (
        <aside className="account-rail" aria-label="Account and vault">
            <section>
                <span className="nav-caption">Account</span>
                <button className="rail-account" onClick={() => setPanel("wallet")}>
                    <span className="account-avatar">
                        <Icon name="wallet" size={18} />
                    </span>
                    <span>
                        <strong className={account ? "mono" : ""}>
                            {account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Not connected"}
                        </strong>
                        <small>{account ? "MetaMask" : "Connect"}</small>
                    </span>
                </button>
            </section>
            <section>
                <span className="nav-caption">Vault</span>
                <p className="rail-namespace mono">{vault?.namespace || "—"}</p>
                <Meter label="Secrets" value={secrets.length} max={VAULT_LIMIT} />
                <Meter label="Encrypted" value={encrypted} max={secrets.length} />
                <div className="rail-row">
                    <span>Identity key</span>
                    <span>{vault?.identityPublished ? "Published" : "Not published"}</span>
                </div>
            </section>
            <section>
                <span className="nav-caption">Access</span>
                <ul className="rail-access">
                    <li className="granted">Read metadata</li>
                    <li>Decrypt values</li>
                    <li>Write records</li>
                </ul>
            </section>
        </aside>
    );
}

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
    return (
        <div className="rail-meter">
            <div className="rail-row">
                <span>{label}</span>
                <span className="mono">
                    {value} / {max}
                </span>
            </div>
            <SegmentedProgress value={value} max={max} label={label} segments={22} />
        </div>
    );
}
