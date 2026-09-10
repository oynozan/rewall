"use client";

import Image from "next/image";
import Link from "next/link";
import { DitherBanner } from "./dither-banner";
import { FadeIn } from "./amicro";
import { useWorkspace } from "./dashboard-shell";
import { SecretsTable } from "./secrets-table";
import { Icon, SegmentedProgress, type IconName } from "./ui";

export function DashboardHome() {
    const { vault, account, setPanel, busy } = useWorkspace();
    const steps = Number(Boolean(vault)) + Number(Boolean(account));
    const collections: { label: string; description: string; type: string; icon: IconName }[] = [
        { label: "API keys", description: "The keys to the things you build.", type: "apikey", icon: "key" },
        {
            label: "Secure notes",
            description: "Little things worth keeping private.",
            type: "generic",
            icon: "documents",
        },
        {
            label: "Authenticator",
            description: "An extra layer for your accounts.",
            type: "totp",
            icon: "authenticator",
        },
    ];
    return (
        <div className="home-content">
            <FadeIn>
                <DitherBanner />
            </FadeIn>
            <FadeIn delay={0.06}>
                <div className="overview-strip">
                    <div>
                        <span className="muted">Secrets in this vault</span>
                        <strong className="mono">
                            {vault?.secrets.length.toString().padStart(2, "0") ?? "—"}
                            <Icon name="key" size={18} />
                        </strong>
                    </div>
                    <div>
                        <span className="muted">Identity</span>
                        <strong>
                            {vault ? (vault.identityPublished ? "Published" : "Not published") : "Not loaded"}
                            <Icon name="bitwarden" size={18} />
                        </strong>
                    </div>
                    <div>
                        <span className="muted">Storage</span>
                        <strong>
                            On your ENS name
                            <Icon name="folder_shared" size={18} />
                        </strong>
                    </div>
                    <div>
                        <span className="muted">Current view</span>
                        <strong>
                            Read-only
                            <span className="status-dot" />
                        </strong>
                    </div>
                </div>
            </FadeIn>
            <FadeIn className="home-body" delay={0.1}>
                <div className="main-column">
                    <section className="secrets-section">
                        <div className="section-heading">
                            <div>
                                <h2>
                                    Your secrets
                                    <span className="heading-count mono">{vault?.secrets.length ?? "—"}</span>
                                </h2>
                                <p>The important things, all in one place.</p>
                            </div>
                            <Link href="/dashboard/secrets" className="text-button">
                                View all<span aria-hidden="true">↗</span>
                            </Link>
                        </div>
                        <SecretsTable compact />
                    </section>
                    <section className="collections-section">
                        <div className="section-heading">
                            <h2>A place for everything</h2>
                            <span className="muted section-kicker">Your collections</span>
                        </div>
                        <div className="collection-list">
                            {collections.map((item) => (
                                <Link
                                    key={item.type}
                                    href={`/dashboard/secrets?type=${item.type}`}
                                    className="collection-row"
                                >
                                    <span className="collection-icon">
                                        <Icon name={item.icon} size={25} />
                                    </span>
                                    <div>
                                        <h3>{item.label}</h3>
                                        <p>{item.description}</p>
                                    </div>
                                    <span className="collection-count mono">
                                        {vault
                                            ? vault.secrets
                                                  .filter((secret) => secret.type === item.type)
                                                  .length.toString()
                                                  .padStart(2, "0")
                                            : "—"}
                                    </span>
                                    <span className="row-arrow" aria-hidden="true">
                                        ↗
                                    </span>
                                </Link>
                            ))}
                        </div>
                    </section>
                </div>
                <aside className="home-aside">
                    <section className="getting-started">
                        <div className="section-heading">
                            <h2>Settle in</h2>
                            <span className="mono subtle">{steps} / 2</span>
                        </div>
                        <p className="muted">Your own space. Just a couple of steps.</p>
                        <SegmentedProgress value={steps} max={2} label="Getting started" segments={30} />
                        <div className="setup-task">
                            <span className={`step-marker ${account ? "complete" : ""}`}>{account ? "✓" : "1"}</span>
                            <button onClick={() => setPanel("wallet")}>
                                <strong>{account ? "Wallet connected" : "Connect your wallet"}</strong>
                                <small>Your keys, your identity.</small>
                            </button>
                            <span aria-hidden="true">↗</span>
                        </div>
                        <div className="setup-task">
                            <span className={`step-marker ${vault ? "complete" : ""}`}>{vault ? "✓" : "2"}</span>
                            <button onClick={() => setPanel("vault")}>
                                <strong>{vault ? "A vault to explore" : "Open an ENS vault"}</strong>
                                <small>
                                    {busy
                                        ? "Finding your way in…"
                                        : vault
                                          ? "Take a look around."
                                          : "Find your space by name."}
                                </small>
                            </button>
                            <span aria-hidden="true">↗</span>
                        </div>
                    </section>
                    <section className="peace-section">
                        <Image
                            src="/illustrations/quiet-key.png"
                            className="peace-illustration"
                            width={208}
                            height={208}
                            alt="A small dithered key resting on a folded envelope"
                        />
                        <span className="eyebrow mono">A LITTLE PEACE OF MIND</span>
                        <h2>
                            Some things are
                            <br />
                            just for you.
                        </h2>
                        <p>Encrypted on your device. Stored under your name. Shared only with the people you choose.</p>
                        <button className="text-button" onClick={() => setPanel("help")}>
                            Get to know Rewall<span aria-hidden="true">↗</span>
                        </button>
                    </section>
                </aside>
            </FadeIn>
        </div>
    );
}
