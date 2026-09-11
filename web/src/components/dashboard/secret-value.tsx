"use client";

import { useState } from "react";
import { wipe } from "@rewall/sdk";
import { explain } from "@/src/lib/errors";
import type { Secret } from "@/src/lib/vault";
import { useIdentity } from "./identity";
import { useWorkspace } from "./dashboard-shell";
import { CopyButton, Icon } from "./ui";

export function SecretValue({ secret }: { secret: Secret }) {
    const { decrypt, write, unlocked } = useIdentity();
    const { account, isOwnVault, refresh, setPanel } = useWorkspace();
    const [revealed, setRevealed] = useState<{ name: string; text: string } | null>(null);
    const [revealing, setRevealing] = useState(false);
    const [replacing, setReplacing] = useState(false);
    const [rotating, setRotating] = useState(false);
    const [error, setError] = useState("");

    // Tied to the secret and the session that produced it, so locking takes it off the screen by itself
    const value = unlocked && revealed?.name === secret.name ? revealed.text : "";

    async function reveal() {
        setRevealing(true);
        setError("");
        try {
            const bytes = await decrypt(secret.name);
            try {
                setRevealed({ name: secret.name, text: new TextDecoder().decode(bytes) });
            } finally {
                await wipe(bytes);
            }
        } catch (failure) {
            setError(explain(failure));
        } finally {
            setRevealing(false);
        }
    }

    if (!account) {
        return (
            <div className="sealed-value">
                <Icon name="lock" size={22} />
                <button className="text-button" onClick={() => setPanel("wallet")}>
                    Connect a wallet to reveal
                </button>
            </div>
        );
    }

    async function replace(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const next = String(new FormData(event.currentTarget).get("value"));
        setRotating(true);
        setError("");
        try {
            await write((client) => client.rotate(secret.name, new TextEncoder().encode(next)));
            setRevealed({ name: secret.name, text: next });
            setReplacing(false);
            refresh();
        } catch (failure) {
            setError(explain(failure));
        } finally {
            setRotating(false);
        }
    }

    return (
        <>
            {value ? (
                <div className="revealed-value">
                    <p className="mono">{value}</p>
                    <div className="revealed-actions">
                        <CopyButton value={value} label="Copy value" />
                        <button className="button small" onClick={() => setRevealed(null)}>
                            Hide
                        </button>
                    </div>
                </div>
            ) : (
                <div className="sealed-value">
                    <Icon name="lock" size={22} />
                    <button className="text-button" onClick={reveal} disabled={revealing}>
                        {revealing ? "Waiting for your wallet…" : "Reveal"}
                    </button>
                </div>
            )}
            {isOwnVault &&
                (replacing ? (
                    <form onSubmit={replace} className="panel-form replace-form">
                        <label htmlFor="replacement">New value</label>
                        <textarea id="replacement" name="value" rows={3} required autoFocus />
                        <div className="revealed-actions">
                            <button className="button primary" disabled={rotating}>
                                {rotating ? "Rotating…" : "Replace"}
                            </button>
                            <button type="button" className="button" onClick={() => setReplacing(false)}>
                                Cancel
                            </button>
                        </div>
                        <p className="field-help">
                            Replacing re-encrypts under a new key for everyone still granted. Anyone who could read the
                            old value can still read it from chain history.
                        </p>
                    </form>
                ) : (
                    <button className="text-button replace-open" onClick={() => setReplacing(true)}>
                        Replace value
                    </button>
                ))}
            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
        </>
    );
}
