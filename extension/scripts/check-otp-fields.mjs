// Drives detect and fill in a real browser against real markup, with no extension loaded and nothing stubbed

import { chromium } from "playwright";
import { build } from "esbuild";
import { fixtures } from "./fixtures.mjs";

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
     window.rewall = { detectOtpField, fillOtp, fillField };`,
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

await browser.close();
console.log(`\n${passed} checks passed against a real browser`);
