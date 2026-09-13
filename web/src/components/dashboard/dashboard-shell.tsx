"use client";

import { Toaster } from "sonner";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
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
import { cachedName, ownsName, rememberName, resolveOwnName } from "@/src/lib/account";
import { explain } from "@/src/lib/errors";
import {
    ownerName,
    readSecret,
    readVault,
    SEPOLIA,
    TYPE_LABELS,
    type Secret,
    type SecretType,
    type Vault,
} from "@/src/lib/vault";
import { FadeDots, FadeIn, SidebarFade } from "./amicro";
import { Logo } from "./logo";
import { CopyButton, Glyph, Icon, Skeleton, type IconName } from "./ui";

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
    adoptName: (name: string) => Promise<boolean>;
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

// 4902 is a wallet saying it has never been told about the chain, and viem nests the error that carried it
function lacksChain(failure: unknown) {
    let step = failure as { code?: number; message?: string; cause?: unknown } | undefined;
    for (let depth = 0; step && depth < 5; depth++) {
        // A proxied provider drops the numeric code on the way out, so the text it arrived with counts too
        if (step.code === 4902 || step.message?.includes("4902")) return true;
        step = step.cause as typeof step;
    }
    return false;
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const pageTitle = pathname.includes("/2fa")
        ? "2FA"
        : pathname.includes("/transfers")
          ? "Transfers"
          : pathname.includes("/secrets")
            ? "Secrets"
            : "Home";
    const [loadedVault, setVault] = useState<Vault | null>(null);
    const [loading, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [panel, setPanel] = useState<Panel>(null);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [resolvedName, setResolvedName] = useState<{ address: string; name: string } | null>(null);
    // The address the registry has answered for, which is what separates a guess from a confirmed name
    const [verified, setVerified] = useState("");
    const request = useRef(0);
    // Bumped whenever a name is adopted, so a reverse lookup that answers later cannot undo that choice
    const adopted = useRef(0);

    const { ready: privyReady, authenticated, login, logout } = usePrivy();
    const { wallets, ready: walletsSettled } = useWallets();
    const wallet = wallets[0];
    const [lastAddress, setLastAddress] = useState("");

    // Privy empties its wallet list while it rebuilds it and reports ready false until the list can be trusted
    if (wallet && wallet.address !== lastAddress) setLastAddress(wallet.address);
    else if (!wallet && walletsSettled && lastAddress) setLastAddress("");

    // Gated on the session rather than the list, so a logout clears the address on the same render
    const account = authenticated ? lastAddress : "";
    // Privy answers before its wallet list does, so a signed in reload has no address for a beat
    const ready = privyReady && (!authenticated || walletsSettled);
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
        } catch (failure) {
            // The thrown reason is more specific than a guess at the name or the connection
            if (current === request.current) setError(explain(failure));
            return false;
        } finally {
            if (current === request.current) setBusy(false);
        }
    }, []);

    // Seeded during render rather than in an effect, so the remembered name is on screen in the first paint
    if (account && resolvedName?.address !== account) setResolvedName({ address: account, name: cachedName(account) });

    // Tied to the address it was resolved for, so disconnecting drops it without a second render
    const ownName = resolvedName?.address === account ? resolvedName.name : "";

    // Derived rather than set, so disconnecting and a name the registry took away both clear it on the same render
    const vault = account && ownName ? loadedVault : null;
    const resolving = Boolean(account) && verified !== account;
    // Nothing is known until Privy has answered, so the page waits rather than claiming it is empty
    const busy = !ready || (Boolean(account) && (ownName ? loading : resolving));
    // A wallet with no remembered name has nothing to show yet, so the sidebar waits rather than denying it has one
    const naming = !ready || (Boolean(account) && !ownName && resolving);

    // Started off a microtask so the read marks itself busy after this render commits rather than during it
    useEffect(() => {
        if (!ownName) return;
        let active = true;
        void Promise.resolve().then(() => {
            if (active) void loadVault(ownName);
        });
        return () => {
            active = false;
        };
    }, [ownName, loadVault]);

    // The registry has the last word, and a name it hands to somebody else is dropped on the spot
    useEffect(() => {
        let active = true;
        if (!account) return;

        const since = adopted.current;
        void resolveOwnName(account).then((found) => {
            // A name adopted while this read was out is the newer answer, so the read is dropped
            if (!active || adopted.current !== since) return;
            setResolvedName({ address: account, name: found });
            setVerified(account);
        });
        return () => {
            active = false;
        };
    }, [account]);

    // The registry can lag a registration by a few blocks, so a name this wallet was just handed is taken
    // on trust and dropped on the next load by resolveOwnName if the registry names somebody else
    const adoptName = useCallback(
        async (input: string) => {
            const name = ownerName(input);
            adopted.current++;
            rememberName(account, name);
            setResolvedName({ address: account, name });
            setVerified(account);
            await loadVault(name);
            return true;
        },
        [account, loadVault],
    );

    const claimName = useCallback(
        async (input: string) => {
            const name = ownerName(input);
            if (!(await ownsName(name, account))) return false;
            return adoptName(name);
        },
        [account, adoptName],
    );

    // Privy hands the provider over asynchronously, so the identity session asks for it when it needs it
    // Signing against a domain the wallet is not on costs a CHAIN_ID_MISMATCH, so the wallet itself is asked
    // Privy's own switchChain returns early off its cached id, which a user moving the wallet leaves stale
    const getProvider = useCallback(async () => {
        if (!wallet) return null;
        const provider = (await wallet.getEthereumProvider()) as EIP1193Provider;
        const live = await provider.request({ method: "eth_chainId" });
        if (Number(live) === sepolia.id) return provider;

        const client = createWalletClient({ transport: custom(provider) });
        try {
            await client.switchChain({ id: sepolia.id });
        } catch (failure) {
            // Privy only adds the chain when someone logs in, so a returning session has to add it itself
            if (!lacksChain(failure)) throw failure;
            await client.addChain({ chain: SEPOLIA });
            await client.switchChain({ id: sepolia.id });
        }
        return provider;
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
        adoptName,
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
                                    aria-label={!ownName && naming ? "Your vault" : undefined}
                                    id="tour-vault"
                                    style={step(10)}
                                    onClick={() => setPanel("vault")}
                                >
                                    <span className="account-avatar">
                                        <Icon name="lock" size={18} />
                                    </span>
                                    <span className="sidebar-control-label">
                                        <strong className={ownName ? "mono" : ""}>
                                            {ownName || (naming ? <Skeleton width={104} /> : "No vault yet")}
                                        </strong>
                                        {!ownName && !naming && <small>Set one up</small>}
                                    </span>
                                    <span className="wallet-chevron">
                                        <Glyph name="chevron_right" size={18} />
                                    </span>
                                </button>
                                <button
                                    className="sidebar-control sidebar-account"
                                    aria-label={ready ? undefined : "Your wallet"}
                                    style={step(11)}
                                    onClick={() => setPanel("wallet")}
                                >
                                    <span className="account-avatar">
                                        <Icon name="wallet" size={18} />
                                    </span>
                                    <span>
                                        <strong className={account ? "mono" : ""}>
                                            {!ready ? (
                                                <Skeleton width={96} />
                                            ) : account ? (
                                                `${account.slice(0, 6)}…${account.slice(-4)}`
                                            ) : (
                                                "Not connected"
                                            )}
                                        </strong>
                                        <small>
                                            {!ready ? (
                                                <Skeleton width={64} height={9} />
                                            ) : account ? (
                                                walletLabel || "Connected"
                                            ) : (
                                                "Connect wallet"
                                            )}
                                        </small>
                                    </span>
                                    {ready && !account && (
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
    send: "Send confidential transfer",
    fund: "Deposit",
    withdraw: "Take funds out",
};

function WorkspacePanel() {
    const {
        panel,
        setPanel,
        vault,
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
        setWorking(true);
        try {
            setPanel(await readSecret(input));
        } catch {
            setLocalError("We couldn’t find a Rewall secret at that name. Check the name and try again.");
        } finally {
            setWorking(false);
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
                                    </>
                                )}
                                {/* A wallet can hold more than one name, so the vault it reads from is switchable */}
                                <form onSubmit={claim} className="panel-form claim-form">
                                    <label htmlFor="own-name">
                                        {ownName ? "Switch to another name you own" : "Or name one you already own"}
                                    </label>
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
                                                    // The reason is rendered from the session below, so it is caught and dropped here
                                                    void identity.unlock().catch(() => {});
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
