"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { getAccessToken } from "@privy-io/react-auth";
import { toBase64 } from "@rewall/sdk";
import { rememberName } from "@/src/lib/account";
import { explain } from "@/src/lib/errors";
import { newRecoveryPhrase, phraseRows, recoveryIdentity } from "@/src/lib/recovery-kit";
import { useIdentity } from "./identity";
import { SegmentedProgress } from "./ui";
import { LiquidMetalButton } from "./liquid-metal-button";
import styles from "./setup-wizard.module.css";

type Step = "gas" | "name" | "recovery" | "finishing" | "done";

// The registrar makes a commitment sit for 60s before the name can be revealed
const COMMIT_WAIT = 60;

async function post(path: string, body: unknown) {
    const token = await getAccessToken();
    const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
        throw Object.assign(new Error(payload.error || "That did not work."), payload, { fromServer: true });
    return payload;
}

// The API already answers in sentences, so running those through explain would replace them with a shrug
const say = (failure: unknown) =>
    (failure as { fromServer?: boolean })?.fromServer ? (failure as Error).message : explain(failure);

const cheer = () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    void confetti({ particleCount: 90, spread: 70, origin: { y: 0.65 }, disableForReducedMotion: true });
};

export function SetupWizard({ address, onDone }: { address: string; onDone: (name: string) => void | Promise<void> }) {
    const { unlock } = useIdentity();
    const [step, setStep] = useState<Step>("gas");
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const [label, setLabel] = useState("");
    const [phrase, setPhrase] = useState("");
    const [vaultName, setVaultName] = useState("");
    const [saved, setSaved] = useState(false);
    const [countdown, setCountdown] = useState(0);
    // Which cell flashed, where the word count marks the whole phrase and -2 a clipboard the browser refused
    const [copied, setCopied] = useState(-1);
    const committedAt = useRef(0);
    const flash = useRef(0);

    const words = phrase ? phraseRows(phrase).flat() : [];

    useEffect(() => () => window.clearTimeout(flash.current), []);

    // The timer starts only once the write settles, or a slow clipboard leaves a cell lit after its own reset ran
    const copy = (text: string, mark: number) => {
        window.clearTimeout(flash.current);
        void navigator.clipboard
            .writeText(text)
            .then(() => setCopied(mark))
            .catch(() => setCopied(-2))
            .finally(() => {
                flash.current = window.setTimeout(() => setCopied(-1), 1600);
            });
    };

    /* Step one, gas */

    const drip = async () => {
        setBusy("Sending you Sepolia ETH…");
        setError("");
        try {
            const result = await post("/api/faucet", { address });
            if (!result.already) cheer();
            setStep("name");
        } catch (failure) {
            setError(say(failure));
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
            // Taken from the return value, because the state setter has not landed by the time this posts
            const identityKey = await unlock();
            if (!identityKey) throw new Error("Rewall needs one signature to derive your key.");

            setBusy("Making your recovery key…");
            const words = newRecoveryPhrase();
            const recovery = await recoveryIdentity(words);

            setBusy("Reserving the name…");
            const result = await post("/api/provision", {
                phase: "start",
                address,
                label,
                publicKey: identityKey,
                recoveryPublicKey: toBase64(recovery.publicKey),
            });

            committedAt.current = result.committedAt ?? Math.floor(Date.now() / 1000);
            setPhrase(words);
            setStep("recovery");
        } catch (failure) {
            setError(say(failure));
        } finally {
            setBusy("");
        }
    };

    // The clock runs while the recovery key is being saved, so the wait costs the user nothing
    useEffect(() => {
        if (step !== "recovery" && step !== "finishing") return;
        const tick = () => setCountdown(Math.max(0, committedAt.current + COMMIT_WAIT - Math.floor(Date.now() / 1000)));
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

                // Remembered now so a reload finds the vault, but adopted only on the way out, because
                // adopting changes the vault the shell keys its subtree on and would remount this wizard
                // Taken from the reply rather than the typed label, because a wallet that already has a
                // sponsored vault is handed that one back instead of the name it just asked for
                setVaultName(result.name);
                rememberName(address, result.name);
                cheer();
                setStep("done");
                return;
            } catch (failure) {
                const wait = (failure as { retryAfter?: number }).retryAfter;
                if (!wait) {
                    setError(say(failure));
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
        <section className={styles.wizard} aria-label="Set up Rewall">
            <header className={styles.head}>
                <span className="tour-classifier">Getting started</span>
                <span className="mono">{["gas", "name", "recovery"].indexOf(step) + 1 || 4} / 4</span>
            </header>

            {step === "gas" && (
                <div className={styles.step}>
                    <h2>Some Sepolia ETH, on us</h2>
                    <p>
                        Rewall stores secrets on a real test network, so every change costs a little gas. This is free
                        test money and has no value anywhere.
                    </p>
                    <LiquidMetalButton
                        fullWidth
                        className={styles.cta}
                        label={busy || "Send me test ETH"}
                        onClick={() => void drip()}
                        disabled={Boolean(busy)}
                    />
                </div>
            )}

            {step === "name" && (
                <form className={styles.step} onSubmit={claim}>
                    <h2>Pick your name</h2>
                    <p>This becomes your vault. Everything you store lives under it, as {label || "yourname"}.eth.</p>
                    <div className={styles.name}>
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
                    <LiquidMetalButton
                        fullWidth
                        className={styles.cta}
                        type="submit"
                        disabled={Boolean(busy) || label.length < 5}
                        label={busy || "Claim it"}
                    />
                </form>
            )}

            {(step === "recovery" || step === "finishing") && (
                <div className={styles.step}>
                    <h2>Your recovery phrase</h2>
                    <p>
                        Lose your wallet and these 24 words are the only way back into your secrets. Rewall never sees
                        them and cannot reset them for you.
                    </p>
                    <ol className={styles.phrase} aria-label="Recovery phrase">
                        {words.map((word, index) => (
                            <li key={index}>
                                <button
                                    type="button"
                                    className={`${styles.cell} ${copied === index ? styles.copied : ""}`}
                                    aria-label={`Copy word ${index + 1}, ${word}`}
                                    onClick={() => copy(word, index)}
                                >
                                    {word}
                                </button>
                            </li>
                        ))}
                    </ol>
                    <p className={styles.note} role="status">
                        {copied === -2
                            ? "Your browser blocked the clipboard, select the words instead"
                            : copied === words.length
                              ? "Recovery phrase copied"
                              : copied >= 0
                                ? `Word ${copied + 1} copied`
                                : "Click any word to copy it"}
                    </p>
                    <div className={styles.actions}>
                        <button className="button" type="button" onClick={() => copy(phrase, words.length)}>
                            Copy
                        </button>
                        <button className="button" type="button" onClick={download}>
                            Download
                        </button>
                    </div>
                    <label className={styles.confirm}>
                        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />I
                        have saved it somewhere safe
                    </label>
                    {countdown > 0 && (
                        <div className={styles.wait}>
                            <SegmentedProgress
                                value={COMMIT_WAIT - countdown}
                                max={COMMIT_WAIT}
                                label="Time until your name can be claimed"
                                segments={30}
                            />
                            <p className={styles.waitNote}>
                                <span>Your name is committed before it is revealed, so nobody can take it first</span>
                                <span className="mono">{countdown}s</span>
                            </p>
                        </div>
                    )}
                    <LiquidMetalButton
                        fullWidth
                        className={styles.cta}
                        label={step === "finishing" ? "Setting up your vault…" : "Finish setup"}
                        onClick={() => void finish()}
                        disabled={!saved || step === "finishing"}
                    />
                </div>
            )}

            {step === "done" && (
                <div className={styles.step}>
                    <h2>{vaultName} is yours</h2>
                    <p>The name, its resolver and its registry are all held by your wallet. Nothing is held by us.</p>
                    <LiquidMetalButton
                        fullWidth
                        className={styles.cta}
                        onClick={() => void onDone(vaultName)}
                        label="Store your first secret"
                    />
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
