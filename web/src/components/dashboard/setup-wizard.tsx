"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { getAccessToken } from "@privy-io/react-auth";
import { toBase64 } from "@rewall/sdk";
import { rememberName } from "@/src/lib/account";
import { explain } from "@/src/lib/errors";
import { newRecoveryPhrase, phraseRows, recoveryIdentity } from "@/src/lib/recovery-kit";
import { useIdentity } from "./identity";
import { Glyph } from "./ui";

type Step = "gas" | "name" | "recovery" | "finishing" | "done";

async function post(path: string, body: unknown) {
    const token = await getAccessToken();
    const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || "That did not work."), payload);
    return payload;
}

const cheer = () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    void confetti({ particleCount: 90, spread: 70, origin: { y: 0.65 }, disableForReducedMotion: true });
};

export function SetupWizard({ address, onDone }: { address: string; onDone: (name: string) => void }) {
    const { unlock, publicKey } = useIdentity();
    const [step, setStep] = useState<Step>("gas");
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const [label, setLabel] = useState("");
    const [phrase, setPhrase] = useState("");
    const [saved, setSaved] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const committedAt = useRef(0);

    /* Step one, gas */

    const drip = async () => {
        setBusy("Sending you Sepolia ETH…");
        setError("");
        try {
            const result = await post("/api/faucet", { address });
            if (!result.already) cheer();
            setStep("name");
        } catch (failure) {
            setError(explain(failure));
        } finally {
            setBusy("");
        }
    };

    /* Step two, the name, which is also where the only signature happens */

    const claim = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError("");
        setBusy("Waiting for your signature…");
        try {
            if (!(await unlock())) throw new Error("Rewall needs one signature to derive your key.");

            setBusy("Making your recovery key…");
            const words = newRecoveryPhrase();
            const recovery = await recoveryIdentity(words);

            setBusy("Reserving the name…");
            const result = await post("/api/provision", {
                phase: "start",
                address,
                label,
                publicKey,
                recoveryPublicKey: toBase64(recovery.publicKey),
            });

            committedAt.current = result.committedAt ?? Math.floor(Date.now() / 1000);
            setPhrase(words);
            setStep("recovery");
        } catch (failure) {
            setError(explain(failure));
        } finally {
            setBusy("");
        }
    };

    // The registrar makes a commitment wait 60s, so the clock runs while the recovery key is being saved
    useEffect(() => {
        if (step !== "recovery" && step !== "finishing") return;
        const tick = () => setCountdown(Math.max(0, committedAt.current + 60 - Math.floor(Date.now() / 1000)));
        tick();
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [step]);

    /* Steps three and four, which need nothing from the user but a confirmation */

    const finish = useCallback(async () => {
        setError("");
        setStep("finishing");
        for (;;) {
            try {
                const result = await post("/api/provision", { phase: "finish", address, label });
                rememberName(address, result.name);
                cheer();
                setStep("done");
                return;
            } catch (failure) {
                const wait = (failure as { retryAfter?: number }).retryAfter;
                if (!wait) {
                    setError(explain(failure));
                    setStep("recovery");
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 10) * 1000));
            }
        }
    }, [address, label]);

    const download = () => {
        const blob = new Blob([`Rewall recovery phrase for ${label}.eth\n\n${phrase}\n`], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `rewall-recovery-${label}.txt`;
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <section className="wizard" aria-label="Set up Rewall">
            <header className="wizard-head">
                <span className="tour-classifier">Getting started</span>
                <span className="mono">{["gas", "name", "recovery"].indexOf(step) + 1 || 4} / 4</span>
            </header>

            {step === "gas" && (
                <div className="wizard-step">
                    <h2>Some Sepolia ETH, on us</h2>
                    <p>
                        Rewall stores secrets on a real test network, so every change costs a little gas. This is free
                        test money and has no value anywhere.
                    </p>
                    <button className="button primary" onClick={() => void drip()} disabled={Boolean(busy)}>
                        {busy || "Send me test ETH"}
                        {!busy && <Glyph name="chevron_right" size={16} />}
                    </button>
                </div>
            )}

            {step === "name" && (
                <form className="wizard-step" onSubmit={claim}>
                    <h2>Pick your name</h2>
                    <p>This becomes your vault. Everything you store lives under it, as {label || "yourname"}.eth.</p>
                    <div className="wizard-name">
                        <input
                            aria-label="Your ENS name"
                            value={label}
                            onChange={(event) => setLabel(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                            placeholder="yourname"
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            minLength={5}
                            required
                        />
                        <span className="mono">.eth</span>
                    </div>
                    <p className="field-help">
                        Five characters or more. We pay for the registration, so all you do is sign once.
                    </p>
                    <button className="button primary" disabled={Boolean(busy) || label.length < 5}>
                        {busy || "Claim it"}
                    </button>
                </form>
            )}

            {(step === "recovery" || step === "finishing") && (
                <div className="wizard-step">
                    <h2>Your recovery phrase</h2>
                    <p>
                        Lose your wallet and these 24 words are the only way back into your secrets. Rewall never sees
                        them and cannot reset them for you.
                    </p>
                    <ol className="recovery-phrase mono" aria-label="Recovery phrase">
                        {phraseRows(phrase).map((row, index) => (
                            <li key={index}>{row.join(" ")}</li>
                        ))}
                    </ol>
                    <div className="wizard-actions">
                        <button
                            className="button"
                            type="button"
                            onClick={() => void navigator.clipboard.writeText(phrase)}
                        >
                            Copy
                        </button>
                        <button className="button" type="button" onClick={download}>
                            Download
                        </button>
                    </div>
                    <label className="wizard-confirm">
                        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />I
                        have saved it somewhere safe
                    </label>
                    <button
                        className="button primary"
                        onClick={() => void finish()}
                        disabled={!saved || step === "finishing"}
                    >
                        {step === "finishing"
                            ? countdown
                                ? `Setting up your vault, ${countdown}s`
                                : "Setting up your vault…"
                            : "Finish setup"}
                    </button>
                    {step !== "finishing" && countdown > 0 && (
                        <p className="field-help">
                            The registry makes every name wait {countdown}s before it can be claimed, which stops anyone
                            watching the queue from taking it first. Save your phrase while it runs.
                        </p>
                    )}
                </div>
            )}

            {step === "done" && (
                <div className="wizard-step">
                    <h2>{label}.eth is yours</h2>
                    <p>The name, its resolver and its registry are all held by your wallet. Nothing is held by us.</p>
                    <button className="button primary" onClick={() => onDone(`${label}.eth`)}>
                        Store your first secret
                    </button>
                </div>
            )}

            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}
