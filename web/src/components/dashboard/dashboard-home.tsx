"use client";

import Link from "next/link";
import { AccountRail } from "./account-rail";
import { DitherBanner } from "./dither-banner";
import { FadeIn } from "./amicro";
import { useWorkspace } from "./dashboard-shell";
import { SecretsTable } from "./secrets-table";

export function DashboardHome() {
    const { vault } = useWorkspace();
    return (
        <div className="home-content">
            <FadeIn>
                <DitherBanner />
            </FadeIn>
            <div className="home-grid">
                <FadeIn delay={0.06}>
                    <div className="section-heading">
                        <h2>
                            Secrets<span className="heading-count mono">{vault?.secrets.length ?? "—"}</span>
                        </h2>
                        <Link href="/dashboard/secrets" className="text-button">
                            View all
                        </Link>
                    </div>
                    <SecretsTable compact />
                </FadeIn>
                <FadeIn delay={0.12}>
                    <AccountRail />
                </FadeIn>
            </div>
        </div>
    );
}
