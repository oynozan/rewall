"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { guardianRecoveryEntry, NAMESPACE_LABEL, normalizeSite } from "@rewall/sdk";
import { completeOtpKey, describeOtpUri, type OtpAccount } from "@rewall/sdk/2fa";
import { explain } from "@/src/lib/errors";
import { ownerName, TYPE_LABELS, type Secret } from "@/src/lib/vault";
import { useIdentity } from "./identity";
import { useWorkspace } from "./dashboard-shell";
import { useOwnRecovery } from "./create-secret";
import styles from "./add-authenticator.module.css";

type Entry = { uri: string; site: string; recovery: string; target: string };
type Decoded = { state: "empty" } | { state: "bad"; message: string } | { state: "ready"; account: OtpAccount };

// The SDK's validation messages are already written for a reader, unlike an opaque chain failure
const reason = (failure: unknown) => (failure instanceof Error && failure.message ? failure.message : explain(failure));

const slug = (value: string) =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");

// Keeps a trailing dash while it is still being typed, so the field does not fight the keyboard
const typing = (value: string) =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+/, "");

// One issuer can hold several accounts, so the account name is what separates a second GitHub from the first
function suggest(account: OtpAccount, taken: (label: string) => boolean): string {
    const base = slug(account.issuer) || slug(account.label) || "authenticator";
    if (!taken(base)) return base;

    const specific = slug(`${account.issuer}-${account.label}`);
    return specific && specific !== base && !taken(specific) ? specific : base;
}

const named = (secret: Secret) => TYPE_LABELS[secret.type as keyof typeof TYPE_LABELS] ?? secret.type;

// A hostname off the URL is whatever opened this page, so it is shown rather than trusted
const observed = (value: string | null) => {
    try {
        return value ? normalizeSite(value) : "";
    } catch {
        return "";
    }
};

export function AddAuthenticator({ onDone }: { onDone: () => void }) {
    const { ownName, vault, refresh } = useWorkspace();
    const { write } = useIdentity();
    const params = useSearchParams();

    // The extension hands the hostname over because it watched the tab, and this is the field people get wrong
    const [captured] = useState(() => observed(params.get("site")));

    // A scanned setup code is claimed by id, because the seed itself must never appear in a URL
    const [captureId] = useState(() => params.get("capture") || "");
    const siteField = useRef<HTMLInputElement>(null);
    const [uri, setUri] = useState("");
    const [label, setLabel] = useState("");
    const [labelEdited, setLabelEdited] = useState(false);
    const [site, setSite] = useState(captured);
    const [siteError, setSiteError] = useState("");
    const [error, setError] = useState("");
    const [step, setStep] = useState("");
    const [advanced, setAdvanced] = useState(false);
    const [conflict, setConflict] = useState<Entry | null>(null);

    // What actually gets stored, which is the pasted URI or the one completed from a bare key
    const effective = useMemo(() => completeOtpKey(uri, site), [uri, site]);
    const filledIn = Boolean(uri.trim()) && effective !== uri.trim();

    const decoded = useMemo<Decoded>(() => {
        if (!effective) return { state: "empty" };
        try {
            return { state: "ready", account: describeOtpUri(effective) };
        } catch (failure) {
            return { state: "bad", message: reason(failure) };
        }
    }, [effective]);

    const namespace = ownName ? `${NAMESPACE_LABEL}.${ownName}` : "";
    const taken = (name: string) => Boolean(vault?.secrets.some((secret) => secret.label === name));

    // Derived during render rather than on paste, so a vault that arrives late still moves the suggestion
    const shown = labelEdited ? label : decoded.state === "ready" ? suggest(decoded.account, taken) : "";

    // What the field shows can still be mid-edit, so the name that gets written is the settled one
    const settledLabel = slug(shown);
    const target = settledLabel ? `${settledLabel}.${namespace}` : "";
    const ownRecovery = useOwnRecovery(ownName);

    // Every secret type shares one namespace, so an authenticator can land on an API key of the same name
    const existing = target ? vault?.secrets.find((secret) => secret.name === target) : undefined;

    // Claimed once even though development remounts every effect, because the id is good for exactly one claim
    const claimed = useRef(false);

    // The extension answers on this page rather than in the link, and the id it was given is good once
    useEffect(() => {
        if (!captureId || claimed.current) return;
        claimed.current = true;

        const listen = (event: MessageEvent) => {
            if (event.source !== window || event.origin !== window.location.origin) return;
            const message = event.data as { type?: string; uri?: string; site?: string; error?: string } | undefined;
            if (message?.type !== "rewall:capture") return;

            if (!message.uri) {
                setError(message.error || "That setup code is no longer held. Scan it again from the extension.");
                return;
            }

            read(message.uri);
            if (message.site && siteField.current) {
                siteField.current.value = message.site;
                settleSite(message.site);
            }
        };

        window.addEventListener("message", listen);
        window.postMessage({ type: "rewall:capture-claim", id: captureId }, window.location.origin);
        return () => window.removeEventListener("message", listen);
        // Claimed once for the id in the link, and the handlers it calls are stable for that render
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [captureId]);

    // Reads the display fields without keeping the seed, which is why it can run on every keystroke
    function read(value: string) {
        setUri(value);
        setError("");
        setConflict(null);
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

                // The name the conflict was raised for, not whatever the field says by the time Replace it is pressed
                const hash = await client.create(entry.target, new TextEncoder().encode(entry.uri), {
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
            uri: effective,
            site: settled,
            recovery: typed || (ownRecovery ? guardianRecoveryEntry(ownName) : ""),
            target,
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
            {filledIn && (
                <p className={styles.filled}>
                    <span>A key on its own, so it is stored as</span>
                    <code>{effective}</code>
                </p>
            )}

            <label htmlFor="otp-site">Site</label>
            <input
                id="otp-site"
                name="site"
                ref={siteField}
                defaultValue={captured}
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
                    {site && site === captured
                        ? `Filled in from the link that opened this page. Fills only on ${site}.`
                        : site
                          ? `Fills only on ${site}.`
                          : "Matched exactly, so a different subdomain is a different site."}
                </p>
            )}

            <label htmlFor="otp-label">Name</label>
            <input
                id="otp-label"
                value={shown}
                onChange={(event) => {
                    setLabelEdited(true);
                    setConflict(null);
                    setLabel(typing(event.target.value));
                }}
                placeholder="github"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
            />
            {existing ? (
                <p className={styles.collision} role="alert">
                    {existing.type === "totp"
                        ? "Another authenticator already lives at this name. Replacing it loses that seed, and most sites will not show the setup key again without resetting 2FA."
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
                            ? `Replacing your ${named(existing)} at ${conflict.target} puts a new seed under a new key.`
                            : `Something already lives at ${conflict.target}. Replacing it puts a new seed under a new key.`}
                    </p>
                    <p className="field-help">
                        {existing?.type === "totp"
                            ? "The old setup key stays readable in chain history, so reset 2FA at the site rather than treating this as deleting it."
                            : "The old value stays readable in chain history by anyone ever granted it. Rotate the real credential too."}
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
