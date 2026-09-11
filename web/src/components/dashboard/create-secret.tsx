"use client";

import { useEffect, useState } from "react";
import { guardianRecoveryEntry, NAMESPACE_LABEL, RECORD, readTexts } from "@rewall/sdk";
import { explain } from "@/src/lib/errors";
import { ownerName, TYPE_LABELS, UNIVERSAL_RESOLVER, vaultClient } from "@/src/lib/vault";
import { useIdentity } from "./identity";
import { useWorkspace } from "./dashboard-shell";

const TYPES = Object.entries(TYPE_LABELS).filter(([type]) => type !== "receipt");

type Entry = { value: string; type: string; recovery: string; grantees: string[] };

// A secret cannot exist without a recovery holder, and the setup wizard publishes one on the owner's
// own name, so the common case needs no field at all
function useOwnRecovery(ownName: string) {
    const [answer, setAnswer] = useState<{ name: string; has: boolean } | null>(null);

    useEffect(() => {
        let active = true;
        if (!ownName) return;
        void readTexts(vaultClient, UNIVERSAL_RESOLVER, ownName, [RECORD.recoveryPubkey])
            .then((records) => {
                if (active) setAnswer({ name: ownName, has: Boolean(records[RECORD.recoveryPubkey]) });
            })
            .catch(() => {
                if (active) setAnswer({ name: ownName, has: false });
            });
        return () => {
            active = false;
        };
    }, [ownName]);

    return answer?.name === ownName ? answer.has : null;
}

export function CreateSecret({ onDone }: { onDone: () => void }) {
    const { ownName, refresh } = useWorkspace();
    const { write } = useIdentity();
    const [label, setLabel] = useState("");
    const [error, setError] = useState("");
    const [step, setStep] = useState("");
    const [advanced, setAdvanced] = useState(false);
    const [conflict, setConflict] = useState<Entry | null>(null);

    const namespace = ownName ? `${NAMESPACE_LABEL}.${ownName}` : "";
    const target = label ? `${label}.${namespace}` : "";
    const ownRecovery = useOwnRecovery(ownName);

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
        const typed = String(form.get("recovery") || "").trim();
        const entry: Entry = {
            value: String(form.get("value")),
            type: String(form.get("type")),
            recovery: typed || (ownRecovery ? guardianRecoveryEntry(ownName) : ""),
            grantees: String(form.get("grantees") || "")
                .split(",")
                .map((name) => name.trim())
                .filter(Boolean),
        };

        if (!entry.recovery) {
            setError("Name someone who can recover this, or set up a recovery phrase first.");
            return;
        }

        try {
            ownerName(target);
            if (typed) ownerName(typed);
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
                Set up your vault before storing a secret. The registry has to agree the name is yours.
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

            <label htmlFor="secret-type">Type</label>
            <select id="secret-type" name="type" defaultValue="generic" className="create-select">
                {TYPES.map(([type, name]) => (
                    <option key={type} value={type}>
                        {name}
                    </option>
                ))}
            </select>

            <button
                type="button"
                className="text-button"
                onClick={() => setAdvanced(!advanced)}
                aria-expanded={advanced}
            >
                {advanced ? "Hide options" : "Recovery and sharing"}
            </button>

            <div hidden={!advanced}>
                <label htmlFor="secret-recovery">Recovery name</label>
                <input
                    id="secret-recovery"
                    name="recovery"
                    placeholder={ownRecovery ? "Your recovery phrase" : "vault.eth"}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                />
                <p className="field-help">
                    {ownRecovery === null
                        ? "Checking what can recover this vault…"
                        : ownRecovery
                          ? "Left empty, your recovery phrase is used. Lose your wallet and those 24 words are the way back."
                          : "Required, because losing this wallet would otherwise strand everything stored here."}
                </p>

                <label htmlFor="secret-grantees">Share with</label>
                <input
                    id="secret-grantees"
                    name="grantees"
                    placeholder="bob.eth, ci.bob.eth"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                />
                <p className="field-help">
                    Granting hands over a copy. Anyone added can read this version from chain history forever, even
                    after you revoke them.
                </p>
            </div>

            <button className="button primary full-width" disabled={Boolean(step)}>
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
