// Checks the transfers page costs no wallet prompt to read and one signature to refresh forever

import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { artifacts } from "./lib/artifacts.mjs";
import { skipTour } from "./lib/tour.mjs";
import { headlessWallet, attachWallet } from "./lib/wallet.mjs";
import { claimVault, connectWallet } from "./lib/session.mjs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const output = await artifacts();

const OWNER = "rewall-test-1.eth";
// Publishes rewall.shielded, so it is the name a payment can actually be addressed to
const PAYABLE = "rewall-test-2.eth";
// Publishes a key but no shielded address, which is the case the form has to refuse before signing
const UNPAID = "rewall-test-3.eth";

const checks = [];
const pass = (message) => checks.push(message);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

const context = await browser.newContext({ viewport: { width: 1512, height: 1100 } });
const page = await context.newPage();
await skipTour(page);

const wallet = headlessWallet({ mnemonic: process.env.REWALL_TEST_MNEMONIC, addressIndex: 0 });
// Wrapped so the check can assert on what the wallet was asked to sign, not just how often
const primaryTypes = [];
const inner = wallet.request;
wallet.request = async (args) => {
    if (args.method === "eth_signTypedData_v4") {
        const payload = typeof args.params[1] === "string" ? JSON.parse(args.params[1]) : args.params[1];
        primaryTypes.push(payload.primaryType);
    }
    return inner(args);
};
await attachWallet(page, wallet);

// Opened here rather than through openOwnVault, which asserts a full address the sidebar abbreviates
await page.goto(`${baseURL}/dashboard/transfers`, { waitUntil: "domcontentloaded", timeout: 120000 });
await connectWallet(page);
const short = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
await expect(page.locator(".sidebar-account")).toContainText(short, { timeout: 60000 });
await claimVault(page, OWNER);
await expect(page.locator(".sidebar-vault strong")).toHaveText(OWNER, { timeout: 90000 });
await expect(page.getByRole("heading", { name: "Balance", exact: true })).toBeVisible({ timeout: 60000 });

/* Reading the page asks the wallet for nothing */

assert.equal(wallet.calls.typedData, 0, "Opening transfers must not prompt the wallet, a poll would be a prompt each");
await expect(page.locator(".terminal-value")).toHaveText("—");
pass("the transfers page loads with a hidden balance and zero wallet prompts");

/* One signature buys the balance, and the replay buys every refresh after it */

await page.getByRole("button", { name: "Show balance", exact: true }).click();
await expect(page.locator(".terminal-value")).not.toHaveText("—", { timeout: 60000 });

assert.equal(wallet.calls.typedData, 1, "Reading the balance must cost exactly one signature");
assert.deepEqual(primaryTypes, ["Retrieve Balances"], "The rail's primary type is what must reach the wallet");
assert.match(primaryTypes[0], / /, "That primary type contains a space, which is what the rail and the wallet must accept");
const shown = await page.locator(".terminal-value").innerText();
pass(`a balance of ${shown.trim()} came back for one signature over a primary type containing a space`);

const refresh = page.getByRole("button", { name: "Refresh", exact: true });
await refresh.click();
await expect(refresh).toBeEnabled({ timeout: 60000 });
await expect(page.locator(".terminal-value")).toHaveText(shown);

assert.equal(wallet.calls.typedData, 1, "A refresh inside the rail's window must replay the signed body, not re-sign");
pass("a refresh inside the freshness window costs no second signature and returns the same balance");

/* A name that cannot be paid is refused before a signature is spent */

await page.getByRole("button", { name: "Send", exact: true }).click();
const dialog = page.getByRole("dialog");
await expect(dialog.getByRole("heading", { name: "Send privately" })).toBeVisible({ timeout: 30000 });

const send = dialog.getByRole("button", { name: "Send", exact: true });
await dialog.getByLabel("Pay").fill(UNPAID);
await expect(dialog.getByText("has not published a payment address", { exact: false })).toBeVisible({ timeout: 60000 });
await expect(send).toBeDisabled();
pass(`${UNPAID} publishes no shielded address, so the form refuses it with the button still disabled`);

await dialog.getByLabel("Pay").fill(PAYABLE);
await expect(dialog.getByText("It leads nowhere on chain", { exact: false })).toBeVisible({ timeout: 60000 });
await expect(send).toBeEnabled();

assert.equal(wallet.calls.typedData, 1, "Resolving a recipient reads records and must never reach the wallet");
pass(`${PAYABLE} resolves to a shielded address and arms the button, all of it without a prompt`);

await page.screenshot({ path: `${output}/transfers.png`, fullPage: true });
console.log(JSON.stringify({ passed: checks.length, checks, artifacts: output }, null, 2));

await context.close();
await browser.close();
