"use client";

import { useCallback, useEffect, useState } from "react";

const HELLO = "rewall:hello";
const HERE = "rewall:here";
const WANT_PAIRING = "rewall:want-pairing";

// The extension has no way to reach this page except through its own relay, so presence is asked for
export type Extension = { present: boolean; paired: boolean; unlocked: boolean; nonce: string };

const ABSENT: Extension = { present: false, paired: false, unlocked: false, nonce: "" };

// The relay stamps this on the shared DOM at document_start, before React has rendered anything
const marked = () => typeof document !== "undefined" && document.documentElement.dataset.rewallExtension === "1";

export function useExtension(): Extension & { pair: () => void } {
    const [state, setState] = useState<Extension>(ABSENT);

    useEffect(() => {
        const listen = (event: MessageEvent) => {
            if (event.source !== window || event.origin !== window.location.origin) return;
            const message = event.data as { type?: string; paired?: boolean; unlocked?: boolean; nonce?: string };
            if (message?.type !== HERE) return;

            setState({
                present: true,
                paired: Boolean(message.paired),
                unlocked: Boolean(message.unlocked),
                nonce: message.nonce || "",
            });
        };

        window.addEventListener("message", listen);

        // Marked means it is certainly here, and the hello is what fills in whether it is paired already
        if (marked()) setState((current) => ({ ...current, present: true }));
        window.postMessage({ type: HELLO }, window.location.origin);

        return () => window.removeEventListener("message", listen);
    }, []);

    // Asking rather than being sent one, because this tab is already open and already holds the wallet
    const pair = useCallback(() => window.postMessage({ type: WANT_PAIRING }, window.location.origin), []);

    return { ...state, pair };
}
