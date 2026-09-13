"use client";

import { useState } from "react";

export const COMMAND = "npx skills add oynozan/rewall --skill rewall";

export function InstallSkill() {
    const [copied, setCopied] = useState(false);

    async function copy() {
        // The clipboard can be refused, and a quiet no beats a dialog on every page
        try {
            await navigator.clipboard.writeText(COMMAND);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        } catch {}
    }

    return (
        <button
            type="button"
            className="skill-cmd"
            data-copied={copied || undefined}
            data-pagefind-ignore="all"
            onClick={copy}
            aria-label="Copy the command that installs the Rewall skill"
        >
            <code>{COMMAND}</code>
        </button>
    );
}
