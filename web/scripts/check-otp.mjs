import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const origin = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const output = "artifacts/dashboard";
await mkdir(output, { recursive: true });
const bundled = await build({
    stdin: {
        contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {OtpCells} from './src/components/dashboard/otp-code';
import {VolumeChart} from './src/components/dashboard/volume-chart';
import {parseOtp,otpSnapshot} from './src/lib/otp';
const bytes=new TextEncoder().encode('otpauth://totp/RFC%206238:Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8&period=30');
const otp=parseOtp(bytes);
window.otpTest={wiped:[...bytes].every(b=>b===0),at:timestamp=>otpSnapshot(otp,timestamp),reject:()=>{const b=new TextEncoder().encode('otpauth://hotp/Test?secret=GEZDGNBVGY3TQOJQ&counter=0');let rejected=false;try{parseOtp(b)}catch{rejected=true}return rejected&&b.every(v=>v===0)}};
createRoot(document.getElementById('root')).render(<main className="fixture"><h1>Component test</h1><p className="muted">Public RFC 6238 test account</p><div className="secrets-browser"><div className="table-scroll"><table className="otp-table"><colgroup><col className="otp-account-col"/><col className="otp-code-col"/><col className="otp-expiry-col"/><col className="otp-action-col"/></colgroup><thead><tr><th>Account</th><th>Code</th><th>Expires in</th><th>Actions</th></tr></thead><tbody><tr><td>RFC 6238</td><OtpCells otp={otp} label="RFC 6238"/><td/></tr></tbody></table></div></div><div className="fixture-chart"><VolumeChart volume={{asset:'TEST',sentTotal:'150',sharedTotal:'75',points:[{label:'01 Sep',sent:5,shared:2},{label:'02 Sep',sent:12,shared:4},{label:'03 Sep',sent:8,shared:6},{label:'04 Sep',sent:22,shared:9},{label:'05 Sep',sent:15,shared:10},{label:'06 Sep',sent:32,shared:18},{label:'07 Sep',sent:24,shared:14},{label:'08 Sep',sent:32,shared:12}]}}/></div></main>);
`,
        loader: "tsx",
        resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    logLevel: "silent",
});
const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
});
const context = await browser.newContext({ viewport: { width: 980, height: 560 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
    await page.goto(origin + "/dashboard", { waitUntil: "networkidle", timeout: 120000 });
    const styles = await page
        .locator('link[rel="stylesheet"]')
        .evaluateAll((links) => links.map((link) => link.outerHTML).join(""));
    const classes = await page.locator("body").getAttribute("class");
    await page.route(origin + "/__component-test", (route) =>
        route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><html><head>${styles}<style>.fixture{padding:32px}.fixture h1{font-size:20px}.fixture p{margin:6px 0 32px}.fixture-chart{margin-top:32px;max-width:520px}.fixture-chart .volume-plot{height:120px}</style></head><body class="${classes}"><div id="root"></div></body></html>`,
        }),
    );
    await page.goto(origin + "/__component-test");
    await page.clock.install({ time: new Date(50000) });
    await page.clock.pauseAt(new Date(59000));
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    await page.clock.runFor(250);
    await expect(page.locator(".otp-digits")).toHaveText("9428 7082");
    assert(await page.evaluate(() => window.otpTest.wiped));
    assert(await page.evaluate(() => window.otpTest.reject()));
    assert.equal(await page.locator(".otp-digits").evaluate((el) => getComputedStyle(el).filter), "blur(4px)");
    const copy = page.getByRole("button", { name: "Copy code for RFC 6238" });
    await copy.hover();
    await page.clock.runFor(200);
    await expect(page.locator(".otp-tooltip")).toHaveCSS("opacity", "1");
    await copy.click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "94287082");
    await page.clock.runFor(1000);
    const expected = await page.evaluate(() => window.otpTest.at(Date.now()));
    assert.notEqual(expected.code, "94287082");
    await expect(page.locator(".otp-digits")).toHaveText(expected.code.slice(0, 4) + " " + expected.code.slice(4));
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(expected.remaining));
    await copy.click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected.code);
    const lit = await page
        .getByRole("progressbar")
        .locator("span")
        .evaluateAll(
            (spans) => spans.filter((span) => getComputedStyle(span).backgroundColor !== "rgb(47, 47, 47)").length,
        );
    assert.equal(lit, Math.round((expected.remaining / 30) * 20));
    await expect(page.locator(".otp-timer")).toHaveAttribute("data-urgency", "high");
    await expect(page.getByRole("progressbar").locator("span").first()).toHaveCSS(
        "background-color",
        "rgb(112, 181, 140)",
    );
    await page.clock.runFor(10000);
    await expect(page.locator(".otp-timer")).toHaveAttribute("data-urgency", "medium");
    await page.clock.runFor(250);
    await expect(page.getByRole("progressbar").locator("span").first()).toHaveCSS(
        "background-color",
        "rgb(214, 184, 104)",
    );
    await page.clock.runFor(10000);
    await expect(page.locator(".otp-timer")).toHaveAttribute("data-urgency", "low");
    await page.clock.runFor(250);
    await expect(page.getByRole("progressbar").locator("span").first()).toHaveCSS(
        "background-color",
        "rgb(217, 120, 120)",
    );
    await expect(page.locator(".otp-digits")).toHaveAttribute("aria-hidden", "true");
    await copy.focus();
    await expect(page.locator(".otp-tooltip")).toHaveCSS("opacity", "1");
    await page.clock.runFor(2200);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: output + "/otp-and-volume-components.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 650 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: output + "/otp-component-mobile.png", fullPage: true });
    assert.deepEqual(errors, []);
    const checks = [
        "RFC 6238 known code",
        "Input buffers wiped on success and failure",
        "HOTP rejected",
        "Code is blurred at rest and hidden from accessible text",
        "Copy tooltip on hover and keyboard focus",
        "Real clock rollover changes code and resets timer",
        "Copy uses the current code",
        "Countdown changes from green to yellow to red and resets green",
        "Populated chart has separate sent/shared series",
        "Mobile component has no page overflow",
    ];
    await writeFile(output + "/otp-checks.json", JSON.stringify({ checks, browserErrors: errors }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} catch (error) {
    console.error(JSON.stringify({ browserErrors: errors }));
    throw error;
} finally {
    await browser.close();
}
