"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useIdentity } from "./identity";
import { useExtension } from "./use-extension";
import { explain } from "@/src/lib/errors";

const OFFER = "rewall:pair-offer";

// Reading the query bails the tree above it out of prerendering, so the boundary belongs with the
// reader rather than with every page that happens to render one
export function PairExtension({ compact = false }: { compact?: boolean }) {
    return (
        <Suspense fallback={null}>
            <PairOffer compact={compact} />
        </Suspense>
    );
}

// Shown in place of the install banner once an extension is actually here, since installing is then done
function PairOffer({ compact }: { compact: boolean }) {
    const params = useSearchParams();
    const { handOff } = useIdentity();
    const extension = useExtension();

    // The extension opens this page carrying one, and hands one back when the page asks to pair in place
    const [sent, setSent] = useState(() => params.get("pair") || "");
    const [step, setStep] = useState("");
    const [done, setDone] = useState(false);
    const [error, setError] = useState("");

    const nonce = sent || extension.nonce;

    useEffect(() => {
        const listen = (event: MessageEvent) => {
            if (event.source !== window || event.origin !== window.location.origin) return;
            const message = event.data as { type?: string; nonce?: string } | undefined;
            if (message?.type === OFFER && typeof message.nonce === "string") setSent(message.nonce);
        };
        window.addEventListener("message", listen);
        return () => window.removeEventListener("message", listen);
    }, []);

    // A nonce arriving is not consent, so the wallet is only prompted after someone presses the button
    const [asked, setAsked] = useState(false);

    function start() {
        setAsked(true);
        if (!nonce) extension.pair();
    }

    useEffect(() => {
        if (!asked || !nonce || done || step) return;
        setStep("Waiting for your wallet…");
        setError("");

        handOff(nonce)
            .then(() => setDone(true))
            .catch((failure) => setError(explain(failure)))
            .finally(() => setStep(""));
        // Runs once the pressed button has a nonce to hand over
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [asked, nonce]);

    // Nothing to offer when no extension is here, and nothing left to do once it holds a key
    if (done || !extension.present || (extension.paired && !nonce)) return null;

    return (
        <aside
            className={"extension-banner" + (compact ? " extension-banner-compact" : "")}
            aria-label="Pair the browser extension"
        >
            <div className="extension-copy">
                <h2>Pair this browser</h2>
                <p>
                    The extension gets a key that reads and decrypts your accounts. It never gets your wallet, so it can
                    never sign anything.
                </p>
                {error && (
                    <p className="form-error" role="alert">
                        {error}
                    </p>
                )}
            </div>
            <div className="extension-actions">
                <button className="button primary" onClick={start} disabled={asked && !error}>
                    {step || "Hand over the key"}
                </button>
            </div>
        </aside>
    );
}
