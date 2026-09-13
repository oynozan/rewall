import { defineContentScript } from "#imports";
import { browser } from "wxt/browser";
import { detectOtpField, type OtpField } from "../src/detect.ts";
import { fillOtp } from "../src/fill.ts";
import { cropSelection, sayOnPage } from "../src/crop.ts";

export type OtpRequest =
    | { type: "rewall:detect" }
    | { type: "rewall:fill"; code: string }
    | { type: "rewall:crop" }
    | { type: "rewall:crop-failed"; message: string };
export type OtpReply = { present: boolean; hostname: string; filled?: boolean };

export default defineContentScript({
    matches: ["<all_urls>"],
    allFrames: true,
    matchAboutBlank: true,
    runAt: "document_idle",

    main() {
        // Re-read on every message rather than cached, because the page changes between a click and the one before it
        const current = (): OtpField | null => detectOtpField(document);

        let announced: boolean | null = null;

        // The toolbar has to know before the click, so presence is pushed rather than asked for
        function announce(): void {
            const present = Boolean(current());
            if (present === announced) return;
            announced = present;
            void browser.runtime.sendMessage({ type: "rewall:announce", present }).catch(() => {});
        }

        // Login forms mount their code field after a password step, so one scan at load would miss most of them
        let queued = 0;
        const observer = new MutationObserver(() => {
            if (queued) return;
            queued = requestIdleCallback(() => {
                queued = 0;
                announce();
            });
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributeFilter: ["autocomplete", "name", "id", "type", "maxlength", "hidden", "disabled", "readonly"],
        });

        announce();

        // Answered through sendResponse rather than a returned promise, which Chrome ignores
        browser.runtime.onMessage.addListener((message: OtpRequest, _sender, sendResponse) => {
            if (message?.type === "rewall:detect") {
                sendResponse({ present: Boolean(current()), hostname: location.hostname } satisfies OtpReply);
                return false;
            }

            if (message?.type === "rewall:crop-failed") {
                sayOnPage(message.message);
                sendResponse({ shown: true });
                return false;
            }

            // Answered later, because the box is only known once someone has finished drawing it
            if (message?.type === "rewall:crop") {
                void cropSelection().then((selection) => {
                    // Two frames, so the dimming layer is off the screen before anything photographs it
                    requestAnimationFrame(() =>
                        requestAnimationFrame(() => {
                            void browser.runtime.sendMessage({ type: "rewall:cropped", selection }).catch(() => {});
                        }),
                    );
                });
                sendResponse({ started: true });
                return false;
            }

            if (message?.type === "rewall:fill") {
                const field = current();
                sendResponse({
                    present: Boolean(field),
                    hostname: location.hostname,
                    filled: field ? fillOtp(field, message.code) : false,
                } satisfies OtpReply);
                return false;
            }

            return false;
        });
    },
});
