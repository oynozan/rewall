// Grants and revokes a real secret across two wallets, against real Sepolia

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
const GRANTEE = "rewall-test-2.eth";
const SECRET = "web-created";
const FULL = `${SECRET}.rewall.${OWNER}`;

const checks = [];
const pass = (message) => checks.push(message);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

// Each wallet gets its own context, because the identity is held per browser session
async function open(addressIndex, expectAddress, ownName) {
    const context = await browser.newContext({ viewport: { width: 1512, height: 1100 } });
    const page = await context.newPage();
    await skipTour(page);
    const wallet = headlessWallet({ mnemonic: process.env.REWALL_TEST_MNEMONIC, addressIndex });
    await attachWallet(page, wallet);

    await openOwnVault(page, { url: `${baseURL}/dashboard/secrets`, address: expectAddress, name: ownName });
    return { page, wallet, context };
}

// A grantee cannot browse to someone else's vault, and nothing is written on their name when a secret
// is shared, so the only way in is the full name
async function findSecret(page, fullName) {
    await expect(page.locator("dialog.workspace-dialog[open]")).toHaveCount(0);
    await page.getByRole("button", { name: "Find a secret", exact: false }).click();
    await page.getByLabel("Secret’s full ENS name").fill(fullName);
    await page.getByRole("dialog").getByRole("button", { name: "Find secret", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: SECRET, exact: true })).toBeVisible({
        timeout: 90000,
    });
}

const openSecret = async (page) => {
    await expect(page.locator("dialog.workspace-dialog[open]")).toHaveCount(0);
    await page.locator(".secrets-browser button.secret-name").filter({ hasText: SECRET }).first().click();
    await expect(page.locator("dialog.workspace-dialog[open]")).toHaveCount(1);
};

try {
    /* The owner grants */

    const owner = await open(0, "0xD2F8", OWNER);
    await openSecret(owner.page);
    const people = owner.page.locator(".access-group").filter({ hasText: "People" });

    // Start from a clean slate so the run is repeatable
    if (await people.locator(".access-list li").filter({ hasText: GRANTEE }).count()) {
        await people.getByRole("button", { name: `Revoke ${GRANTEE}` }).click();
        await expect(people.locator(".access-list li").filter({ hasText: GRANTEE })).toHaveCount(0, {
            timeout: 180000,
        });
    }

    await people.getByRole("button", { name: "Add", exact: true }).click();
    await owner.page.locator(".access-form input").fill("definitely-not-registered-xyz.eth");
    await expect(owner.page.getByText("No such name on Sepolia.")).toBeVisible({ timeout: 60000 });
    pass("a name that does not exist is named as such rather than thrown as an error");

    await owner.page.locator(".access-form input").fill(GRANTEE);
    await expect(owner.page.locator(".access-form").getByText(/^Key /)).toBeVisible({ timeout: 60000 });
    await expect(owner.page.getByText(/Granting hands over a copy|^Grant$/)).toBeVisible();
    await owner.page.screenshot({ path: `${output}/share-1-granting.png`, animations: "disabled" });
    pass("a ready name shows its key fingerprint before anything is granted");

    await owner.page.getByRole("button", { name: /^Grant/ }).click();
    await expect(people.locator(".access-list li").filter({ hasText: GRANTEE })).toHaveCount(1, { timeout: 180000 });
    await owner.page.screenshot({ path: `${output}/share-2-granted.png`, animations: "disabled" });
    pass("the grantee appears in the access list only after the receipt");

    /* The grantee reads it */

    const grantee = await open(1, "0x1d49", GRANTEE);
    await findSecret(grantee.page, FULL);
    await grantee.page.getByRole("button", { name: "Reveal", exact: true }).click();
    await expect(grantee.page.locator(".revealed-value .mono")).toBeVisible({ timeout: 120000 });
    const seen = await grantee.page.locator(".revealed-value .mono").innerText();
    assert.ok(seen.length > 0);
    pass(`${GRANTEE} reads the secret with nothing but its own wallet`);

    /* The owner revokes */

    await owner.page.bringToFront();
    await people.getByRole("button", { name: `Revoke ${GRANTEE}` }).click();
    await expect(people.locator(".access-list li").filter({ hasText: GRANTEE })).toHaveCount(0, { timeout: 180000 });
    pass("revoking removes the grantee and rotates the secret");

    /* And the grantee is locked out */

    await grantee.page.bringToFront();
    await grantee.page.reload({ waitUntil: "domcontentloaded" });
    // The grantee's own vault holds nothing, so the page is ready when the lookup is offered
    await expect(grantee.page.getByRole("button", { name: "Find a secret", exact: false })).toBeVisible({
        timeout: 90000,
    });
    await findSecret(grantee.page, FULL);
    await grantee.page.getByRole("button", { name: "Reveal", exact: true }).click();
    await expect(grantee.page.getByText("You do not have access to this secret.")).toBeVisible({ timeout: 120000 });
    await grantee.page.screenshot({ path: `${output}/share-3-revoked.png`, animations: "disabled" });
    pass("the revoked grantee is told they have no access, not handed a decryption failure");

    console.log(JSON.stringify({ passed: checks.length, checks, secret: FULL }, null, 2));
} finally {
    await browser.close();
}
