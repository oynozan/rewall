"use client";

import { useState } from "react";

export const SKILL_COMMAND = "npx skills add oynozan/rewall --skill rewall";

export function CopyCommand() {
    const [copied, setCopied] = useState(false);

    async function copy() {
        // The clipboard can be refused, and a quiet no beats a dialog
        try {
            await navigator.clipboard.writeText(SKILL_COMMAND);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        } catch {}
    }

    return (
        <button
            type="button"
            className="cmd"
            data-copied={copied || undefined}
            onClick={copy}
            aria-label="Copy the command that installs the Rewall skill"
        >
            <code>{SKILL_COMMAND}</code>
        </button>
    );
}
