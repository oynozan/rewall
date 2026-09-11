"use client";

import { useState } from "react";
import { NAMESPACE_LABEL } from "@rewall/sdk";
import { explain } from "@/src/lib/errors";
import { ownerName, TYPE_LABELS } from "@/src/lib/vault";
import { useIdentity } from "./identity";
import { useWorkspace } from "./dashboard-shell";

const TYPES = Object.entries(TYPE_LABELS).filter(([type]) => type !== "receipt");

type Entry = { value: string; type: string; recovery: string; grantees: string[] };

export function CreateSecret({ onDone }: { onDone: () => void }) {
    const { ownName, refresh } = useWorkspace();
    const { write } = useIdentity();
    const [label, setLabel] = useState("");
    const [error, setError] = useState("");
    const [step, setStep] = useState("");
    const [conflict, setConflict] = useState<Entry | null>(null);

    const namespace = ownName ? `${NAMESPACE_LABEL}.${ownName}` : "";
    const target = label ? `${label}.${namespace}` : "";

    async function store(entry: Entry, overwrite: boolean) {
        setStep("Encrypting and sealing…");
        setError("");
        try {
            await write(async (client) => {
                setStep("Waiting for your wallet…");
                const hash = await client.create(target, new TextEncoder().encode(entry.value), {
                    type: entry.type,
                    recovery: [entry.recovery],
                    grantees: entry.grantees,
                    overwrite,
                });
                setStep("Confirming on Sepolia…");
                return hash;
            });
            refresh();
            onDone();
        } catch (failure) {
            // Replacing a live secret is a decision, not an error, so it is offered rather than refused
            if (failure instanceof Error && failure.name === "SecretExistsError") setConflict(entry);
            else setError(explain(failure));
        } finally {
            setStep("");
        }
    }

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setConflict(null);

        const form = new FormData(event.currentTarget);
        const entry: Entry = {
            value: String(form.get("value")),
            type: String(form.get("type")),
            recovery: String(form.get("recovery") || "").trim(),
            grantees: String(form.get("grantees") || "")
                .split(",")
                .map((name) => name.trim())
                .filter(Boolean),
        };

        try {
            ownerName(target);
            ownerName(entry.recovery);
            entry.grantees.forEach((name) => ownerName(name));
        } catch {
            setError("Every name has to be a complete ENS name ending in .eth.");
            return;
        }
        await store(entry, false);
    }

    if (!ownName) {
        return (
            <p className="field-help">
                Open a vault you own before storing a secret. The registry has to agree the name is yours.
            </p>
        );
    }

    return (
        <form onSubmit={submit} className="panel-form">
            <label htmlFor="secret-label">Name</label>
            <input
                id="secret-label"
                name="label"
                value={label}
                onChange={(event) => setLabel(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="stripe-key"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
            />
            <p className="field-help create-target">{target || `<name>.${namespace}`}</p>

            <label htmlFor="secret-type">Type</label>
            <select id="secret-type" name="type" defaultValue="apikey" className="create-select">
                {TYPES.map(([type, name]) => (
                    <option key={type} value={type}>
                        {name}
                    </option>
                ))}
            </select>

            <label htmlFor="secret-value">Value</label>
            <textarea
                id="secret-value"
                name="value"
                rows={3}
                placeholder="sk_live_…"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
            />

            <label htmlFor="secret-recovery">Recovery name</label>
            <input
                id="secret-recovery"
                name="recovery"
                placeholder="vault.eth"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
            />
            <p className="field-help">
                Required. Lose this wallet and the recovery name is the only way back to anything stored here.
            </p>

            <label htmlFor="secret-grantees">Share with (optional)</label>
            <input
                id="secret-grantees"
                name="grantees"
                placeholder="bob.eth, ci.bob.eth"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
            />

            <button className="button primary" disabled={Boolean(step)}>
                {step || "Store secret"}
            </button>

            {conflict && (
                <div className="form-error" role="alert">
                    <p>A secret already lives at this name. Replacing it puts a new value under a new key.</p>
                    <p className="field-help">
                        Anyone granted the old one can still read it from chain history. Rotate the real credential too.
                    </p>
                    <button type="button" className="button" onClick={() => void store(conflict, true)}>
                        Replace it
                    </button>
                </div>
            )}

            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
        </form>
    );
}
