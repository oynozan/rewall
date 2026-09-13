// Drives detect and fill in a real browser against real markup, with no extension loaded and nothing stubbed

import { chromium } from "playwright";
import { build } from "esbuild";
import { fixtures } from "./fixtures.mjs";
import QRCode from "qrcode";

let passed = 0;
const pass = (message) => {
    passed++;
    console.log(`PASS  ${message}`);
};
const fail = (message) => {
    throw new Error(`FAIL  ${message}`);
};

/* Bundles */

const bundle = async (stdin, resolveDir) => {
    const result = await build({
        stdin: { contents: stdin, resolveDir, loader: "tsx" },
        bundle: true,
        format: "iife",
        write: false,
        logLevel: "silent",
    });
    return result.outputFiles[0].text;
};

const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const detector = await bundle(
    `import { detectOtpField } from "../src/detect.ts";
     import { fillOtp, fillField } from "../src/fill.ts";
     import { visitedHostname } from "../src/capture.ts";
     import { scanOtpauth, readOtpauth } from "../src/qr.ts";
     window.rewall = { detectOtpField, fillOtp, fillField, visitedHostname, scanOtpauth, readOtpauth };`,
    here,
);

// A genuinely React controlled input, because the value tracker is the whole reason fill works the way it does
const reactApp = await bundle(
    `import { useState } from "react";
     import { createRoot } from "react-dom/client";
     function Otp() {
         const [value, setValue] = useState("");
         return React.createElement("form", null,
             React.createElement("input", {
                 autoComplete: "one-time-code", maxLength: 6, value,
                 onChange: (e) => setValue(e.target.value),
             }),
             React.createElement("output", { id: "state" }, value));
     }
     import * as React from "react";
     createRoot(document.getElementById("root")).render(React.createElement(Otp));`,
    here,
);

/* Run */

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (error) => fail(`page threw ${error.message}`));

for (const [name, fixture] of Object.entries(fixtures)) {
    await page.setContent(fixture.html);
    await page.addScriptTag({ content: detector });

    const found = await page.evaluate(() => {
        const field = window.rewall.detectOtpField(document);
        if (!field) return null;
        return field.kind === "single"
            ? { kind: "single", id: field.input.id, name: field.input.name }
            : { kind: "split", count: field.inputs.length };
    });

    if (fixture.expect === null) {
        if (found) fail(`${name} should be refused, found ${JSON.stringify(found)}`);
        pass(`${name} is refused`);
        continue;
    }

    if (!found) fail(`${name} should be detected and was not`);
    if (found.kind !== fixture.expect.kind) fail(`${name} detected as ${found.kind}, expected ${fixture.expect.kind}`);
    if (fixture.expect.count && found.count !== fixture.expect.count) {
        fail(`${name} grouped ${found.count} boxes, expected ${fixture.expect.count}`);
    }
    if (fixture.expect.id && found.id !== fixture.expect.id) {
        fail(`${name} picked ${found.id || "an unnamed field"}, expected ${fixture.expect.id}`);
    }
    pass(`${name} is detected as ${found.kind}`);
}

/* Filling */

await page.setContent(fixtures.declared.html);
await page.addScriptTag({ content: detector });
const filledSingle = await page.evaluate(() => {
    const field = window.rewall.detectOtpField(document);
    const ok = window.rewall.fillOtp(field, "123456");
    return { ok, value: document.querySelector("input").value };
});
if (!filledSingle.ok || filledSingle.value !== "123456") fail(`a declared field took ${filledSingle.value}`);
pass("a declared field takes the code");

await page.setContent(fixtures.splitBoxes.html);
await page.addScriptTag({ content: detector });
const filledSplit = await page.evaluate(() => {
    const field = window.rewall.detectOtpField(document);
    const ok = window.rewall.fillOtp(field, "654321");
    return { ok, values: [...document.querySelectorAll("input")].map((i) => i.value).join("") };
});
if (!filledSplit.ok || filledSplit.values !== "654321") fail(`split boxes took ${filledSplit.values}`);
pass("split boxes take one digit each");

// The claim the whole fill design rests on, that React sees the change rather than swallowing it
await page.setContent(`<!doctype html><meta charset="utf-8"><body><div id="root"></div>`);
await page.addScriptTag({ content: reactApp });
await page.addScriptTag({ content: detector });
await page.waitForSelector("input");
const reactResult = await page.evaluate(() => {
    const field = window.rewall.detectOtpField(document);
    window.rewall.fillOtp(field, "424242");
    return { dom: document.querySelector("input").value, state: document.getElementById("state").textContent };
});
if (reactResult.dom !== "424242") fail(`React input holds ${reactResult.dom}`);
if (reactResult.state !== "424242") fail(`React state holds ${reactResult.state}, so onChange never fired`);
pass("a React controlled input updates its state, not just the DOM");

/* The hostname the popup offers to save, which decides whether a hand off is offered at all */

await page.setContent(`<!doctype html><meta charset="utf-8"><body>`);
await page.addScriptTag({ content: detector });
const hostnames = await page.evaluate(() =>
    [
        "https://github.com/login",
        "http://localhost:3000/dashboard",
        "https://accounts.google.com",
        "chrome://extensions",
        "about:blank",
        "file:///C:/x.html",
        "moz-extension://abc/popup.html",
        "",
        "not a url",
    ].map((url) => window.rewall.visitedHostname(url)),
);
const expected = ["github.com", "localhost", "accounts.google.com", "", "", "", "", "", ""];
if (hostnames.join("|") !== expected.join("|")) fail(`the popup read ${hostnames.join(", ")}`);
pass("only an http page offers its hostname to save");

/* The setup QR, generated for real and read back by the same decoder the popup uses */

const SETUP =
    "otpauth://totp/RFC%206238:Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=RFC%206238&digits=8&period=30";

// Rendered at the size a real setup page uses, so this proves the decoder at the resolution it will meet
const setupQr = await QRCode.toDataURL(SETUP, { width: 220, margin: 2 });
const otherQr = await QRCode.toDataURL("https://example.com/not-a-setup-code", { width: 220, margin: 2 });

await page.setContent(`<!doctype html><meta charset="utf-8"><body>`);
await page.addScriptTag({ content: detector });

const scanned = await page.evaluate((url) => window.rewall.scanOtpauth(url), setupQr);
if (scanned !== SETUP) fail(`the setup QR decoded to ${scanned}`);
pass("a real setup QR decodes to the URI it was made from");

const refused = await page.evaluate(
    (url) =>
        window.rewall
            .scanOtpauth(url)
            .then(() => "")
            .catch((failure) => failure.name),
    otherQr,
);
if (refused !== "NoQrError") fail(`a QR holding a link was answered with ${refused}`);
pass("a QR holding something other than a setup code is refused");

// A screen with no code on it at all, which is what most of these attempts will be
const blank = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 200;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 320, 200);
    return window.rewall
        .scanOtpauth(canvas.toDataURL())
        .then(() => "")
        .catch((failure) => failure.message);
});
if (!/no setup code/i.test(blank)) fail(`a blank screen said ${blank}`);
pass("a screen with no code on it says so rather than failing silently");

await browser.close();
console.log(`\n${passed} checks passed against a real browser`);
