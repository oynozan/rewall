"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspace } from "./dashboard-shell";
import styles from "./connect-gate.module.css";

// A dashboard with no wallet has nothing of its own to show, so the app is put behind glass rather
// than filled with someone else's vault
export function ConnectGate({ children }: { children: React.ReactNode }) {
    const { account, ready, busy, ownName } = useWorkspace();
    const pathname = usePathname();

    // Locking before Privy has answered would flash the gate at someone who is already signed in
    if (!ready) return <>{children}</>;

    // The wizard is the way out of both states, so it is never gated itself
    const needsVault = Boolean(account) && !busy && !ownName;
    if (pathname.startsWith("/dashboard/setup") || (account && !needsVault)) return <>{children}</>;

    return (
        <div className={`${styles.wrap} ${styles.locked}`}>
            <div inert>{children}</div>
            <div className={styles.scrim} aria-hidden="true" />
            {needsVault ? <SetupCard /> : <ConnectCard />}
        </div>
    );
}

function ConnectCard() {
    const { connect } = useWorkspace();
    return (
        <div className={styles.card} role="dialog" aria-label="Connect to Rewall">
            <h2>Connect to see your secrets</h2>
            <p>Rewall shows what your own wallet holds. Nothing here belongs to anyone else.</p>
            <button className="button primary" onClick={connect} autoFocus>
                Connect a wallet
            </button>
            <p className={styles.note}>New here? Connecting sets you up, and the gas is on us.</p>
        </div>
    );
}

function SetupCard() {
    const { setPanel } = useWorkspace();
    return (
        <div className={styles.card} role="dialog" aria-label="Set up your vault">
            <h2>You need a vault</h2>
            <p>
                Secrets live under an ENS name you own. Setting one up takes a single signature, and the project pays
                for the rest.
            </p>
            <Link href="/dashboard/setup" className="button primary" autoFocus>
                Set up my vault
            </Link>
            {/* ENS reverse resolution is empty on Sepolia, so an owner on a new browser has to say which name is theirs */}
            <button className="text-button" onClick={() => setPanel("vault")}>
                I already own a name
            </button>
        </div>
    );
}
