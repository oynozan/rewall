"use client";

import Image from "next/image";
import { Toaster } from "sonner";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { type EIP1193Provider } from "viem";
import { PrivateDataProvider } from "./private-data";
import { IdentityProvider, useIdentity } from "./identity";
import { MOCKS_ENABLED } from "../../../scripts/dashboard-mocks";
import {
    ownerName,
    readSecret,
    readVault,
    TEST_OWNER,
    TYPE_LABELS,
    type Secret,
    type SecretType,
    type Vault,
} from "@/src/lib/vault";
import { FadeDots, FadeIn, SidebarFade } from "./amicro";
import { CopyButton, Glyph, Icon, type IconName } from "./ui";

type Panel = "vault" | "wallet" | "help" | "find" | Secret | null;
type Workspace = {
    vault: Vault | null;
    busy: boolean;
    error: string;
    account: string;
    walletLabel: string;
    ready: boolean;
    panel: Panel;
    setPanel: (panel: Panel) => void;
    loadVault: (name: string) => Promise<boolean>;
    refresh: () => void;
    connect: () => void;
    disconnect: () => void;
};
const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace() {
    const workspace = useContext(WorkspaceContext);
    if (!workspace) throw new Error("Workspace must be inside the dashboard");
    return workspace;
}

/* Each sidebar row fades in one step later than the row above it */
const step = (index: number) => ({ "--i": index }) as React.CSSProperties;

