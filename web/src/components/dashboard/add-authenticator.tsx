"use client";

import { useState } from "react";
import { guardianRecoveryEntry, NAMESPACE_LABEL, normalizeSite } from "@rewall/sdk";
import { describeOtpUri, type OtpAccount } from "@rewall/sdk/2fa";
import { explain } from "@/src/lib/errors";
import { ownerName, TYPE_LABELS, type Secret } from "@/src/lib/vault";
import { useIdentity } from "./identity";
import { useWorkspace } from "./dashboard-shell";
import { useOwnRecovery } from "./create-secret";
import styles from "./add-authenticator.module.css";

type Entry = { uri: string; site: string; recovery: string };
type Decoded = { state: "empty" } | { state: "bad"; message: string } | { state: "ready"; account: OtpAccount };

// The SDK's validation messages are already written for a reader, unlike an opaque chain failure
const reason = (failure: unknown) => (failure instanceof Error && failure.message ? failure.message : explain(failure));

const slug = (value: string) =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");

const named = (secret: Secret) => TYPE_LABELS[secret.type as keyof typeof TYPE_LABELS] ?? secret.type;

export function AddAuthenticator({ onDone }: { onDone: () => void }) {
    const { ownName, vault, refresh } = useWorkspace();
    const { write } = useIdentity();
    const [uri, setUri] = useState("");
    const [decoded, setDecoded] = useState<Decoded>({ state: "empty" });
    const [label, setLabel] = useState("");
    const [site, setSite] = useState("");
    const [siteError, setSiteError] = useState("");
    const [error, setError] = useState("");
    const [step, setStep] = useState("");
    const [advanced, setAdvanced] = useState(false);
    const [conflict, setConflict] = useState<Entry | null>(null);

    const namespace = ownName ? `${NAMESPACE_LABEL}.${ownName}` : "";
    const target = label ? `${label}.${namespace}` : "";
    const ownRecovery = useOwnRecovery(ownName);

    // Every secret type shares one namespace, so an authenticator can land on an API key of the same name
    const existing = target ? vault?.secrets.find((secret) => secret.name === target) : undefined;

    // Reads the display fields without keeping the seed, which is why it can run on every keystroke
    function read(value: string) {
        setUri(value);
        setError("");
        if (!value.trim()) return setDecoded({ state: "empty" });

        try {
            const account = describeOtpUri(value.trim());
            setDecoded({ state: "ready", account });
            if (!label) setLabel(slug(account.issuer || account.label || "authenticator"));
        } catch (failure) {
            setDecoded({ state: "bad", message: reason(failure) });
        }
    }

    // Settled on blur rather than per keystroke, so a half typed hostname is not called wrong while it is typed
    function settleSite(value: string) {
        if (!value.trim()) {
            setSite("");
            return setSiteError("");
        }
        try {
            setSite(normalizeSite(value));
            setSiteError("");
        } catch (failure) {
            setSite("");
            setSiteError(reason(failure));
        }
    }

    async function store(entry: Entry, overwrite: boolean) {
        setStep("Encrypting and sealing…");
        setError("");
        try {
            await write(async (client) => {
                setStep("Waiting for your wallet…");
                const hash = await client.create(target, new TextEncoder().encode(entry.uri), {
                    type: "totp",
                    site: entry.site,
                    recovery: [entry.recovery],
                    overwrite,
                });
                setStep("Confirming on Sepolia…");
                return hash;
            });
            refresh();
            onDone();
        } catch (failure) {
            if (failure instanceof Error && failure.name === "SecretExistsError") setConflict(entry);
            else setError(explain(failure));
        } finally {
            setStep("");
        }
    }

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (step) return;
        setError("");
        setConflict(null);

        if (decoded.state !== "ready") {
            setError("Paste the setup key your account shows when it offers a QR code.");
            return;
        }

        // Read from the field rather than state, so a hostname typed and never blurred is still normalized
        const typedSite = String(new FormData(event.currentTarget).get("site") || "");
        let settled: string;
        try {
            settled = normalizeSite(typedSite);
            setSite(settled);
            setSiteError("");
        } catch (failure) {
            setSiteError(reason(failure));
            return;
        }

        const typed = String(new FormData(event.currentTarget).get("recovery") || "").trim();
        const entry: Entry = {
            uri: uri.trim(),
            site: settled,
            recovery: typed || (ownRecovery ? guardianRecoveryEntry(ownName) : ""),
        };

        if (!entry.recovery) {
            setError("Name someone who can recover this, or set up a recovery phrase first.");
            return;
        }

        try {
            ownerName(target);
            if (typed) ownerName(typed);
        } catch {
            setError("Every name has to be a complete ENS name ending in .eth.");
            return;
        }
        await store(entry, false);
    }

    if (!ownName) {
        return (
            <p className="field-help">
                Set up your vault before adding an account. The registry has to agree the name is yours.
            </p>
        );
    }

    return (
        <form onSubmit={submit} className="panel-form">
            <label htmlFor="otp-uri">Setup key</label>
            <textarea
                id="otp-uri"
                rows={3}
                value={uri}
                onChange={(event) => read(event.target.value)}
                placeholder="otpauth://totp/GitHub:you?secret=…"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
            />
            {decoded.state === "ready" ? (
                <p className={styles.decoded}>
                    <span className={styles.issuer}>
                        {decoded.account.issuer || decoded.account.label || "Account"}
                    </span>
                    <span className={styles.shape}>
                        {decoded.account.digits} digits · {decoded.account.period}s
                    </span>
                </p>
            ) : decoded.state === "bad" ? (
                <p className={styles.problem} role="alert">
                    {decoded.message}
                </p>
            ) : (
                <p className={styles.hint}>Shown behind the “can’t scan the code?” link when you turn 2FA on.</p>
            )}

            <label htmlFor="otp-site">Site</label>
            <input
                id="otp-site"
                name="site"
                onBlur={(event) => settleSite(event.target.value)}
                placeholder="github.com"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
            />
            {siteError ? (
                <p className={styles.problem} role="alert">
                    {siteError}
                </p>
            ) : (
                <p className={styles.hint}>
                    {site ? `Fills only on ${site}.` : "Matched exactly, so a different subdomain is a different site."}
                </p>
            )}

            <label htmlFor="otp-label">Name</label>
            <input
                id="otp-label"
                value={label}
                onChange={(event) => setLabel(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="github"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
            />
            {existing ? (
                <p className={styles.collision} role="alert">
                    {existing.type === "totp"
                        ? "An authenticator already lives at this name. Adding replaces it."
                        : `Your ${named(existing)} lives at this name. Adding an authenticator here replaces it, and that value is gone from the current record.`}
                </p>
            ) : (
                <p className={`field-help create-target ${styles.hint}`}>{target || `<name>.${namespace}`}</p>
            )}

            <button
                type="button"
                className={`text-button ${styles.disclosure} ${advanced ? styles.open : ""}`}
                onClick={() => setAdvanced(!advanced)}
                aria-expanded={advanced}
            >
                <span className={styles.caret} aria-hidden="true">
                    ▶
                </span>
                Recovery options
            </button>

            <div hidden={!advanced}>
                <label htmlFor="otp-recovery">Recovery name</label>
                <input
                    id="otp-recovery"
                    name="recovery"
                    placeholder={ownRecovery ? "Your recovery phrase" : "vault.eth"}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                />
                <p className={styles.hint}>
                    {ownRecovery === null
                        ? "Checking what can recover this vault…"
                        : ownRecovery
                          ? "Left empty, your recovery phrase is used."
                          : "Required, because losing this wallet would otherwise strand this account."}
                </p>
            </div>

            <button className="button primary full-width" disabled={Boolean(step)}>
                {step || "Store account"}
            </button>

            {conflict && (
                <div className="form-error" role="alert">
                    <p>
                        {existing
                            ? `Replacing your ${named(existing)} puts a new seed under a new key.`
                            : "Something already lives at this name. Replacing it puts a new seed under a new key."}
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
