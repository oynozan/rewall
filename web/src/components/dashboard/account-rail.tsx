"use client";

import { useWorkspace } from "./dashboard-shell";
import { usePrivateData } from "./private-data";
import { SegmentedProgress } from "./ui";

export function AccountRail() {
    const { vault, account, setPanel } = useWorkspace();
    const { accounts } = usePrivateData();
    const entries = vault?.secrets ?? [];
    const encrypted = entries.filter((secret) => secret.encryption === "aes-256-gcm").length;
    return <aside className="account-rail" aria-label="Account and vault">
        <section><h2>Account</h2>{account ? <><p className="rail-address mono">{account}</p><div className="rail-row"><span>Wallet</span><span>MetaMask</span></div></> : <button className="button small" onClick={() => setPanel("wallet")}>Connect wallet</button>}</section>
        <section><h2>Vault</h2><p className="rail-namespace mono">{vault?.namespace || "—"}</p><div className="rail-meter"><div className="rail-row"><span>Encrypted entries</span><span className="mono">{encrypted} / {entries.length}</span></div><SegmentedProgress value={encrypted} max={Math.max(1, entries.length)} label="Encrypted vault entries" segments={22} /></div><div className="rail-row"><span>Identity key</span><span>{vault?.identityPublished ? "Published" : "Not published"}</span></div></section>
        <section><h2>Access</h2><ul className="rail-access"><li className={vault ? "granted" : ""}>Read metadata</li><li className={Object.keys(accounts).length ? "granted" : ""}>Decrypt values</li><li>Write records</li></ul></section>
    </aside>;
}
