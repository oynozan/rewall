// Walks a wallet that owns nothing through the whole wizard, against real Sepolia
// Registers a real name and spends real ETH, so it is not part of the default loop

import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { createPublicClient, http, keccak256, toBytes } from "viem";
import { sepolia } from "viem/chains";
import { ownerAddressOf, readTexts, RECORD } from "@rewall/sdk";
import { artifacts } from "./lib/artifacts.mjs";
import { skipTour } from "./lib/tour.mjs";
import { headlessWallet, attachWallet } from "./lib/wallet.mjs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";
const output = await artifacts();

// A label nobody has taken, because the check registers it for real
const label = `rw${keccak256(toBytes(String(Date.now()))).slice(2, 9)}`;

const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });
const checks = [];
const pass = (message) => checks.push(message);

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
await skipTour(page);
const errors = [];
const sent = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
    const body = request.postData();
    if (body) sent.push(body);
});

// A fresh derivation index each run, because a wallet is only ever handed one sponsored vault
const walletIndex = 100 + (Number(BigInt(keccak256(toBytes(String(Date.now())))) % 800n) | 0);
const wallet = headlessWallet({ mnemonic: process.env.REWALL_TEST_MNEMONIC, addressIndex: walletIndex });
await attachWallet(page, wallet);

const shot = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: "disabled" });
};

try {
    await page.goto(`${baseURL}/dashboard/setup`, { waitUntil: "domcontentloaded", timeout: 120000 });

    // The sidebar is inert until Privy has hydrated, so a click before that lands on nothing
    await expect(page.locator(".sidebar-account")).toBeVisible({ timeout: 90000 });
    await expect(page.locator(".sidebar-account")).not.toContainText("…", { timeout: 90000 });

    // Clicking before Privy has finished loading is a no op, so the click is retried until the modal opens
    const walletRow = page.getByText("Continue with a wallet");
    const connect = page.locator("#workspace-content").getByRole("button", { name: "Connect a wallet" });
    for (let attempt = 0; attempt < 10; attempt++) {
        await connect.click({ timeout: 15000 }).catch(() => {});
        if (await walletRow.isVisible({ timeout: 8000 }).catch(() => false)) break;
    }
    await expect(walletRow).toBeVisible({ timeout: 30000 });
    await walletRow.click();
    await page.getByText("Rewall Test Wallet").first().click();
    await expect(page.locator(".sidebar-account")).toContainText(wallet.address.slice(0, 6), { timeout: 60000 });
    pass("a wallet that owns nothing connects and lands on the wizard");

    /* Gas */

    await expect(page.getByRole("heading", { name: /Sepolia ETH/i })).toBeVisible({ timeout: 30000 });
    await shot("onboarding-1-gas");
    await page.getByRole("button", { name: /Send me test ETH/i }).click();
    await expect(page.getByRole("heading", { name: "Pick your name" })).toBeVisible({ timeout: 120000 });
    pass("the faucet pays out and the wizard moves on by itself");

    /* Name, which is the only thing the user signs */

    await page.getByLabel("Your ENS name").fill(label);
    await shot("onboarding-2-name");
    await page.getByRole("button", { name: "Claim it" }).click();

    await expect(page.getByRole("heading", { name: "Your recovery phrase" })).toBeVisible({ timeout: 240000 });
    assert.equal(wallet.calls.transactions, 0, "The user must not send a transaction to claim a name");
    pass("claiming the name costs the user a signature and no transaction");

    /* Recovery phrase */

    const phrase = (await page.locator('ol[aria-label="Recovery phrase"]').innerText()).split(/\s+/).filter(Boolean);
    assert.equal(phrase.length, 24, "A recovery phrase is 24 words");
    await shot("onboarding-3-recovery");

    const leaked = sent.filter((body) => body.includes(phrase.join(" ")) || body.includes(phrase.slice(0, 6).join(" ")));
    assert.deepEqual(leaked, [], "The recovery phrase must never reach the network");
    pass("the recovery phrase is 24 words and never leaves the browser");

    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Finish setup" }).click();

    await expect(page.getByRole("heading", { name: `${label}.eth is yours` })).toBeVisible({ timeout: 300000 });
    await shot("onboarding-4-done");
    pass("the vault finishes provisioning without asking for anything else");

    /* What the user is left holding, read off the chain rather than the screen */

    assert.equal(wallet.calls.transactions, 0, "The whole wizard must cost the user zero transactions");
    assert.equal(wallet.calls.typedData, 2, "One identity signature, signed twice to prove the signer is stable");
    pass("the whole wizard costs zero transactions and one identity signature");

    const owner = await ownerAddressOf(publicClient, UNIVERSAL_RESOLVER, `${label}.eth`);
    assert.equal(owner.toLowerCase(), wallet.address.toLowerCase(), "The wallet must end up owning the name");

    const records = await readTexts(publicClient, UNIVERSAL_RESOLVER, `${label}.eth`, [RECORD.pubkey, RECORD.recoveryPubkey]);
    assert.ok(records[RECORD.pubkey], "The identity key must resolve");
    assert.ok(records[RECORD.recoveryPubkey], "The recovery key must resolve, or no secret can name it");
    pass(`${label}.eth is owned by the wallet and publishes both keys`);

    assert.deepEqual(errors, [], "The page must not throw");
    console.log(JSON.stringify({ passed: checks.length, checks, name: `${label}.eth`, screenshots: output }, null, 2));
} catch (failure) {
    // A wizard error is shown on the page, so it is far more useful than the locator that timed out
    const shown = await page
        .locator('[role="alert"]')
        .allInnerTexts()
        .catch(() => []);
    if (shown.length) console.error("on screen:", shown.join(" | "));
    if (errors.length) console.error("page errors:", errors.join(" | "));
    await shot("onboarding-failure").catch(() => {});
    throw failure;
} finally {
    await browser.close();
}
