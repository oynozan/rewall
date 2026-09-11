import { defineContentScript } from "#imports";
import { browser } from "wxt/browser";
import { detectOtpField, type OtpField } from "../src/detect.ts";
import { fillOtp } from "../src/fill.ts";

export type OtpRequest = { type: "rewall:detect" } | { type: "rewall:fill"; code: string };
export type OtpReply = { present: boolean; hostname: string; filled?: boolean };

export default defineContentScript({
    matches: ["<all_urls>"],
    allFrames: true,
    matchAboutBlank: true,
    runAt: "document_idle",

    main() {
        // Re-read on every message rather than cached, because the page changes between a click and the one before it
        const current = (): OtpField | null => detectOtpField(document);

        browser.runtime.onMessage.addListener((message: OtpRequest): Promise<OtpReply> | undefined => {
            if (message?.type === "rewall:detect") {
                return Promise.resolve({ present: Boolean(current()), hostname: location.hostname });
            }

            if (message?.type === "rewall:fill") {
                const field = current();
                return Promise.resolve({
                    present: Boolean(field),
                    hostname: location.hostname,
                    filled: field ? fillOtp(field, message.code) : false,
                });
            }

            return undefined;
        });
    },
});
