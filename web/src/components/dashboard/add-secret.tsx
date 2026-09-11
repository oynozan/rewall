"use client";

import { useWorkspace } from "./dashboard-shell";

// One control, dropped wherever storing a secret is the obvious next thing, all opening the same drawer
export function AddSecret({ quiet, label = "Add secret" }: { quiet?: boolean; label?: string }) {
    const { ownName, account, setPanel, connect } = useWorkspace();

    if (!account) {
        return (
            <button className={quiet ? "text-button" : "button primary"} onClick={connect}>
                Connect to add secrets
            </button>
        );
    }

    // Disabled with the reason said out loud, because a control that quietly vanishes reads as a bug
    if (!ownName) {
        return (
            <button className={quiet ? "text-button" : "button primary"} disabled title="Set up your vault first">
                {label}
            </button>
        );
    }

    return (
        <button className={quiet ? "text-button" : "button primary"} onClick={() => setPanel("create")}>
            {label}
        </button>
    );
}
