"use client";

import { Toaster } from "sonner";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { type EIP1193Provider } from "viem";
import { sepolia } from "viem/chains";
import { PrivateDataProvider } from "./private-data";
import { IdentityProvider, useIdentity } from "./identity";
import { RailProvider } from "./rail";
import { FundBalance, ReceiptDetail, SendTransfer, WithdrawBalance } from "./transfer-forms";
import { SecretValue } from "./secret-value";
import { SecretAccess } from "./secret-access";
import { CreateSecret } from "./create-secret";
import { AddAuthenticator } from "./add-authenticator";
import { ConnectGate } from "./connect-gate";
import { AddSecret } from "./add-secret";
import { ownsName, rememberName, resolveOwnName } from "@/src/lib/account";
import {
    ownerName,
    readSecret,
    readVault,
    TYPE_LABELS,
    type Secret,
    type SecretType,
    type Vault,
} from "@/src/lib/vault";
import { FadeDots, FadeIn, SidebarFade } from "./amicro";
import { Logo } from "./logo";
import { CopyButton, Glyph, Icon, type IconName } from "./ui";

type Panel =
    "vault" | "wallet" | "help" | "find" | "create" | "authenticator" | "send" | "fund" | "withdraw" | Secret | null;
type Workspace = {
    vault: Vault | null;
    busy: boolean;
    error: string;
    account: string;
    walletLabel: string;
    ready: boolean;
    ownName: string;
    isOwnVault: boolean;
    claimName: (name: string) => Promise<boolean>;
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
            : pathname.includes("/recovery")
              ? "Recovery"
              : "Home";
    const [loadedVault, setVault] = useState<Vault | null>(null);
    const [loading, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [panel, setPanel] = useState<Panel>(null);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [resolvedName, setResolvedName] = useState<{ address: string; name: string } | null>(null);
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

    // Tied to the address it was resolved for, so disconnecting drops it without a second render
    const ownName = resolvedName?.address === account ? resolvedName.name : "";

    // Derived rather than set, because disconnecting is not an event, it just means there is nothing
    // of theirs left to show, and the lookup is still running until its answer names this address
    const vault = account ? loadedVault : null;
    const resolving = Boolean(account) && resolvedName?.address !== account;
    const busy = Boolean(account) && (resolving || (Boolean(ownName) && loading));

    // A connected wallet opens its own vault and nobody else's, once the registry confirms the name is theirs
    useEffect(() => {
        let active = true;
        if (!account) return;

        void resolveOwnName(account).then((found) => {
            if (!active) return;
            setResolvedName({ address: account, name: found });
            if (found) void loadVault(found);
        });
        return () => {
            active = false;
        };
    }, [account, loadVault]);

    const claimName = useCallback(
        async (input: string) => {
            const name = ownerName(input);
            if (!(await ownsName(name, account))) return false;
            rememberName(account, name);
            setResolvedName({ address: account, name });
            await loadVault(name);
            return true;
        },
        [account, loadVault],
    );

    // Privy hands the provider over asynchronously, so the identity session asks for it when it needs it
    // Its login time switch has no add chain fallback, so a wallet without Sepolia arrives still on its old one
    // switchChain adds the chain first, and Privy's own note is that a provider taken before it keeps the old id
    const getProvider = useCallback(async () => {
        if (!wallet) return null;
        if (wallet.chainId !== `eip155:${sepolia.id}`) await wallet.switchChain(sepolia.id);
        return (await wallet.getEthereumProvider()) as EIP1193Provider;
    }, [wallet]);

    const isOwnVault = Boolean(ownName) && vault?.owner === ownName;

    const workspace: Workspace = {
        vault,
        busy,
        error,
        account,
        walletLabel,
        ready,
        ownName,
        isOwnVault,
        claimName,
        panel,
        setPanel,
        loadVault,
        refresh: () => void loadVault(vault?.owner || ownName),
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
            <IdentityProvider address={account} getProvider={getProvider} name={ownName}>
                {/* Wraps the drawer as well as the page, since the transfer panels render inside it */}
                <RailProvider key={account} address={account} getProvider={getProvider}>
                    <div className="dashboard-app">
                        <a className="skip-link" href="#workspace-content">
                            Skip to content
                        </a>
                        {mobileOpen && (
                            <button className="mobile-scrim" onClick={navigate} aria-label="Close navigation" />
                        )}
                        <SidebarFade className={`sidebar ${mobileOpen ? "is-open" : ""}`} label="Main navigation">
                            <div className="brand-row" style={step(0)}>
                                <Link href="/dashboard" className="brand" aria-label="Rewall home" onClick={navigate}>
                                    <Logo />
                                </Link>
                            </div>
                            <nav>
                                <div className="nav-group">
                                    {(
                                        [
                                            { href: "/dashboard", label: "Home", icon: "home" },
                                            { href: "/dashboard/secrets", label: "Secrets", icon: "key" },
                                            { href: "/dashboard/2fa", label: "2FA", icon: "authenticator" },
                                            { href: "/dashboard/transfers", label: "Transfers", icon: "wallet" },
                                            { href: "/dashboard/recovery", label: "Recovery", icon: "shield" },
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
                            </nav>
                            <div className="sidebar-bottom">
                                <nav aria-label="Resources">
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
                                <div className="sidebar-action" style={step(7)}>
                                    <AddSecret fullWidth />
                                </div>
                                <button
                                    className="sidebar-control sidebar-vault"
                                    id="tour-vault"
                                    style={step(10)}
                                    onClick={() => setPanel("vault")}
                                >
                                    <span className="account-avatar">
                                        <Icon name="lock" size={18} />
                                    </span>
                                    <span className="sidebar-control-label">
                                        <strong className={ownName ? "mono" : ""}>{ownName || "No vault yet"}</strong>
                                        {!ownName && <small>Set one up</small>}
                                    </span>
                                    <span className="wallet-chevron">
                                        <Glyph name="chevron_right" size={18} />
                                    </span>
                                </button>
                                <button
                                    className="sidebar-control sidebar-account"
                                    style={step(11)}
                                    onClick={() => setPanel("wallet")}
                                >
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
                            </div>
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
                                    <ConnectGate>{children}</ConnectGate>
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
                </RailProvider>
            </IdentityProvider>
        </WorkspaceContext>
    );
}

const TITLES: Record<string, string> = {
    vault: "Your vault",
    wallet: "Your wallet",
    find: "Find a secret",
    create: "Store a secret",
    authenticator: "Add an authenticator",
    send: "Send privately",
    fund: "Add funds",
    withdraw: "Take funds out",
};

function WorkspacePanel() {
    const {
        panel,
        setPanel,
        vault,
        loadVault,
        busy,
        error,
        account,
        walletLabel,
        ready,
        ownName,
        claimName,
        connect,
        disconnect,
    } = useWorkspace();
    const identity = useIdentity();
    const dialog = useRef<HTMLDialogElement>(null);
    const drawerMotion = useRef<Animation | null>(null);
    const [localError, setLocalError] = useState("");
    const [working, setWorking] = useState(false);
    const [claiming, setClaiming] = useState(false);
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
    // Resolved from the vault rather than the snapshot the click captured, so a grant updates the panel
    const opened = typeof panel === "object" ? panel : null;
    const secret = opened ? (vault?.secrets.find((entry) => entry.name === opened.name) ?? opened) : null;
    const title = secret ? secret.label : (TITLES[String(panel)] ?? "How Rewall works");

    async function claim(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setLocalError("");
        const input = String(new FormData(event.currentTarget).get("own"));
        setClaiming(true);
        try {
            if (await claimName(input)) close();
            else setLocalError("That name is not held by the connected wallet.");
        } catch {
            setLocalError("Enter a complete ENS name ending in .eth.");
        } finally {
            setClaiming(false);
        }
    }

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
                        {panel === "find" && (
                            <>
                                <form onSubmit={submit} className="panel-form">
                                    <label htmlFor="ens-name">Secret’s full ENS name</label>
                                    <input
                                        id="ens-name"
                                        name="name"
                                        placeholder="secret.rewall.name.eth"
                                        autoComplete="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        required
                                    />
                                    <button className="button primary" disabled={busy || working}>
                                        {busy || working ? "Opening…" : "Find secret"}
                                    </button>
                                </form>
                                <p className="field-help">
                                    Nothing is written on your name when someone shares with you, so a secret shared
                                    with you is found by its name.
                                </p>
                                <div className="notice">
                                    <Icon name="lock" />
                                    <p>Looking a secret up reads public metadata. It does not decrypt any value.</p>
                                </div>
                            </>
                        )}
                        {panel === "vault" && (
                            <>
                                {ownName ? (
                                    <>
                                        <dl className="detail-list">
                                            <div>
                                                <dt>Your name</dt>
                                                <dd className="mono">{ownName}</dd>
                                            </div>
                                        </dl>
                                        <p className="field-help">
                                            Everything you store lives under rewall.{ownName}, held by this wallet and
                                            nobody else.
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <p className="field-help">
                                            Rewall has to know which name is yours before it can store anything under
                                            it.
                                        </p>
                                        <Link
                                            href="/dashboard/setup"
                                            className="button primary full-width"
                                            onClick={close}
                                        >
                                            Set up a new vault
                                        </Link>
                                        <form onSubmit={claim} className="panel-form claim-form">
                                            <label htmlFor="own-name">Or name one you already own</label>
                                            <input
                                                id="own-name"
                                                name="own"
                                                placeholder="name.eth"
                                                autoComplete="off"
                                                autoCapitalize="none"
                                                spellCheck={false}
                                                required
                                            />
                                            <button className="button" disabled={claiming}>
                                                {claiming ? "Checking the registry…" : "This one is mine"}
                                            </button>
                                            <p className="field-help">
                                                Checked against the registry, so a name you do not hold will be refused.
                                            </p>
                                        </form>
                                    </>
                                )}
                            </>
                        )}
                        {panel === "create" && <CreateSecret onDone={close} />}
                        {panel === "authenticator" && <AddAuthenticator onDone={close} />}
                        {panel === "send" && <SendTransfer onDone={close} />}
                        {panel === "fund" && <FundBalance onDone={close} />}
                        {panel === "withdraw" && <WithdrawBalance onDone={close} />}
                        {panel === "wallet" && (
                            <>
                                {account ? (
                                    <>
                                        <dl className="detail-list wallet-list">
                                            <div>
                                                <dt>Address</dt>
                                                <dd className="wallet-address">
                                                    <span className="mono">
                                                        {account.slice(0, 6)}…{account.slice(-4)}
                                                    </span>
                                                    <CopyButton value={account} label="Copy wallet address" />
                                                </dd>
                                            </div>
                                            <div>
                                                <dt>Wallet</dt>
                                                <dd>{walletLabel || "Connected"}</dd>
                                            </div>
                                            <div>
                                                <dt>Secret key</dt>
                                                <dd className={identity.unlocked ? "key-state is-open" : "key-state"}>
                                                    {identity.unlocked ? "Unlocked for this tab" : "Locked"}
                                                </dd>
                                            </div>
                                            {identity.unlocked && (
                                                <div>
                                                    <dt>Fingerprint</dt>
                                                    <dd className="mono">{identity.fingerprint}</dd>
                                                </div>
                                            )}
                                        </dl>
                                        {identity.unlocked ? (
                                            <button className="button full-width" onClick={identity.lock}>
                                                Lock
                                            </button>
                                        ) : (
                                            <button
                                                className="button primary full-width"
                                                onClick={() => {
                                                    setPanel(null);
                                                    void identity.unlock();
                                                }}
                                                disabled={identity.unlocking}
                                            >
                                                {identity.unlocking ? "Waiting for your wallet…" : "Unlock to read"}
                                            </button>
                                        )}
                                        {identity.error && (
                                            <p className="form-error" role="alert">
                                                {identity.error}
                                            </p>
                                        )}
                                        <div className="notice">
                                            <Icon name="shield" size={17} />
                                            <p>
                                                One signature derives your key. It stays in memory for this tab, never
                                                reaches disk, and never leaves this device.
                                            </p>
                                        </div>
                                        <button className="text-button wallet-disconnect" onClick={disconnect}>
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
                                {secret.type === "receipt" ? (
                                    <ReceiptDetail secret={secret} />
                                ) : (
                                    <SecretValue secret={secret} />
                                )}
                                <SecretAccess secret={secret} />
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
