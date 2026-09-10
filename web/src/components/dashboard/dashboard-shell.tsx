"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { sepolia } from "viem/chains";
import { Rewall, wipe } from "@rewall/sdk";
import { PrivateDataProvider } from "./private-data";
import { MOCKS_ENABLED, mockOtpBytes } from "../../../scripts/dashboard-mocks";
import {
    vaultClient,
    UNIVERSAL_RESOLVER,
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
import { CopyButton, Glyph, Icon, type IconName } from "./ui";

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
    decryptSecret: (name: string) => Promise<Uint8Array>;
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

    async function decryptSecret(name: string) {
        if (MOCKS_ENABLED) return mockOtpBytes(name);
        const injected = provider.current;
        if (!injected || !account || !vault) {
            setPanel("wallet");
            throw new Error("Connect your wallet first.");
        }
        const wallet = createWalletClient({ account: account as Address, chain: sepolia, transport: custom(injected) });
        const reader = new Rewall({
            publicClient: vaultClient,
            walletClient: wallet,
            account: { signMessage: ({ message }: { message: string }) => wallet.signMessage({ message }) },
            name: vault.owner,
            universalResolver: UNIVERSAL_RESOLVER,
        });
        const identity = await reader.identity();
        try {
            return await reader.get(name);
        } finally {
            await wipe(identity.secretKey);
        }
    }

    const workspace: Workspace = {
        vault,
        busy,
        error,
        account,
        panel,
        setPanel,
        loadVault,
        refresh: () => void loadVault(vault?.owner || TEST_OWNER),
        decryptSecret,
    };
    const navigate = () => setMobileOpen(false);

    return (
        <WorkspaceContext value={workspace}>
            <div className="dashboard-app">
                <a className="skip-link" href="#workspace-content">
                    Skip to content
                </a>
                {mobileOpen && <button className="mobile-scrim" onClick={navigate} aria-label="Close navigation" />}
                <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`} aria-label="Main navigation">
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
                            <strong>Personal workspace</strong>
                            <small>{vault?.owner || "No vault open"}{MOCKS_ENABLED ? " · Mock" : ""}</small>
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
                            <small>{account ? "MetaMask" : "Connect wallet"}</small>
                        </span>
                    </button>
                </aside>
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
                        <PrivateDataProvider key={`${account}:${vault?.owner || ""}`}>{children}</PrivateDataProvider>
                    </main>
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
                                        <button className="button" onClick={() => onAccount("")}>
                                            Disconnect
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
                                            Get MetaMask
                                        </a>
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
