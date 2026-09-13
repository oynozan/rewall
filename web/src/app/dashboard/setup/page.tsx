"use client";

import { useRouter } from "next/navigation";
import { SetupWizard } from "@/src/components/dashboard/setup-wizard";
import { useWorkspace } from "@/src/components/dashboard/dashboard-shell";

export default function SetupPage() {
    const router = useRouter();
    const { account, connect, claimName, adoptName } = useWorkspace();

    // Adopted on the way out rather than inside the wizard, because it changes the vault the shell keys on
    // The name was registered seconds ago, so one lagging read is expected and worth waiting out
    // Taken anyway once the wait is spent, since provisioning already confirmed this wallet holds it, and
    // leaving without it is what used to send the owner to an empty dashboard until they reloaded
    async function leave(name: string) {
        let held = false;
        for (let attempt = 0; attempt < 5 && !held; attempt++) {
            if (attempt) await new Promise((resolve) => setTimeout(resolve, 2000));
            held = await claimName(name).catch(() => false);
        }
        if (!held) await adoptName(name).catch(() => {});
        router.push("/dashboard/secrets");
    }

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

    return <SetupWizard address={account} onDone={leave} />;
}
