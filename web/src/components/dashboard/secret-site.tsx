"use client";

import { useState } from "react";
import { normalizeSite } from "@rewall/sdk";
import { explain } from "@/src/lib/errors";
import type { Secret } from "@/src/lib/vault";
import { useIdentity } from "./identity";
import { useWorkspace } from "./dashboard-shell";

// The hostname a code fills on is matched exactly, so a wrong one is invisible unless it is shown
export function SecretSite({ secret }: { secret: Secret }) {
    const { write } = useIdentity();
    const { isOwnVault, ownName, refresh } = useWorkspace();
    const [editing, setEditing] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");

    const mine = isOwnVault && secret.owner === ownName;

    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const typed = String(new FormData(event.currentTarget).get("site") || "").trim();
        setError("");

        let settled: string;
        try {
            settled = normalizeSite(typed);
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "That is not a hostname.");
            return;
        }

        setPending(true);
        try {
            await write((client) => client.setSite(secret.name, settled));
            setEditing(false);
            refresh();
        } catch (failure) {
            setError(explain(failure));
        } finally {
            setPending(false);
        }
    }

    if (!editing) {
        return (
            <span className="secret-site">
                <span className={secret.site ? "mono" : "unset"}>{secret.site || "Nowhere, it never fills"}</span>
                {mine && (
                    <button type="button" className="text-button" onClick={() => setEditing(true)}>
                        Change
                    </button>
                )}
            </span>
        );
    }

    return (
        <form onSubmit={save} className="secret-site-form">
            <input
                name="site"
                defaultValue={secret.site}
                aria-label="Hostname this code fills on"
                placeholder="github.com"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
            />
            <button className="button small" disabled={pending}>
                {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" className="text-button" onClick={() => setEditing(false)}>
                Cancel
            </button>
            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
        </form>
    );
}