export function DashboardShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const pageTitle = pathname.includes("/2fa")
        ? "2FA"
        : pathname.includes("/transfers")
          ? "Transfers"
          : pathname.includes("/secrets")
            ? "Secrets"
            : "Home";
    const [vault, setVault] = useState<Vault | null>(null);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [panel, setPanel] = useState<Panel>(null);
    const [mobileOpen, setMobileOpen] = useState(false);
    const request = useRef(0);

    const { ready, authenticated, login, logout } = usePrivy();
    const { wallets } = useWallets();
    const wallet = wallets[0];
    const account = authenticated ? (wallet?.address ?? "") : "";
    const walletLabel =
        wallet?.walletClientType === "privy" ? "Privy wallet" : (wallet?.meta?.name ?? wallet?.walletClientType ?? "");
    const loadVault = useCallback(async (input: string) => {
        const current = ++request.current;
        setBusy(true);
        setError("");
        try {
            const name = ownerName(input);
            const result = await readVault(name);
            if (current !== request.current) return false;
            setVault(result);
            return true;
        } catch {
            if (current === request.current)
                setError("We couldn’t read this vault. Check the ENS name and your connection, then try again.");
            return false;
        } finally {
            if (current === request.current) setBusy(false);
        }
    }, []);

    useEffect(() => {
        let active = true;
        void readVault(TEST_OWNER)
            .then((result) => {
                if (active && request.current === 0) {
                    setVault(result);
                    setBusy(false);
                }
            })
            .catch(() => {
                if (active && request.current === 0) {
                    setError("We couldn’t reach the test vault. Check your connection and try again.");
                    setBusy(false);
                }
            });
        return () => {
            active = false;
        };
    }, []);

    // Privy hands the provider over asynchronously, so the identity session asks for it when it needs it
    const getProvider = useCallback(
        async () => (wallet ? ((await wallet.getEthereumProvider()) as EIP1193Provider) : null),
        [wallet],
    );

    const workspace: Workspace = {
        vault,
        busy,
        error,
        account,
        walletLabel,
        ready,
        panel,
        setPanel,
        loadVault,
        refresh: () => void loadVault(vault?.owner || TEST_OWNER),
        // The drawer is a modal dialog, so it sits in the top layer and would swallow clicks on Privy's own modal
        connect: () => {
            setPanel(null);
            void login();
        },
        disconnect: () => void logout(),
    };
    const navigate = () => setMobileOpen(false);

    return (
        <WorkspaceContext value={workspace}>
            <IdentityProvider address={account} getProvider={getProvider} name={vault?.owner || ""}>
                <div className="dashboard-app">
                    <a className="skip-link" href="#workspace-content">
                        Skip to content
                    </a>
                    {mobileOpen && <button className="mobile-scrim" onClick={navigate} aria-label="Close navigation" />}
                    <SidebarFade className={`sidebar ${mobileOpen ? "is-open" : ""}`} label="Main navigation">
                        <div className="brand-row" style={step(0)}>
                            <Link href="/dashboard" className="brand" aria-label="Rewall home" onClick={navigate}>
                                <Image
                                    src="/logo.svg"
                                    alt="Rewall"
                                    width={160}
                                    height={78}
                                    className="logo-static"
                                    priority
                                    unoptimized
                                />
                                <Image
                                    src="/logo-animated.svg"
                                    alt=""
                                    width={160}
                                    height={78}
                                    className="logo-alternate"
                                    unoptimized
                                    aria-hidden="true"
                                />
                            </Link>
                        </div>
                        <button className="workspace-switcher" style={step(1)} onClick={() => setPanel("vault")}>
                            <span className="workspace-avatar">
                                <Icon name="lock" size={20} />
                            </span>
                            <span>
                                <strong className={vault ? "mono" : ""}>{vault?.owner || "No vault open"}</strong>
                                {MOCKS_ENABLED && <small>Mock preview</small>}
                            </span>
                        </button>
                        <nav>
                            <div className="nav-group">
                                {(
                                    [
                                        { href: "/dashboard", label: "Home", icon: "home" },
                                        { href: "/dashboard/secrets", label: "Secrets", icon: "key" },
                                        { href: "/dashboard/2fa", label: "2FA", icon: "authenticator" },
                                        { href: "/dashboard/transfers", label: "Transfers", icon: "wallet" },
                                    ] as { href: string; label: string; icon: IconName }[]
                                ).map((item, index) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        style={step(index + 2)}
                                        className={`nav-item ${pageTitle === item.label ? "selected" : ""}`}
                                        aria-current={pageTitle === item.label ? "page" : undefined}
                                        onClick={navigate}
                                    >
                                        <Icon name={item.icon} />
                                        {item.label}
                                    </Link>
                                ))}
                            </div>
                            <div className="nav-group">
                                <span className="nav-caption" style={step(6)}>
                                    Resources
                                </span>
                                <a
                                    className="nav-item"
                                    style={step(7)}
                                    href="https://github.com/oynozan/rewall"
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    <Icon name="github" />
                                    Source Code
                                </a>
                                <a
                                    className="nav-item"
                                    style={step(8)}
                                    href="#"
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(event) => event.preventDefault()}
                                    aria-disabled="true"
                                >
                                    <Icon name="documents" />
                                    Docs
                                </a>
                            </div>
                        </nav>
                        <button className="sidebar-account" style={step(12)} onClick={() => setPanel("wallet")}>
                            <span className="account-avatar">
                                <Icon name="wallet" size={18} />
                            </span>
                            <span>
                                <strong className={account ? "mono" : ""}>
                                    {account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Not connected"}
                                </strong>
                                <small>{account ? walletLabel || "Connected" : "Connect wallet"}</small>
                            </span>
                            {!account && (
                                <span className="wallet-chevron">
                                    <Glyph name="chevron_right" size={18} />
                                </span>
                            )}
                        </button>
                    </SidebarFade>
                    <div className="workspace-main">
                        <header className="topbar">
                            <button
                                className="mobile-menu icon-button"
                                onClick={() => setMobileOpen(!mobileOpen)}
                                aria-expanded={mobileOpen}
                                aria-label="Open navigation"
                            >
                                <Icon name="hamburger_menu" size={17} />
                            </button>
                            <span>{pageTitle}</span>
                        </header>
                        <main id="workspace-content" tabIndex={-1}>
                            <PrivateDataProvider key={`${account}:${vault?.owner || ""}`}>
                                {children}
                            </PrivateDataProvider>
                        </main>
                    </div>
                    <WorkspacePanel />
                    <Toaster
                        theme="dark"
                        position="bottom-right"
                        duration={2200}
                        visibleToasts={1}
                        swipeDirections={[]}
                        toastOptions={{ className: "dashboard-toast" }}
                    />
                </div>
            </IdentityProvider>
        </WorkspaceContext>
    );
}

