"use client";

import { useState } from "react";
import { fingerprintOf, fromBase64, readTexts, RECORD } from "@rewall/sdk";
import { explain } from "@/src/lib/errors";
import { ownerName, UNIVERSAL_RESOLVER, vaultClient, type Secret } from "@/src/lib/vault";
import { useIdentity } from "./identity";
import { useWorkspace } from "./dashboard-shell";
import { Glyph } from "./ui";

const ACKNOWLEDGED = "rewall.grant-understood";

type Kind = "grantees" | "subtrees" | "recovery";
type Candidate = { state: "empty" | "checking" | "missing" | "unset" | "ready"; fingerprint?: string };

const LISTS: { kind: Kind; title: string; empty: string }[] = [
    { kind: "grantees", title: "People", empty: "Nobody else" },
    { kind: "subtrees", title: "Teams", empty: "No teams" },
    { kind: "recovery", title: "Recovery", empty: "None" },
];

export function SecretAccess({ secret }: { secret: Secret }) {
    const { isOwnVault, ownName, refresh } = useWorkspace();
    // The opened secret, not the loaded vault, since finding one by name can reach somebody else's
    const mine = isOwnVault && secret.owner === ownName;
    const { write } = useIdentity();
    const [adding, setAdding] = useState<Kind | null>(null);
    const [candidate, setCandidate] = useState<Candidate>({ state: "empty" });
    const [pending, setPending] = useState("");
    const [error, setError] = useState("");
    const [understood, setUnderstood] = useState(() => {
        try {
            return localStorage.getItem(ACKNOWLEDGED) === "1";
        } catch {
            return true;
        }
    });

    // A name can only be granted once it publishes a key, so the input says which of the three cases it is
    async function look(value: string) {
        setCandidate({ state: "checking" });
        let name: string;
        try {
            name = ownerName(value);
        } catch {
            setCandidate({ state: "missing" });
            return;
        }
        try {
            const key = adding === "subtrees" ? RECORD.subtreePubkey : RECORD.pubkey;
            const records = await readTexts(vaultClient, UNIVERSAL_RESOLVER, name, [key]);
            if (!records[key]) setCandidate({ state: "unset" });
            else setCandidate({ state: "ready", fingerprint: fingerprintOf(fromBase64(records[key])) });
        } catch {
            setCandidate({ state: "missing" });
        }
    }

    async function grant(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const kind = adding!;
        const name = String(new FormData(event.currentTarget).get("name") || "").trim();
        setPending(`Granting ${name}…`);
        setError("");
        try {
            const target = ownerName(name);
            await write((client) =>
                kind === "subtrees"
                    ? client.grant(secret.name, target, { subtree: true })
                    : client.grant(secret.name, target),
            );
            try {
                localStorage.setItem(ACKNOWLEDGED, "1");
            } catch {}
            setUnderstood(true);
            setAdding(null);
            setCandidate({ state: "empty" });
            refresh();
        } catch (failure) {
            setError(explain(failure));
        } finally {
            setPending("");
        }
    }

    async function revoke(kind: Kind, name: string) {
        setPending(`Revoking ${name}…`);
        setError("");
        try {
            await write((client) =>
                client.revoke(secret.name, name, {
                    subtree: kind === "subtrees",
                    recovery: kind === "recovery",
                }),
            );
            refresh();
        } catch (failure) {
            setError(explain(failure));
        } finally {
            setPending("");
        }
    }

    return (
        <section className="secret-access">
            <h3>Who can read this</h3>

            {LISTS.map(({ kind, title, empty }) => (
                <div key={kind} className="access-group">
                    <div className="access-heading">
                        <span>{title}</span>
                        {mine && kind !== "recovery" && (
                            <button
                                className="text-button"
                                onClick={() => {
                                    setAdding(adding === kind ? null : kind);
                                    setCandidate({ state: "empty" });
                                }}
                            >
                                {adding === kind ? "Cancel" : "Add"}
                            </button>
                        )}
                    </div>

                    {secret[kind].length === 0 ? (
                        <p className="access-empty">{empty}</p>
                    ) : (
                        <ul className="access-list">
                            {secret[kind].map((name) => (
                                <li key={name}>
                                    <span className="mono">{name}</span>
                                    {mine && (
                                        <button
                                            className="icon-button"
                                            aria-label={`Revoke ${name}`}
                                            // SPEC section 5 needs one recovery entry, so the SDK refuses the last
                                            title={
                                                kind === "recovery" && secret.recovery.length === 1
                                                    ? "A secret needs one recovery holder, add another before removing this"
                                                    : undefined
                                            }
                                            disabled={
                                                Boolean(pending) || (kind === "recovery" && secret.recovery.length === 1)
                                            }
                                            onClick={() => void revoke(kind, name)}
                                        >
                                            <Glyph name="close" size={15} />
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}

                    {adding === kind && (
                        <form onSubmit={grant} className="access-form">
                            <input
                                name="name"
                                placeholder={kind === "subtrees" ? "team.eth" : "bob.eth"}
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                required
                                onChange={(event) => void look(event.target.value)}
                            />
                            <Resolution candidate={candidate} kind={kind} />
                            {!understood && candidate.state === "ready" && (
                                <p className="field-help">
                                    Granting hands over a copy. The transaction and the value are both in chain history,
                                    so this name can read today&apos;s value forever, even after you revoke.
                                </p>
                            )}
                            <button
                                className="button primary"
                                disabled={candidate.state !== "ready" || Boolean(pending)}
                            >
                                {pending || (understood ? "Grant" : "Grant, I understand")}
                            </button>
                        </form>
                    )}
                </div>
            ))}

            {pending && !adding && <p className="access-empty">{pending}</p>}
            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}

function Resolution({ candidate, kind }: { candidate: Candidate; kind: Kind }) {
    if (candidate.state === "empty") return null;
    if (candidate.state === "checking") return <p className="field-help">Looking it up…</p>;
    if (candidate.state === "missing") return <p className="field-help">No such name on Sepolia.</p>;

    if (candidate.state === "unset") {
        return (
            <p className="field-help">
                {kind === "subtrees"
                    ? "That name has not published a team key, so there is nothing to grant to yet."
                    : "That name has not set up Rewall yet. Send them the link and try again once they have."}
            </p>
        );
    }
    return (
        <p className="field-help">
            Key <span className="mono">{candidate.fingerprint}</span>. Check it with them out of band if it matters.
        </p>
    );
}
