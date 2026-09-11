"use client";

import { useWorkspace } from "./dashboard-shell";
import { LiquidMetalButton } from "./liquid-metal-button";

// One control, dropped wherever storing a secret is the obvious next thing, all opening the same drawer
export function AddSecret({
    quiet,
    label = "Add secret",
    fullWidth = false,
}: {
    quiet?: boolean;
    label?: string;
    fullWidth?: boolean;
}) {
    const { ownName, account, setPanel, connect } = useWorkspace();

    if (!account) {
        return (
            <LiquidMetalButton label={label} onClick={connect} title="Connect a wallet first" fullWidth={fullWidth} />
        );
    }
    if (!ownName) {
        return <LiquidMetalButton label={label} disabled title="Set up your vault first" fullWidth={fullWidth} />;
    }

    if (quiet) {
        return (
            <button className="text-button" onClick={() => setPanel("create")}>
                {label}
            </button>
        );
    }

    return <LiquidMetalButton onClick={() => setPanel("create")} label={label} fullWidth={fullWidth} />;
}
