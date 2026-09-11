"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fromBase64, readTexts, RECORD, splitNames } from "@rewall/sdk";
import { explain } from "@/src/lib/errors";
import { ownerName, UNIVERSAL_RESOLVER, vaultClient } from "@/src/lib/vault";
import { ownsName } from "@/src/lib/account";
import { useIdentity } from "./identity";
import { useWorkspace } from "./dashboard-shell";
import { FadeIn } from "./amicro";
import { CopyButton } from "./ui";

type Policy = { names: string[]; threshold: number; approvals: string[] };

async function readPolicy(name: string, forFingerprint: string): Promise<Policy> {
    const published = await readTexts(vaultClient, UNIVERSAL_RESOLVER, name, [
        RECORD.guardians,
        RECORD.recoveryThreshold,
    ]);
    const names = splitNames(published[RECORD.guardians]);
    const threshold = Number(published[RECORD.recoveryThreshold] || 0);
    if (!names.length) return { names, threshold, approvals: [] };

    const key = RECORD.reshare(forFingerprint);
    const empty: Record<string, string> = {};
    const found = await Promise.all(
        names.map(async (guardian) => {
            const records = await readTexts(vaultClient, UNIVERSAL_RESOLVER, guardian, [key]).catch(() => empty);
            return records[key] ? guardian : "";
        }),
    );
    return { names, threshold, approvals: found.filter(Boolean) };
}

