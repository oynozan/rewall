import { defineContentScript } from "#imports";
import { browser } from "wxt/browser";
import { CAPTURE, CLAIM, HANDOFF, HELLO, HERE, OFFER, WANT_PAIRING } from "../src/protocol.ts";

// Anything on the page can post here, so nothing is assumed about the shape and every field is checked
type FromPage = { type?: string; nonce?: string; name?: string; secretKey?: string; id?: string };

// Set on the shared DOM rather than on window, which a content script has its own copy of
const MARKER = "rewallExtension";

// A relay rather than externally_connectable, which has no web page half in Firefox and needs a published id in Chrome
// The browser decides where this script runs, so this matches list is what restricts who can pair
// NODE_ENV is the one flag that is already right when WXT reads these options, before any define applies
export default defineContentScript({
    matches:
        process.env.NODE_ENV === "development"
            ? ["https://rewall.me/*", "http://localhost:3000/*"]
            : ["https://rewall.me/*"],
    runAt: "document_start",

    main() {
        // Set at document_start so the dashboard knows an extension is here before it renders anything
        document.documentElement.dataset[MARKER] = "1";

        const answerHello = async (nonce?: string) => {
            const status = (await browser.runtime.sendMessage({ type: "rewall:state" }).catch(() => null)) as {
                paired?: boolean;
                unlocked?: boolean;
            } | null;
            window.postMessage(
                { type: HERE, paired: Boolean(status?.paired), unlocked: Boolean(status?.unlocked), nonce },
                location.origin,
            );
        };

        // Only the page this script was injected into, never a frame it happens to contain
        window.addEventListener("message", (event: MessageEvent) => {
            if (event.source !== window || event.origin !== location.origin) return;

            const message = event.data as FromPage | undefined;

            if (message?.type === HELLO) {
                void answerHello();
                return;
            }

            // A dashboard that is already open pairs in place, so it asks for the nonce rather than being sent one
            if (message?.type === WANT_PAIRING) {
                void browser.runtime
                    .sendMessage({ type: "rewall:request-pairing" })
                    .then((issued) => answerHello((issued as { nonce?: string } | null)?.nonce))
                    .catch(() => {});
                return;
            }

            if (message?.type === HANDOFF) {
                if (typeof message.nonce !== "string" || typeof message.secretKey !== "string") return;
                if (typeof message.name !== "string") return;

                void browser.runtime.sendMessage({
                    type: "rewall:paired",
                    nonce: message.nonce,
                    name: message.name,
                    secretKey: message.secretKey,
                });
                return;
            }

            // The reply carries a seed, so it goes straight back to this one page and never into the URL
            if (message?.type === CLAIM && typeof message.id === "string") {
                void browser.runtime
                    .sendMessage({ type: "rewall:claim-capture", id: message.id })
                    .then((held) => {
                        const answer = (held ?? {}) as { uri?: string; site?: string; error?: string };
                        window.postMessage(
                            {
                                type: CAPTURE,
                                uri: answer.uri ?? "",
                                site: answer.site ?? "",
                                error: answer.error ?? "",
                            },
                            location.origin,
                        );
                    })
                    .catch(() => {});
            }
        });

        // Tells the page an extension is here at all, so the dashboard can offer to pair instead of guessing
        browser.runtime.onMessage.addListener((message: { type?: string; nonce?: string }, _sender, sendResponse) => {
            if (message?.type !== OFFER) return false;
            window.postMessage({ type: OFFER, nonce: message.nonce }, location.origin);
            sendResponse({ delivered: true });
            return false;
        });
    },
});
