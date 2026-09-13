// Drives the install panel and downloads what it offers, because a broken link here is a dead end for every user

import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { artifacts } from "./lib/artifacts.mjs";
import { skipTour } from "./lib/tour.mjs";
import { headlessWallet, attachWallet } from "./lib/wallet.mjs";
import { openOwnVault } from "./lib/session.mjs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const output = await artifacts();

const OWNER = "rewall-test-1.eth";

// Printed as they happen, so a run that cannot sign in still says which half it proved
const checks = [];
const passed = (name) => {
    checks.push(name);
    console.log(`PASS  ${name}`);
};

/* The files themselves, checked before any sign in, since a missing build step breaks these and nothing else */

for (const [target, file] of [
    ["Chrome", "rewall-2fa-chrome.zip"],
    ["Firefox", "rewall-2fa-firefox.zip"],
]) {
    const response = await fetch(`${baseURL}/extension/${file}`);
    assert.equal(response.status, 200, `${file} answered ${response.status}, run pnpm -C extension release`);

    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK", `${file} is not a zip`);
    assert.ok(bytes.length > 100_000, `${file} arrived as ${bytes.length} bytes`);

    // The name sits uncompressed in the local header, so finding it proves the archive holds an extension
    assert.ok(bytes.includes(Buffer.from("manifest.json")), `${file} holds no manifest`);
    passed(`${target} downloads ${Math.round(bytes.length / 1024)}kB holding a manifest`);
}

const browser = await chromium.launch({ executablePath });
const wallet = headlessWallet({ mnemonic: process.env.REWALL_TEST_MNEMONIC, addressIndex: 0 });
const context = await browser.newContext({ baseURL, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

await skipTour(page);
await attachWallet(page, wallet);
await openOwnVault(page, { url: `${baseURL}/dashboard/2fa`, address: wallet.address.slice(0, 6), name: OWNER });

/* The banner is the only route a normal person has to the extension */

const panel = page.locator(".panel-content");
await page.getByRole("button", { name: "Add to Chrome" }).click();
await expect(page.getByRole("heading", { name: "Add the 2FA extension" })).toBeVisible();
passed("Add to Chrome opens the install panel rather than a toast");

// Chromium reports itself as Chrome, so these are the steps it must be showing
await expect(panel).toContainText("chrome://extensions");
await expect(panel).toContainText("Developer mode");
await expect(panel).toContainText("Load unpacked");
passed("the panel gives the steps for the browser it is being read in");

// Says out loud why this is not one click, because a user who does not know assumes it is broken
await expect(panel).toContainText(/Web Store/i);
passed("the panel says why there is no one click install yet");

/* The download, which is the only part that can be silently dead */

const downloading = page.waitForEvent("download");
await panel.getByRole("link", { name: /Download for/ }).click();
const download = await downloading;
assert.equal(download.suggestedFilename(), "rewall-2fa-chrome.zip", "the download is named for the browser");
passed("the button in the panel downloads the build for this browser");

await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${output}/install-extension.png` });

assert.deepEqual(errors, [], `the page threw ${errors.join(", ")}`);
passed("the panel raised no page errors");

await browser.close();
console.log(JSON.stringify({ passed: checks.length, checks, screenshot: `${output}/install-extension.png` }, null, 2));
