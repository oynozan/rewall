import { browser } from "wxt/browser";
import type { OtpReply } from "../otp.content.ts";

const field = document.getElementById("field")!;

// Asks the frame rather than scanning from here, because a popup cannot reach the page's DOM at all
async function report(): Promise<void> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
        const reply = (await browser.tabs.sendMessage(tab.id, { type: "rewall:detect" })) as OtpReply | undefined;
        field.textContent = reply?.present
            ? `A sign-in code field is ready on ${reply.hostname}`
            : "No sign-in code field on this page";
    } catch {
        field.textContent = "Rewall cannot read this page";
    }
}

void report();
