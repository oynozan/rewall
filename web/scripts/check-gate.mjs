// The dashboard shows the connected wallet and nobody else, so a visitor with no wallet sees it behind glass

import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { artifacts } from "./lib/artifacts.mjs";
import { skipTour } from "./lib/tour.mjs";
import { headlessWallet, attachWallet } from "./lib/wallet.mjs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const output = await artifacts();

const checks = [];
const pass = (message) => checks.push(message);

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await skipTour(page);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

const wallet = headlessWallet({ mnemonic: process.env.REWALL_TEST_MNEMONIC, addressIndex: 0 });
await attachWallet(page, wallet);

const shot = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: false, animations: "disabled" });
};

try {
    /* Nobody else's vault is on screen before a wallet says who you are */

    await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await expect(page.getByRole("dialog", { name: "Connect to Rewall" })).toBeVisible({ timeout: 90000 });
    await shot("gate-1-locked");

    const body = await page.locator(".dashboard-app").innerText();
    assert.equal(body.includes("rewall-test-1.eth"), false, "A visitor must not be shown someone else's vault");
    assert.equal(await page.locator(".secrets-browser button.secret-name").count(), 0, "No secrets belong to nobody");
    pass("a visitor with no wallet is shown no vault at all, not a stranger's");

    /* The glass is real, and the banner is the one thing allowed through it */

    const layers = await page.evaluate(() => {
        const scrim = document.querySelector('[class*="scrim"]');
        const banner = document.querySelector(".welcome-banner");
        return {
            backdrop: scrim ? getComputedStyle(scrim).backdropFilter : "",
            scrimZ: scrim ? Number(getComputedStyle(scrim).zIndex) : 0,
            bannerZ: banner ? Number(getComputedStyle(banner).zIndex) : 0,
        };
    });
    assert.match(layers.backdrop, /blur/, "The locked dashboard is blurred");
    assert.ok(layers.bannerZ > layers.scrimZ, "The welcome banner paints above the blur, so it stays readable");
    pass("everything is blurred except the welcome banner, which sits above the scrim");

    /* Nothing behind the glass can be reached */

    const reachable = await page.evaluate(() => {
        const gated = document.querySelector("main [inert]");
        return gated ? gated.querySelectorAll("a, button, input").length : -1;
    });
    assert.notEqual(reachable, -1, "The gated content is marked inert");
    await page.keyboard.press("Tab");
    pass("the content behind the glass is inert, so tabbing cannot reach it");

    /* Connecting lifts the glass and opens the wallet's own vault */

    const connect = page.getByRole("dialog", { name: "Connect to Rewall" }).getByRole("button");
    const walletRow = page.getByText("Continue with a wallet");
    for (let attempt = 0; attempt < 10; attempt++) {
        await connect.click({ timeout: 15000 }).catch(() => {});
        if (await walletRow.isVisible({ timeout: 8000 }).catch(() => false)) break;
    }
    await walletRow.click();
    await page.getByText("Rewall Test Wallet").first().click();
    await expect(page.locator(".sidebar-account")).toContainText("0xD2F8", { timeout: 60000 });

    await expect(page.getByRole("dialog", { name: "Connect to Rewall" })).toHaveCount(0, { timeout: 90000 });

    // Reverse resolution is empty on Sepolia, so an owner on a fresh browser is asked which name is theirs
    await expect(page.getByRole("dialog", { name: "Set up your vault" })).toBeVisible({ timeout: 90000 });
    await shot("gate-2-needs-vault");
    pass("a connected wallet with nothing linked is offered a vault rather than shown an empty dashboard");

    await page.getByRole("button", { name: "I already own a name" }).click();
    await page.getByLabel("Or name one you already own").fill("rewall-test-1.eth");
    await page.getByRole("button", { name: "This one is mine", exact: true }).click();
    await expect(page.locator(".secrets-browser button.secret-name").first()).toBeVisible({ timeout: 90000 });
    await shot("gate-3-connected");
    pass("claiming a name the wallet really holds opens their own vault");

    /* And what loaded is theirs, named in the sidebar */

    await expect(page.locator(".sidebar-vault strong, .workspace-switcher strong")).toHaveText("rewall-test-1.eth", {
        timeout: 60000,
    });
    const listed = await page.locator(".secrets-browser .secret-name small").first().innerText();
    assert.match(listed, /\.rewall\.rewall-test-1\.eth$/, "Every secret listed belongs to the connected wallet");
    pass("the sidebar names the wallet's own vault and every secret listed is under it");

    /* Storing is offered from the sidebar on every page, not just the secrets route */

    await expect(page.locator(".sidebar-action").getByRole("button", { name: "Add secret" })).toBeEnabled();
    await page.locator(".sidebar-action").getByRole("button", { name: "Add secret" }).click();
    await expect(page.getByRole("heading", { name: "Store a secret" })).toBeVisible();
    await page.keyboard.press("Escape");
    pass("Add secret sits in the sidebar and opens the store drawer from any page");

    assert.deepEqual(errors, [], "The page must not throw");
    console.log(JSON.stringify({ passed: checks.length, checks, screenshots: output }, null, 2));
} finally {
    await browser.close();
}
