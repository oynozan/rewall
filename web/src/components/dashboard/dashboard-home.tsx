"use client";

import Link from "next/link";
import { HomeOnboarding } from "./home-onboarding";
import { DitherBanner } from "./dither-banner";
import { FadeIn } from "./amicro";
import { useWorkspace } from "./dashboard-shell";
import { GateBanner, useLocked } from "./connect-gate";
import { SecretsTable } from "./secrets-table";
import { TerminalOverview } from "./terminal-overview";
import { TwoFactorTable } from "./two-factor";
import { TransfersTable } from "./transfers";
import { AccountRail } from "./account-rail";
import { ExtensionBanner } from "./extension-banner";
import { PairExtension } from "./pair-extension";
import { Skeleton } from "./ui";

export function DashboardHome() {
    const { vault, busy } = useWorkspace();
    const secrets = vault?.secrets ?? [];
    const count = (total: number) => (busy ? <Skeleton width={14} height={9} /> : vault ? total : "—");
    // The gate sits inside the page here, so home marks the rest of itself inert instead
    const gated = useLocked();
    return (
        <HomeOnboarding>
            <div className="home-content">
                <FadeIn>
                    <DitherBanner />
                </FadeIn>
                <GateBanner />
                <div inert={gated}>
                    <FadeIn delay={0.04}>
                        <TerminalOverview />
                    </FadeIn>
                    <div className="home-body">
                        <div className="home-sections">
                            <FadeIn delay={0.08}>
                                <div className="section-heading" id="tour-secrets">
                                    <h2>
                                        Secrets
                                        <span className="heading-count mono">
                                            {count(
                                                secrets.filter((secret) => !["totp", "receipt"].includes(secret.type))
                                                    .length,
                                            )}
                                        </span>
                                    </h2>
                                    <Link href="/dashboard/secrets" className="text-button">
                                        View all
                                    </Link>
                                </div>
                                <SecretsTable compact />
                            </FadeIn>
                            <FadeIn delay={0.12} className="home-otp-grid">
                                <div className="home-otp-table">
                                    <div className="section-heading" id="tour-otp">
                                        <h2>
                                            2FA
                                            <span className="heading-count mono">
                                                {count(secrets.filter((secret) => secret.type === "totp").length)}
                                            </span>
                                        </h2>
                                        <Link href="/dashboard/2fa" className="text-button">
                                            View all
                                        </Link>
                                    </div>
                                    <TwoFactorTable compact />
                                </div>
                                <PairExtension compact />
                                <ExtensionBanner compact />
                            </FadeIn>
                            <FadeIn delay={0.16}>
                                <div className="section-heading" id="tour-transfers">
                                    <h2>Confidential transfers</h2>
                                    <Link href="/dashboard/transfers" className="text-button">
                                        View all
                                    </Link>
                                </div>
                                <div className="transfer-sections">
                                    <section>
                                        <h3 className="table-subheading">Sent</h3>
                                        <TransfersTable direction="sent" compact />
                                    </section>
                                    <section>
                                        <h3 className="table-subheading">Shared with you</h3>
                                        <TransfersTable direction="shared" compact />
                                    </section>
                                </div>
                            </FadeIn>
                        </div>
                        <AccountRail />
                    </div>
                </div>
            </div>
        </HomeOnboarding>
    );
}
