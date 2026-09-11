// Drives connect, unlock and lock through Privy in a real browser against real Sepolia

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { headlessWallet, attachWallet } from "./lib/wallet.mjs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const output = "artifacts/dashboard";
await mkdir(output, { recursive: true });

const checks = [];
const pass = (message) => checks.push(message);

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

const wallet = headlessWallet({ mnemonic: process.env.REWALL_TEST_MNEMONIC, addressIndex: 0 });
await attachWallet(page, wallet);

const dialog = () => page.locator("#privy-dialog");
const rail = (label) => page.locator(".rail-access li").filter({ hasText: label });
const granted = async (label) => ((await rail(label).getAttribute("class")) || "").includes("granted");

async function shot(name) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: false, animations: "disabled" });
}

try {
    await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await expect(page.locator(".secrets-browser button.secret-name").first()).toBeVisible({ timeout: 90000 });

    /* Nothing is asked of a visitor who only wants to look */

    assert.equal(wallet.calls.typedData, 0, "Reading public metadata must not ask for a signature");
    assert.ok(await granted("Read metadata"), "Read metadata is granted to everyone");
    assert.equal(await granted("Decrypt values"), false, "Decrypt is not granted before unlocking");
    assert.equal(await granted("Write records"), false, "Write is not granted before connecting");
    await shot("unlock-1-anonymous");
    pass("the vault lists without a wallet and asks for no signature");

    /* Connect through Privy, which finds the injected wallet over EIP-6963 */

    await page.locator(".sidebar-account").click();
    await page.getByRole("button", { name: /Connect a wallet/i }).click();
    const continueWithWallet = dialog().getByText("Continue with a wallet");
    await expect(continueWithWallet).toBeVisible({ timeout: 30000 });
    await continueWithWallet.click();
    await dialog().getByText("Rewall Test Wallet").first().click();
    await expect(page.locator(".sidebar-account")).toContainText("0xD2F8", { timeout: 60000 });
    assert.equal(wallet.calls.typedData, 0, "Connecting must not derive an identity");
    pass("Privy connects an external wallet without deriving anything");

    /* Ownership is a chain fact, not a claim */

    await expect(rail("Write records")).toHaveClass(/granted/, { timeout: 60000 });
    assert.equal(await granted("Decrypt values"), false, "Connecting alone does not unlock");
    pass("the connected owner gains write, and still has to unlock to read");

    /* One deliberate unlock */

    await page.locator(".sidebar-account").click();
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(rail("Decrypt values")).toHaveClass(/granted/, { timeout: 60000 });

    // Two, because a wallet unseen before is asked to sign twice to prove it signs the same way each time
    assert.equal(wallet.calls.typedData, 2, "First unlock proves determinism, so it signs twice");
    await shot("unlock-2-unlocked");
    pass("the first unlock costs two signatures, one of them the determinism proof");

    /* Everything after is free */

    for (let i = 0; i < 3; i++) {
        await page.locator(".sidebar-account").click();
        await expect(page.getByRole("button", { name: "Lock", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
    }
    assert.equal(wallet.calls.typedData, 2, "A live session must not re-sign");
    pass("the session stays unlocked with no further signatures");

    /* Locking forgets the key, and the proof is remembered so the next unlock is one signature */

    await page.locator(".sidebar-account").click();
    await page.getByRole("button", { name: "Lock", exact: true }).click();
    await expect(rail("Decrypt values")).not.toHaveClass(/granted/);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(rail("Decrypt values")).toHaveClass(/granted/, { timeout: 60000 });
    assert.equal(wallet.calls.typedData, 3, "A re-unlock costs one signature, not two");
    pass("locking clears the key and re-unlocking costs a single signature");

    /* No derived key is ever written down */

    const stored = await page.evaluate(() => ({
        local: Object.entries(localStorage).map(([k, v]) => `${k}=${v}`),
        session: Object.entries(sessionStorage).map(([k, v]) => `${k}=${v}`),
    }));
    const suspicious = [...stored.local, ...stored.session].filter((entry) =>
        /rewall\.(identity|key|secret)/i.test(entry),
    );
    assert.deepEqual(suspicious, [], "No Rewall key material may reach browser storage");
    pass("no derived key material is written to local or session storage");

    assert.deepEqual(errors, [], "The page must not throw");
    console.log(JSON.stringify({ passed: checks.length, checks, screenshots: output }, null, 2));
} finally {
    await browser.close();
}
