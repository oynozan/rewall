"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { fromBase64, readTexts, RECORD, splitNames } from "@rewall/sdk";
import { explain } from "@/src/lib/errors";
import { ownerName, UNIVERSAL_RESOLVER, vaultClient } from "@/src/lib/vault";
import { ownsName } from "@/src/lib/account";
import { useIdentity } from "./identity";
import { useWorkspace } from "./dashboard-shell";
import { FadeIn } from "./amicro";
import { CopyButton, Glyph, Icon, SegmentedProgress } from "./ui";

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

            // Match the published key because owning a parent name does not make it a guardian
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

    const guardianRequest = Boolean(approveFor);
    const approved = Boolean(policy?.threshold) && (policy?.approvals.length ?? 0) >= (policy?.threshold ?? 0);
    const stage = recovered ? 3 : !account || !unlocked ? 0 : approved ? 2 : 1;
    const guardianLink = `${origin()}/dashboard/recovery?approve=${encodeURIComponent(lost)}&key=${encodeURIComponent(publicKey)}`;

    return (
        <RecoveryLayout stage={stage} guardianRequest={guardianRequest}>
            {!account || !unlocked ? (
                <section className="recovery-card">
                    <header>
                        <Icon name={guardianRequest ? "shield" : "lock"} size={20} />
                        <h2>{guardianRequest ? "Approve a recovery" : "Recover a vault"}</h2>
                    </header>
                    <div className="recovery-card-body">
                        {approveFor && <p className="recovery-name mono">{approveFor}</p>}
                        <p className="recovery-description">
                            {!account
                                ? guardianRequest
                                    ? "Connect the wallet registered as a guardian for this vault."
                                    : "Connect the replacement wallet you want to recover access with."
                                : "Unlock this wallet with one signature to continue."}
                        </p>
                        <button
                            className="button primary"
                            onClick={() =>
                                !account
                                    ? setPanel("wallet")
                                    : void unlock().catch((failure) => setError(explain(failure)))
                            }
                        >
                            {!account ? "Connect a wallet" : "Unlock to continue"}
                            <Glyph name="chevron_right" size={16} />
                        </button>
                        {error && (
                            <p className="form-error" role="alert">
                                {error}
                            </p>
                        )}
                    </div>
                </section>
            ) : guardianRequest ? (
                <section className="recovery-card">
                    <header>
                        <Icon name="shield" size={20} />
                        <h2>Guardian request</h2>
                    </header>
                    <div className="recovery-card-body">
                        <p className="recovery-name mono">{approveFor}</p>
                        <p className="recovery-description">
                            Approve only after confirming the request with the owner. Your encrypted recovery share will
                            be published for their replacement wallet.
                        </p>
                        <button className="button primary" onClick={() => void approve()} disabled={Boolean(approving)}>
                            Approve this recovery
                        </button>
                        {approving && (
                            <p className="field-help" role="status">
                                {approving}
                            </p>
                        )}
                        {error && (
                            <p className="form-error" role="alert">
                                {error}
                            </p>
                        )}
                    </div>
                </section>
            ) : (
                <section className="recovery-card">
                    <header>
                        <Icon name="shield" size={20} />
                        <h2>Recover a vault</h2>
                    </header>
                    <div className="recovery-card-body">
                        <label className="recovery-field" htmlFor="lost-name">
                            <span>Vault ENS name</span>
                            <input
                                id="lost-name"
                                value={lost}
                                onChange={(event) => setLost(event.target.value)}
                                placeholder="alice.eth"
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                            />
                        </label>
                        {policy && !policy.names.length && (
                            <p className="field-help">No guardians are registered for this vault.</p>
                        )}
                        {policy && policy.names.length > 0 && (
                            <>
                                <div className="recovery-progress">
                                    <div>
                                        <h3>Guardian approvals</h3>
                                        <span className="mono">
                                            {policy.approvals.length} / {policy.threshold}
                                        </span>
                                    </div>
                                    <SegmentedProgress
                                        value={policy.approvals.length}
                                        max={policy.threshold}
                                        label="Guardian approvals"
                                    />
                                </div>
                                <ul className="recovery-guardians">
                                    {policy.names.map((guardian) => (
                                        <li key={guardian}>
                                            <span className="mono">{guardian}</span>
                                            <span
                                                className={
                                                    policy.approvals.includes(guardian)
                                                        ? "guardian-state approved"
                                                        : "guardian-state"
                                                }
                                            >
                                                {policy.approvals.includes(guardian) ? "Approved" : "Waiting"}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                                <div className="recovery-share">
                                    <div>
                                        <h3>Request approval</h3>
                                        <p>Share this link with your guardians.</p>
                                    </div>
                                    <CopyButton value={guardianLink} label="Copy the guardian link" />
                                </div>
                                <div className="recovery-submit">
                                    <button
                                        className="button primary"
                                        onClick={() => void recover()}
                                        disabled={!approved || Boolean(status) || Boolean(recovered)}
                                    >
                                        Recover this vault
                                    </button>
                                    <span className="field-help" role="status">
                                        {status ||
                                            (!approved
                                                ? `Waiting for ${policy.threshold - policy.approvals.length} more`
                                                : recovered
                                                  ? "Recovery complete"
                                                  : "Ready to recover")}
                                    </span>
                                </div>
                            </>
                        )}
                        {recovered && (
                            <div className="recovery-result" role="status">
                                <h3>Access recovered</h3>
                                <p className="mono">{recovered}</p>
                                <p>
                                    Publish a new identity key and rotate your secrets to finish securing this wallet.
                                </p>
                            </div>
                        )}
                        {error && (
                            <p className="form-error" role="alert">
                                {error}
                            </p>
                        )}
                    </div>
                </section>
            )}
        </RecoveryLayout>
    );
}

function RecoveryLayout({
    children,
    stage,
    guardianRequest,
}: {
    children: ReactNode;
    stage: number;
    guardianRequest: boolean;
}) {
    const steps = guardianRequest
        ? [
              ["Connect your wallet", "Use the wallet named as a guardian."],
              ["Verify the request", "Confirm it with the owner directly."],
              ["Approve recovery", "Send your encrypted recovery share."],
          ]
        : [
              ["Connect a replacement wallet", "Unlock it to create a new recovery request."],
              ["Ask your guardians", "Share the request link and wait for approvals."],
              ["Recover access", "Restore access once enough guardians approve."],
          ];
    return (
        <FadeIn className="recovery-page secrets-page">
            <div className="page-heading">
                <h1>Recovery</h1>
            </div>
            <div className="recovery-layout">
                {children}
                <aside className="recovery-guide" aria-label="Recovery steps">
                    <h2>{guardianRequest ? "Approving a request" : "How recovery works"}</h2>
                    <ol>
                        {steps.map(([title, description], index) => (
                            <li
                                key={title}
                                className={index === stage ? "is-current" : index < stage ? "is-complete" : ""}
                                aria-current={index === stage ? "step" : undefined}
                            >
                                <span className="recovery-step-number mono">{String(index + 1).padStart(2, "0")}</span>
                                <div>
                                    <h3>{title}</h3>
                                    <p>{description}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                </aside>
            </div>
        </FadeIn>
    );
}

const origin = () => (typeof window === "undefined" ? "" : window.location.origin);