export function RecoveryPage() {
    const params = useSearchParams();
    const { account, setPanel } = useWorkspace();
    const { unlock, unlocked, fingerprint, publicKey, write } = useIdentity();

    const approveFor = params.get("approve") || "";
    const [lost, setLost] = useState(approveFor);
    const [policy, setPolicy] = useState<Policy | null>(null);
    const [approving, setApproving] = useState("");
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const [recovered, setRecovered] = useState("");

    // Approvals live on the guardians' own names, so the only way to know is to go and look
    useEffect(() => {
        let active = true;
        if (!lost || !unlocked || !fingerprint) return;

        const look = () =>
            readPolicy(lost, fingerprint)
                .then((next) => active && setPolicy(next))
                .catch(() => active && setPolicy(null));

        void look();
        const timer = setInterval(look, 12000);
        return () => {
            active = false;
            clearInterval(timer);
        };
    }, [lost, unlocked, fingerprint]);

    async function approve() {
        setApproving("Working out which guardian you are…");
        setError("");
        try {
            const requester = params.get("key");
            if (!requester) throw new Error("This link is missing the replacement key.");

            // Keyed by identity, so the name to publish under is the one that published this key, and
            // owning a name is not enough because a parent owns its subnames too
            const target = ownerName(approveFor);
            const listed = await readTexts(vaultClient, UNIVERSAL_RESOLVER, target, [RECORD.guardians]);
            const matches = await Promise.all(
                splitNames(listed[RECORD.guardians]).map(async (name) => {
                    const published = await readTexts(vaultClient, UNIVERSAL_RESOLVER, name, [RECORD.pubkey]).catch(
                        () => ({}) as Record<string, string>,
                    );
                    if (published[RECORD.pubkey] !== publicKey) return "";
                    return (await ownsName(name, account)) ? name : "";
                }),
            );
            const mine = matches.find(Boolean);
            if (!mine) {
                throw new Error(
                    "This wallet is not a guardian of that name, or the name holding its key belongs to somebody else.",
                );
            }

            setApproving("Waiting for your wallet…");
            await write((client) => client.guardians.approve(target, fromBase64(requester), mine));
            setApproving("Approved, your share is published");
        } catch (failure) {
            setError(explain(failure));
            setApproving("");
        }
    }

    async function recover() {
        setStatus("Collecting approvals…");
        setError("");
        try {
            const identity = await write(async (client) => {
                const shares = await client.guardians.collect(ownerName(lost));
                setStatus("Rebuilding the recovery key…");
                return client.guardians.recover(shares, ownerName(lost));
            });
            setRecovered(identity.fingerprint);
            setStatus("");
        } catch (failure) {
            setError(explain(failure));
            setStatus("");
        }
    }

    if (!account) {
        return (
            <FadeIn className="recovery-page">
                <div className="page-heading">
                    <h1>Recovery</h1>
                </div>
                <p className="field-help">
                    Connect the wallet you want to recover into, or the one a friend named as a guardian.
                </p>
                <button className="button primary" onClick={() => setPanel("wallet")}>
                    Connect a wallet
                </button>
            </FadeIn>
        );
    }

    if (!unlocked) {
        return (
            <FadeIn className="recovery-page">
                <div className="page-heading">
                    <h1>Recovery</h1>
                </div>
                <p className="field-help">
                    Recovery works on your Rewall key, so this wallet has to derive it first. One signature.
                </p>
                <button className="button primary" onClick={() => void unlock()}>
                    Unlock to continue
                </button>
            </FadeIn>
        );
    }

    const guardianLink = `${origin()}/dashboard/recovery?approve=${encodeURIComponent(lost)}&key=${encodeURIComponent(publicKey)}`;

    return (
        <FadeIn className="recovery-page">
            <div className="page-heading">
                <h1>Recovery</h1>
            </div>

            {approveFor && (
                <section className="recovery-block">
                    <h2>A guardian request</h2>
                    <p>
                        Somebody is recovering <span className="mono">{approveFor}</span> and named you as a guardian.
                        Approving re-seals your share to their new key and publishes it on your own name.
                    </p>
                    <p className="field-help">
                        Your share is already encrypted to them, so publishing it tells nobody else anything. Only do
                        this if you are sure the request is theirs.
                    </p>
                    <button className="button primary" onClick={() => void approve()} disabled={Boolean(approving)}>
                        {approving || "Approve this recovery"}
                    </button>
                </section>
            )}

            <section className="recovery-block">
                <h2>Recover a vault</h2>
                <label htmlFor="lost-name">The ENS name you are recovering</label>
                <input
                    id="lost-name"
                    value={lost}
                    onChange={(event) => setLost(event.target.value)}
                    placeholder="alice.eth"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                />

                {policy && policy.names.length === 0 && (
                    <p className="field-help">That name has published no guardians, so there is nothing to recover.</p>
                )}

                {policy && policy.names.length > 0 && (
                    <>
                        <p className="recovery-count mono">
                            {policy.approvals.length} of {policy.threshold} approved
                        </p>
                        <ul className="access-list">
                            {policy.names.map((guardian) => (
                                <li key={guardian}>
                                    <span className="mono">{guardian}</span>
                                    <span className={policy.approvals.includes(guardian) ? "" : "muted"}>
                                        {policy.approvals.includes(guardian) ? "Approved" : "Waiting"}
                                    </span>
                                </li>
                            ))}
                        </ul>

                        <div className="detail-block">
                            <span className="muted">Send this to your guardians</span>
                            <p className="field-help">
                                It carries the key they seal your share to, which is public and safe to send.
                            </p>
                            <CopyButton value={guardianLink} label="Copy the guardian link" />
                        </div>

                        <button
                            className="button primary"
                            onClick={() => void recover()}
                            disabled={policy.approvals.length < policy.threshold || Boolean(status)}
                        >
                            {status ||
                                (policy.approvals.length < policy.threshold
                                    ? `Waiting for ${policy.threshold - policy.approvals.length} more`
                                    : "Recover this vault")}
                        </button>
                    </>
                )}

                {recovered && (
                    <div className="notice">
                        <p>
                            Rebuilt the recovery key <span className="mono">{recovered}</span>. It opens every secret
                            the lost wallet could. Publish a new identity key and rotate them all.
                        </p>
                    </div>
                )}

                {error && (
                    <p className="form-error" role="alert">
                        {error}
                    </p>
                )}
            </section>
        </FadeIn>
    );
}

const origin = () => (typeof window === "undefined" ? "" : window.location.origin);
