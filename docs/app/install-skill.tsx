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
            setTimeout(() => setCopied(false), 1600);
        } catch {}
    }

    return (
        <div className="skill" data-pagefind-ignore="all">
            <span className="skill-label">Teach your AI agent Rewall</span>
            <button type="button" className="skill-cmd" onClick={copy} aria-label="Copy the install command">
                <code>{COMMAND}</code>
                <span>{copied ? "Copied" : "Copy"}</span>
            </button>
        </div>
    );
}
