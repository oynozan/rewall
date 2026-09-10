"use client";

import Link from "next/link";
import { DitherBanner } from "./dither-banner";
import { FadeIn } from "./amicro";
import { useWorkspace } from "./dashboard-shell";
import { SecretsTable } from "./secrets-table";
import { TerminalOverview } from "./terminal-overview";
import { TwoFactorTable } from "./two-factor";
import { TransfersTable } from "./transfers";
import { AccountRail } from "./account-rail";

export function DashboardHome() {
    const { vault } = useWorkspace();
    return (
        <div className="home-content">
            <FadeIn>
                <DitherBanner />
            </FadeIn>
            <FadeIn delay={0.04}>
                <TerminalOverview />
            </FadeIn>
            <div className="home-body"><div className="home-sections">
                <FadeIn delay={0.08}>
                    <div className="section-heading">
                        <h2>
                            Secrets
                            <span className="heading-count mono">
                                {vault?.secrets.filter((secret) => !["totp", "receipt"].includes(secret.type)).length ??
                                    "—"}
                            </span>
                        </h2>
                        <Link href="/dashboard/secrets" className="text-button">
                            View all
                        </Link>
                    </div>
                    <SecretsTable compact />
                </FadeIn>
                <FadeIn delay={0.12}>
                    <div className="section-heading">
                        <h2>
                            2FA
                            <span className="heading-count mono">
                                {vault?.secrets.filter((secret) => secret.type === "totp").length ?? "—"}
                            </span>
                        </h2>
                        <Link href="/dashboard/2fa" className="text-button">
                            View all
                        </Link>
                    </div>
                    <TwoFactorTable compact />
                </FadeIn>
                <FadeIn delay={0.16}>
                    <div className="section-heading">
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
            </div><AccountRail /></div>
        </div>
    );
}
