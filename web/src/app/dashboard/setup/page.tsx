"use client";

import { useRouter } from "next/navigation";
import { SetupWizard } from "@/src/components/dashboard/setup-wizard";
import { useWorkspace } from "@/src/components/dashboard/dashboard-shell";

export default function SetupPage() {
    const router = useRouter();
    const { account, connect } = useWorkspace();

    if (!account) {
        return (
            <div className="home-content">
                <p className="field-help">Connect a wallet to set up your vault.</p>
                <button className="button primary" onClick={connect}>
                    Connect a wallet
                </button>
            </div>
        );
    }

    return <SetupWizard address={account} onDone={() => router.push("/dashboard/secrets")} />;
}
