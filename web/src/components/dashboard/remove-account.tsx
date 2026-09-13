"use client";

import { useState } from "react";
import { useIdentity } from "./identity";
import { useWorkspace } from "./dashboard-shell";
import { usePrivateData } from "./private-data";
import { explain } from "@/src/lib/errors";
import type { Secret } from "@/src/lib/vault";
import styles from "./remove-account.module.css";

// Turning 2FA off at a site and back on gives a new seed, and the old name has to be free to take it
export function RemoveAccount({ secret, onDone }: { secret: Secret; onDone: () => void }) {
    const { write } = useIdentity();
    const { refresh } = useWorkspace();
    const { accounts, lock } = usePrivateData();
    const [step, setStep] = useState("");
    const [error, setError] = useState("");

    const issuer = accounts[secret.name]?.issuer || secret.label;

    async function remove() {
        setStep("Waiting for your wallet…");
        setError("");
        try {
            await write(async (client) => {
                const hash = await client.forget(secret.name);
                setStep("Confirming on Sepolia…");
                return hash;
            });
            // Dropped by name, or re-adding the same one would show codes from the seed that was just removed
            lock(secret.name);
            refresh();
            onDone();
        } catch (failure) {
            setError(explain(failure));
            setStep("");
        }
    }

    return (
        <div className={styles.panel}>
            <p className={styles.lead}>
                <strong>{issuer}</strong> is stored at <span className="mono">{secret.name}</span>.
            </p>

            <p className="field-help">
                Removing it clears every record on that name and frees it, so the same name can hold the new seed the
                site gives you next.
            </p>

            <p className={styles.warning}>
                It does not unpublish anything. The old seed stays in the transaction that wrote it, readable by anyone
                ever granted it, so turn 2FA off at the site rather than treating this as deleting it.
            </p>

            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}

            <button className="button primary full-width" onClick={() => void remove()} disabled={Boolean(step)}>
                {step || "Remove this account"}
            </button>
            <button className="text-button" onClick={onDone} disabled={Boolean(step)}>
                Keep it
            </button>
        </div>
    );
}
