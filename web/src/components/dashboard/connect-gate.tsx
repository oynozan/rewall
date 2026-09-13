"use client";

import { usePathname, useRouter } from "next/navigation";
import { DotGrid } from "./dot-grid";
import { LiquidMetalButton } from "./liquid-metal-button";
import { useWorkspace } from "./dashboard-shell";
import styles from "./connect-gate.module.css";

// Says which of the two things a visitor is missing, a wallet or a vault, and null once they have both
export function useGate(): "connect" | "vault" | null {
    const { account, ready, busy, ownName } = useWorkspace();
    const pathname = usePathname();

    // Locking before Privy has answered would flash the gate at someone who is already signed in
    if (!ready) return null;
    if (!account) return "connect";

    // Setting up and recovering are the two things you do precisely because you have no vault yet
    const vaultless = pathname.startsWith("/dashboard/setup");
    return !busy && !ownName && !vaultless ? "vault" : null;
}

export function ConnectGate({ children }: { children: React.ReactNode }) {
    const gate = useGate();
    const pathname = usePathname();
    if (!gate) return <>{children}</>;

    // Home seats the banner under its welcome banner and marks its own blocks inert, so the gate only frosts
    if (pathname === "/dashboard") return <div className={styles.frosted}>{children}</div>;

    return (
        <div className={styles.frosted}>
            <div className={styles.top}>
                <GateBanner />
            </div>
            <div inert>{children}</div>
        </div>
    );
}

/* Banner */

// Rendered wherever the route wants it rather than over the page, so the dashboard keeps its shape
export function GateBanner() {
    const router = useRouter();
    const gate = useGate();
    const { connect, setPanel } = useWorkspace();
    if (!gate) return null;

    const vault = gate === "vault";
    return (
        <aside className={styles.banner} aria-label={vault ? "Set up your vault" : "Connect to Rewall"}>
            <DotGrid />
            <div className={styles.copy}>
                <span className={styles.eyebrow}>{vault ? "Step two" : "Step one"}</span>
                <h2>{vault ? "You need a vault" : "Connect to see your secrets"}</h2>
                <p>
                    {vault
                        ? "Secrets live under an ENS name you own. Setting one up takes a single signature, and the project pays for the rest."
                        : "Rewall shows what your own wallet holds and nothing that belongs to anyone else. Connecting sets you up, and the gas is on us."}
                </p>
            </div>
            <div className={styles.actions}>
                {vault ? (
                    <>
                        {/* ENS reverse resolution is empty on Sepolia, so an owner on a new browser has to say which name is theirs */}
                        <LiquidMetalButton
                            className={styles.metalAction}
                            fullWidth
                            label="I already own a name"
                            onClick={() => setPanel("vault")}
                        />
                        <LiquidMetalButton
                            className={styles.metalAction}
                            fullWidth
                            label="Set up my vault"
                            onClick={() => router.push("/dashboard/setup")}
                        />
                    </>
                ) : (
                    <LiquidMetalButton
                        className={styles.metalAction}
                        fullWidth
                        label="Connect a wallet"
                        onClick={connect}
                    />
                )}
            </div>
        </aside>
    );
}