function WorkspacePanel() {
    const { panel, setPanel, vault, loadVault, busy, error, account, ready, connect, disconnect } = useWorkspace();
    const identity = useIdentity();
    const dialog = useRef<HTMLDialogElement>(null);
    const drawerMotion = useRef<Animation | null>(null);
    const [localError, setLocalError] = useState("");
    const [working, setWorking] = useState(false);
    useEffect(() => {
        const node = dialog.current;
        if (!node) return;
        if (!panel) {
            node.close();
            return;
        }
        if (node.open) return;
        delete node.dataset.closing;
        node.showModal();
        if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
            drawerMotion.current = node.animate([{ clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 0%)" }], {
                duration: 320,
                easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            });
        }
    }, [panel]);
    useEffect(() => () => drawerMotion.current?.cancel(), []);
    const close = () => {
        const node = dialog.current;
        if (!node?.open || node.dataset.closing) return;
        const finish = () => {
            node.close();
            delete node.dataset.closing;
            setPanel(null);
            setLocalError("");
        };
        const clipPath = getComputedStyle(node).clipPath;
        drawerMotion.current?.cancel();
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
            finish();
            return;
        }
        node.dataset.closing = "true";
        drawerMotion.current = node.animate(
            [{ clipPath: clipPath === "none" ? "inset(0 0 0 0%)" : clipPath }, { clipPath: "inset(0 0 0 100%)" }],
            { duration: 220, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
        );
        drawerMotion.current.onfinish = () => {
            finish();
            drawerMotion.current?.cancel();
        };
    };
    const secret = typeof panel === "object" ? panel : null;
    const title = secret
        ? secret.label
        : panel === "vault"
          ? "Open a vault"
          : panel === "wallet"
            ? "Your wallet"
            : panel === "find"
              ? "Find a secret"
              : "How Rewall works";

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setLocalError("");
        const input = String(new FormData(event.currentTarget).get("name"));
        try {
            ownerName(input);
        } catch {
            setLocalError("Enter a complete ENS name ending in .eth.");
            return;
        }
        if (panel === "vault") {
            if (await loadVault(input)) close();
        } else {
            setWorking(true);
            try {
                setPanel(await readSecret(input));
            } catch {
                setLocalError("We couldn’t find a Rewall secret at that name. Check the name and try again.");
            } finally {
                setWorking(false);
            }
        }
    }

    return (
        <dialog
            className="workspace-dialog"
            ref={dialog}
            onCancel={(event) => {
                event.preventDefault();
                close();
            }}
            onClose={() => {
                setPanel(null);
                setLocalError("");
            }}
            onClick={(event) => {
                if (event.target === event.currentTarget) close();
            }}
            aria-labelledby="panel-title"
        >
            <div className="panel-inner">
                <header className="panel-header">
                    <button className="icon-button" onClick={close} aria-label="Close panel">
                        <Glyph name="close" size={17} />
                    </button>
                </header>
                <FadeIn key={secret?.name || String(panel)}>
                    <div className="panel-content">
                        <h2 id="panel-title">{title}</h2>
                        {(panel === "vault" || panel === "find") && (
                            <>
                                <form onSubmit={submit} className="panel-form">
                                    <label htmlFor="ens-name">
                                        {panel === "vault" ? "Owner’s ENS name" : "Secret’s full ENS name"}
                                    </label>
                                    <input
                                        id="ens-name"
                                        name="name"
                                        defaultValue={panel === "vault" ? vault?.owner : ""}
                                        placeholder={panel === "vault" ? "name.eth" : "secret.rewall.name.eth"}
                                        autoComplete="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        required
                                    />
                                    <button className="button primary" disabled={busy || working}>
                                        {busy || working
                                            ? "Opening…"
                                            : panel === "vault"
                                              ? "Open vault"
                                              : "Find secret"}
                                    </button>
                                </form>
                                {panel === "vault" && (
                                    <button
                                        className="text-button test-vault-link"
                                        disabled={busy}
                                        onClick={async () => {
                                            if (await loadVault(TEST_OWNER)) close();
                                        }}
                                    >
                                        Open the Sepolia test vault
                                    </button>
                                )}
                                <div className="notice">
                                    <Icon name="lock" />
                                    <p>Opening a vault reads public metadata. It does not decrypt any value.</p>
                                </div>
                            </>
                        )}
                        {panel === "wallet" && (
                            <>
                                {account ? (
                                    <>
                                        <div className="detail-block">
                                            <span className="muted">Connected address</span>
                                            <p className="mono address">{account}</p>
                                            <CopyButton value={account} label="Copy wallet address" />
                                        </div>
                                        <div className="detail-block">
                                            <span className="muted">Secret key</span>
                                            <p>
                                                {identity.unlocked ? (
                                                    <>
                                                        Unlocked in this tab,{" "}
                                                        <span className="mono">{identity.fingerprint}</span>
                                                    </>
                                                ) : (
                                                    "Locked"
                                                )}
                                            </p>
                                            {identity.unlocked ? (
                                                <button className="button" onClick={identity.lock}>
                                                    Lock
                                                </button>
                                            ) : (
                                                <button
                                                    className="button"
                                                    onClick={() => {
                                                        setPanel(null);
                                                        void identity.unlock();
                                                    }}
                                                    disabled={identity.unlocking}
                                                >
                                                    {identity.unlocking ? "Waiting for your wallet…" : "Unlock"}
                                                </button>
                                            )}
                                            <p className="field-help">
                                                Your key is derived from one signature and held in memory for this tab
                                                only. It is never written to disk and never leaves this device.
                                            </p>
                                            {identity.error && (
                                                <p className="form-error" role="alert">
                                                    {identity.error}
                                                </p>
                                            )}
                                        </div>
                                        <button className="button" onClick={disconnect}>
                                            Disconnect
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            className="button primary full-width"
                                            onClick={connect}
                                            disabled={!ready}
                                        >
                                            {ready ? "Connect a wallet" : "Loading…"}
                                        </button>
                                        <p className="field-help">
                                            Bring your own wallet or have one made for you from an email address.
                                            Connecting reads your public address and signs nothing.
                                        </p>
                                    </>
                                )}
                            </>
                        )}
                        {panel === "help" && (
                            <ol className="explanation-list">
                                <li>
                                    <span className="mono">01</span>
                                    <div>
                                        <h3>ENS ownership</h3>
                                        <p>Your secrets live under your ENS name. No account, no company server.</p>
                                    </div>
                                </li>
                                <li>
                                    <span className="mono">02</span>
                                    <div>
                                        <h3>Encryption</h3>
                                        <p>Values are encrypted on your device. Public metadata never reveals them.</p>
                                    </div>
                                </li>
                                <li>
                                    <span className="mono">03</span>
                                    <div>
                                        <h3>Recovery</h3>
                                        <p>
                                            Every secret carries a recovery recipient, so a lost wallet is not the end.
                                        </p>
                                    </div>
                                </li>
                            </ol>
                        )}
                        {secret && (
                            <>
                                <div className="secret-detail-name">
                                    <span className="mono">{secret.name}</span>
                                    <CopyButton value={secret.name} />
                                </div>
                                <div className="sealed-value">
                                    <Icon name="lock" size={22} />
                                    <span className="mono">•••• •••• •••• ••••</span>
                                </div>
                                <dl className="detail-list">
                                    <div>
                                        <dt>Type</dt>
                                        <dd>{TYPE_LABELS[secret.type as SecretType] || secret.type}</dd>
                                    </div>
                                    <div>
                                        <dt>Encryption</dt>
                                        <dd>
                                            {secret.encryption === "aes-256-gcm"
                                                ? "AES-256-GCM"
                                                : secret.encryption || "Unspecified"}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>Created</dt>
                                        <dd>
                                            {secret.created
                                                ? new Date(secret.created * 1000).toLocaleDateString("en-GB", {
                                                      dateStyle: "medium",
                                                      timeZone: "UTC",
                                                  })
                                                : "Not recorded"}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>Allowed hosts</dt>
                                        <dd>{secret.allow.length ? secret.allow.join(", ") : "None"}</dd>
                                    </div>
                                </dl>
                            </>
                        )}
                        {(localError || (panel === "vault" && error)) && (
                            <p className="form-error" role="alert">
                                {localError || error}
                            </p>
                        )}
                        {working && <FadeDots />}
                    </div>
                </FadeIn>
            </div>
        </dialog>
    );
}
