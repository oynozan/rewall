"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { EIP1193Provider } from "viem";
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
import { FadeDots, FadeIn } from "./amicro";
import { CopyButton, Icon, SegmentedProgress, type IconName } from "./ui";

type Panel = "vault" | "wallet" | "help" | "find" | Secret | null;
type WalletProvider = EIP1193Provider & { isMetaMask?: boolean; providers?: WalletProvider[] };
type Workspace = {
    vault: Vault | null;
    busy: boolean;
    error: string;
    account: string;
    panel: Panel;
    setPanel: (panel: Panel) => void;
    loadVault: (name: string) => Promise<boolean>;
    refresh: () => void;
};
const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace() {
    const workspace = useContext(WorkspaceContext);
    if (!workspace) throw new Error("Workspace must be inside the dashboard");
    return workspace;
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isHome = pathname === "/dashboard";
    const [vault, setVault] = useState<Vault | null>(null);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [account, setAccount] = useState("");
    const [panel, setPanel] = useState<Panel>(null);
    const [mobileOpen, setMobileOpen] = useState(false);
    const request = useRef(0);
    const provider = useRef<WalletProvider | null>(null);
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

    useEffect(() => {
        const injected = (window as Window & { ethereum?: WalletProvider }).ethereum;
        provider.current =
            injected?.providers?.find((item) => item.isMetaMask) ?? (injected?.isMetaMask ? injected : null);
        const accountsChanged = (accounts: string[]) => setAccount(accounts[0] || "");
        const disconnected = () => setAccount("");
        provider.current?.on("accountsChanged", accountsChanged);
        provider.current?.on("disconnect", disconnected);
        return () => {
            provider.current?.removeListener("accountsChanged", accountsChanged);
            provider.current?.removeListener("disconnect", disconnected);
        };
    }, []);

    const workspace: Workspace = {
        vault,
        busy,
        error,
        account,
        panel,
        setPanel,
        loadVault,
        refresh: () => void loadVault(vault?.owner || TEST_OWNER),
    };
    const count = (type: string) => (vault ? vault.secrets.filter((secret) => secret.type === type).length : "—");
    const navigate = () => setMobileOpen(false);

    return (
        <WorkspaceContext value={workspace}>
            <div className="dashboard-app">
                <a className="skip-link" href="#workspace-content">
                    Skip to content
                </a>
                {mobileOpen && <button className="mobile-scrim" onClick={navigate} aria-label="Close navigation" />}
                <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`} aria-label="Main navigation">
                    <div className="brand-row">
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
                        <span className="version-tag mono">beta</span>
                    </div>
                    <button className="workspace-switcher" onClick={() => setPanel("vault")}>
                        <span className="workspace-avatar">
                            <Icon name="lock" size={21} />
                        </span>
                        <span>
                            <strong>Personal workspace</strong>
                            <small>{vault?.owner || "Your private space"}</small>
                        </span>
                        <span className="chevron" aria-hidden="true">
                            ⌄
                        </span>
                    </button>
                    <nav>
                        <div className="nav-group">
                            <span className="nav-caption">Workspace</span>
                            <Link
                                href="/dashboard"
                                className={`nav-item ${isHome ? "selected" : ""}`}
                                aria-current={isHome ? "page" : undefined}
                                onClick={navigate}
                            >
                                <Icon name="home" />
                                Home
                            </Link>
                            <Link
                                href="/dashboard/secrets"
                                className={`nav-item ${!isHome ? "selected" : ""}`}
                                aria-current={!isHome ? "page" : undefined}
                                onClick={navigate}
                            >
                                <Icon name="key" />
                                All secrets<span className="nav-count mono">{vault?.secrets.length ?? "—"}</span>
                            </Link>
                        </div>
                        <div className="nav-group">
                            <span className="nav-caption">Collections</span>
                            {(
                                [
                                    { type: "apikey", label: "API keys", icon: "key" },
                                    { type: "generic", label: "Secure notes", icon: "documents" },
                                    { type: "totp", label: "Authenticator", icon: "authenticator" },
                                ] as { type: string; label: string; icon: IconName }[]
                            ).map((item) => (
                                <Link
                                    key={item.type}
                                    className="nav-item"
                                    href={`/dashboard/secrets?type=${item.type}`}
                                    onClick={navigate}
                                >
                                    <Icon name={item.icon} />
                                    {item.label}
                                    <span className="nav-count plain mono">{count(item.type)}</span>
                                </Link>
                            ))}
                        </div>
                        <div className="nav-group resource-group">
                            <span className="nav-caption">A little guidance</span>
                            <button
                                className="nav-item"
                                onClick={() => {
                                    setPanel("help");
                                    navigate();
                                }}
                            >
                                <Icon name="bitwarden" />
                                How Rewall works
                                <span className="nav-end" aria-hidden="true">
                                    ↗
                                </span>
                            </button>
                        </div>
                    </nav>
                    <div className="sidebar-bottom">
                        <div className="sidebar-setup">
                            <div className="setup-caption">
                                <span>Make yourself at home</span>
                                <span className="mono">{Number(Boolean(account)) + Number(Boolean(vault))}/2</span>
                            </div>
                            <SegmentedProgress
                                value={Number(Boolean(account)) + Number(Boolean(vault))}
                                max={2}
                                label="Workspace setup"
                            />
                            <button className="text-button" onClick={() => setPanel(account ? "vault" : "wallet")}>
                                {account ? "Open your vault" : "Connect your wallet"}
                                <span aria-hidden="true">↗</span>
                            </button>
                        </div>
                        <a
                            className="nav-item"
                            href="https://github.com/oynozan/rewall"
                            target="_blank"
                            rel="noreferrer"
                        >
                            <Icon name="github" />
                            Source code
                            <span className="nav-end" aria-hidden="true">
                                ↗
                            </span>
                        </a>
                        <div className="network-row">
                            <span className="status-dot" />
                            ENSv2 Sepolia<span className="mini-badge">Testnet</span>
                        </div>
                        <button className="sidebar-account" onClick={() => setPanel("wallet")}>
                            <span className="account-avatar">
                                <Image src="/icon.svg" width={24} height={24} alt="" unoptimized />
                            </span>
                            <span>
                                <strong>
                                    {account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Your wallet"}
                                </strong>
                                <small>{account ? "Connected with MetaMask" : "Not connected"}</small>
                            </span>
                            <span className="nav-end" aria-hidden="true">
                                ⌄
                            </span>
                        </button>
                    </div>
                </aside>
                <div className="workspace-main">
                    <header className="topbar">
                        <div className="topbar-heading">
                            <button
                                className="mobile-menu icon-button"
                                onClick={() => setMobileOpen(!mobileOpen)}
                                aria-expanded={mobileOpen}
                                aria-label="Open navigation"
                            >
                                ☰
                            </button>
                            <Icon name={isHome ? "home" : "key"} size={19} />
                            <span className="topbar-divider" />
                            <span>{isHome ? "Home" : "Secrets"}</span>
                            <span className="mini-badge topbar-badge">Personal</span>
                        </div>
                        <div className="topbar-actions">
                            <span className="privacy-note">
                                <Icon name="lock" size={15} />A space of your own
                            </span>
                            <button className="button small" onClick={() => setPanel("wallet")}>
                                {account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Connect wallet"}
                            </button>
                        </div>
                    </header>
                    <main id="workspace-content" tabIndex={-1}>
                        {children}
                    </main>
                    <footer className="workspace-footer">
                        <span>Private by design. Yours by name.</span>
                        <span className="mono">
                            ENSv2 / SEPOLIA<span className="footer-divider">·</span>REWALL BETA
                        </span>
                    </footer>
                </div>
                <WorkspacePanel providerRef={provider} onAccount={setAccount} />
            </div>
        </WorkspaceContext>
    );
}

function WorkspacePanel({
    providerRef,
    onAccount,
}: {
    providerRef: React.RefObject<WalletProvider | null>;
    onAccount: (account: string) => void;
}) {
    const { panel, setPanel, vault, loadVault, busy, error, account } = useWorkspace();
    const dialog = useRef<HTMLDialogElement>(null);
    const [localError, setLocalError] = useState("");
    const [working, setWorking] = useState(false);
    useEffect(() => {
        if (panel) dialog.current?.showModal();
        else dialog.current?.close();
    }, [panel]);
    const close = () => {
        setPanel(null);
        setLocalError("");
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
              : "A little peace of mind";

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

    async function connect() {
        setLocalError("");
        const provider = providerRef.current;
        if (!provider) {
            setLocalError("MetaMask wasn’t found in this browser. Install the extension, then reload this page.");
            return;
        }
        setWorking(true);
        try {
            const accounts = await provider.request({ method: "eth_requestAccounts" });
            onAccount(accounts[0] || "");
        } catch {
            setLocalError("The connection wasn’t completed. You can try again whenever you’re ready.");
        } finally {
            setWorking(false);
        }
    }

    return (
        <dialog
            className="workspace-dialog"
            ref={dialog}
            onCancel={close}
            onClose={() => {
                if (panel) close();
            }}
            onClick={(event) => {
                if (event.target === event.currentTarget) close();
            }}
            aria-labelledby="panel-title"
        >
            <div className="panel-inner">
                <header className="panel-header">
                    <span className="nav-caption">{secret ? "Secret details" : "Your workspace"}</span>
                    <button className="icon-button" onClick={close} aria-label="Close panel">
                        ×
                    </button>
                </header>
                <FadeIn key={secret?.name || String(panel)}>
                    <div className="panel-content">
                        <h2 id="panel-title">{title}</h2>
                        {(panel === "vault" || panel === "find") && (
                            <>
                                <p className="panel-intro">
                                    {panel === "vault"
                                        ? "Your ENS name is the address of your private space. Open a vault to view its public details."
                                        : "Have the full name of a secret? Look it up directly, even if it isn’t in the vault’s list."}
                                </p>
                                <form onSubmit={submit} className="panel-form">
                                    <label htmlFor="ens-name">
                                        {panel === "vault" ? "Owner’s ENS name" : "Secret’s full ENS name"}
                                    </label>
                                    <input
                                        id="ens-name"
                                        name="name"
                                        defaultValue={panel === "vault" ? vault?.owner : ""}
                                        placeholder={
                                            panel === "vault" ? "Your ENS name" : "Full secret name ending in .eth"
                                        }
                                        autoComplete="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        required
                                    />
                                    <p className="field-help">
                                        {panel === "vault"
                                            ? "We’ll look inside the rewall subname."
                                            : "Only public metadata will be read. The value stays encrypted."}
                                    </p>
                                    <button className="button primary" disabled={busy || working}>
                                        {busy || working
                                            ? "Opening…"
                                            : panel === "vault"
                                              ? "Open vault"
                                              : "Find secret"}
                                        <span aria-hidden="true">↗</span>
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
                                        Explore the Sepolia test vault<span aria-hidden="true">↗</span>
                                    </button>
                                )}
                                <div className="notice">
                                    <Icon name="lock" />
                                    <p>
                                        This viewer is read-only. Opening a vault doesn’t grant access to its secret
                                        values.
                                    </p>
                                </div>
                            </>
                        )}
                        {panel === "wallet" && (
                            <>
                                <Image
                                    className="panel-illustration"
                                    src="/illustrations/quiet-key.png"
                                    width={224}
                                    height={224}
                                    alt="A dithered key resting on a folded envelope"
                                />
                                <p className="panel-intro">
                                    {account
                                        ? "Your wallet is connected. Your secret values stay encrypted in this read-only viewer."
                                        : "Your wallet is your connection to Rewall. No new account, email, or password to remember."}
                                </p>
                                {account ? (
                                    <>
                                        <div className="detail-block">
                                            <span className="muted">Connected address</span>
                                            <p className="mono address">{account}</p>
                                            <CopyButton value={account} label="Copy wallet address" />
                                        </div>
                                        <button className="button" onClick={() => onAccount("")}>
                                            Disconnect from Rewall
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            className="button primary full-width"
                                            onClick={connect}
                                            disabled={working}
                                        >
                                            {working ? "Waiting for MetaMask…" : "Connect MetaMask"}
                                            <span aria-hidden="true">↗</span>
                                        </button>
                                        <p className="field-help">
                                            Connecting requests your public address. It does not sign a message or send
                                            a transaction.
                                        </p>
                                        <a
                                            href="https://metamask.io/download"
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-button"
                                        >
                                            Get MetaMask<span aria-hidden="true">↗</span>
                                        </a>
                                    </>
                                )}
                            </>
                        )}
                        {panel === "help" && (
                            <>
                                <Image
                                    className="panel-illustration"
                                    src="/illustrations/quiet-key.png"
                                    width={224}
                                    height={224}
                                    alt="A dithered key resting on a folded envelope"
                                />
                                <p className="panel-intro">Important things deserve a space you control.</p>
                                <ol className="explanation-list">
                                    <li>
                                        <span className="mono">01</span>
                                        <div>
                                            <h3>Yours, by name</h3>
                                            <p>
                                                Your secrets live under your ENS name. No Rewall account or company
                                                server holds them.
                                            </p>
                                        </div>
                                    </li>
                                    <li>
                                        <span className="mono">02</span>
                                        <div>
                                            <h3>Closed to everyone else</h3>
                                            <p>
                                                Secret values are encrypted on your device. Public names and metadata
                                                never reveal the value inside.
                                            </p>
                                        </div>
                                    </li>
                                    <li>
                                        <span className="mono">03</span>
                                        <div>
                                            <h3>A spare key, by design</h3>
                                            <p>
                                                Creating a secret requires a recovery recipient, so a lost wallet
                                                doesn’t have to mean lost access.
                                            </p>
                                        </div>
                                    </li>
                                </ol>
                                <div className="notice">
                                    <p>
                                        You’re using the Sepolia testnet viewer. Creating secrets, sharing access, and
                                        recovery are not available in this version.
                                    </p>
                                </div>
                            </>
                        )}
                        {secret && (
                            <>
                                <div className="secret-detail-name">
                                    <Icon name="key" size={30} />
                                    <span className="mono">{secret.name}</span>
                                    <CopyButton value={secret.name} />
                                </div>
                                <span className="badge">{TYPE_LABELS[secret.type as SecretType] || secret.type}</span>
                                <div className="sealed-value">
                                    <Icon name="lock" size={25} />
                                    <span className="mono">•••• •••• •••• ••••</span>
                                    <small>Value stays encrypted</small>
                                </div>
                                <dl className="detail-list">
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
                                        <dt>Network</dt>
                                        <dd>ENSv2 Sepolia</dd>
                                    </div>
                                    <div>
                                        <dt>View</dt>
                                        <dd>Public metadata only</dd>
                                    </div>
                                    <div>
                                        <dt>Allowed hosts</dt>
                                        <dd>{secret.allow.length ? secret.allow.join(", ") : "None specified"}</dd>
                                    </div>
                                </dl>
                                <div className="notice">
                                    <Icon name="lock" />
                                    <p>
                                        Reading a secret’s name doesn’t open its contents. Decryption and access changes
                                        aren’t available in this viewer.
                                    </p>
                                </div>
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
                <footer className="panel-footer">
                    <span className="status-dot" />
                    ENSv2 Sepolia<span className="mono">READ-ONLY</span>
                </footer>
            </div>
        </dialog>
    );
}
