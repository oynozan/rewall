// Recovers a vault in the browser, guardians approving on chain, against real Sepolia

import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { artifacts } from "./lib/artifacts.mjs";
import { skipTour } from "./lib/tour.mjs";
import { headlessWallet, attachWallet } from "./lib/wallet.mjs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const output = await artifacts();

const LOST = "rewall-test-1.eth";
// Only a guardian holding its own name can publish an approval, the rest belong to a parent
const SELF_OWNED_GUARDIANS = [
    { index: 1, prefix: "0x1d49" },
    { index: 3, prefix: "0xDf7E" },
];
const REPLACEMENT = 9;

const checks = [];
const pass = (message) => checks.push(message);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

async function open(addressIndex, expectAddress, path = "/dashboard/recovery") {
    const context = await browser.newContext({ viewport: { width: 1512, height: 1100 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await context.newPage();
    await skipTour(page);
    const wallet = headlessWallet({ mnemonic: process.env.REWALL_TEST_MNEMONIC, addressIndex });
    await attachWallet(page, wallet);

    await page.goto(`${baseURL}${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });

    // The sidebar is in the static HTML, so a click lands before React attaches and is simply lost.
    // Retry until the drawer actually opens, which is the only reliable signal that hydration is done
    await expect(page.getByRole("heading", { name: "Recovery", exact: true })).toBeVisible({ timeout: 90000 });
    const drawer = page.locator("dialog.workspace-dialog[open]");
    for (let attempt = 0; attempt < 30; attempt++) {
        await page.locator(".sidebar-account").click();
        if (await drawer.count()) break;
        await page.waitForTimeout(1000);
    }
    await expect(drawer).toHaveCount(1, { timeout: 30000 });
    await page
        .getByRole("dialog")
        .getByRole("button", { name: /Connect a wallet/i })
        .click();
    await expect(page.locator("#privy-dialog").getByText("Continue with a wallet")).toBeVisible({ timeout: 30000 });
    await page.locator("#privy-dialog").getByText("Continue with a wallet").click();
    await page.locator("#privy-dialog").getByText("Rewall Test Wallet").first().click();
    await expect(page.locator(".sidebar-account")).toContainText(expectAddress, { timeout: 60000 });
    await expect(page.locator("dialog.workspace-dialog[open]")).toHaveCount(0);
    return { page, wallet };
}

try {
    /* The replacement wallet, which holds nothing */

    const fresh = await open(REPLACEMENT, "0xEE02");
    await fresh.page.getByRole("button", { name: "Unlock to continue", exact: true }).click();
    await expect(fresh.page.getByLabel("The ENS name you are recovering")).toBeVisible({ timeout: 120000 });
    pass("a wallet holding nothing still reaches recovery, it only has to derive its own key");

    await fresh.page.getByLabel("The ENS name you are recovering").fill(LOST);
    await expect(fresh.page.locator(".recovery-count")).toBeVisible({ timeout: 120000 });
    const before = await fresh.page.locator(".recovery-count").innerText();
    assert.match(before, /^\d+ of \d+ approved$/);
    await fresh.page.screenshot({ path: `${output}/recovery-1-waiting.png`, animations: "disabled" });
    pass(`the guardian policy is read from chain, showing ${before.toLowerCase()}`);

    const link = await fresh.page.evaluate(async () => {
        const button = [...document.querySelectorAll("button")].find((b) =>
            b.getAttribute("aria-label")?.includes("guardian link"),
        );
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        return navigator.clipboard.readText();
    });
    assert.match(link, /approve=.+&key=.+/);
    pass("the guardian link carries the replacement key, which is public and safe to send");

    /* Each guardian that holds its own name approves */

    for (const guardian of SELF_OWNED_GUARDIANS) {
        const path = link.slice(link.indexOf("/dashboard/recovery"));
        const session = await open(guardian.index, guardian.prefix, path);
        await session.page.getByRole("button", { name: "Unlock to continue", exact: true }).click();
        await expect(session.page.getByRole("button", { name: "Approve this recovery" })).toBeVisible({
            timeout: 120000,
        });
        const spent = session.wallet.calls.transactions;
        await session.page.getByRole("button", { name: "Approve this recovery" }).click();
        await expect(session.page.getByRole("button", { name: "Approved, your share is published" })).toBeVisible({
            timeout: 180000,
        });
        assert.equal(session.wallet.calls.transactions - spent, 1, "Approving costs one transaction");
    }
    pass(`${SELF_OWNED_GUARDIANS.length} guardians approved, one transaction each`);

    /* The count climbs without anything being passed by hand */

    await fresh.page.bringToFront();
    await expect(fresh.page.locator(".recovery-count")).toBeVisible({ timeout: 120000 });

    // Reads real chain state, so a quorum may already have approved from an earlier run
    const [, approvals, threshold] = (await fresh.page.locator(".recovery-count").innerText()).match(
        /^(\d+) of (\d+) approved$/,
    );
    assert.ok(
        Number(approvals) >= SELF_OWNED_GUARDIANS.length,
        `expected at least ${SELF_OWNED_GUARDIANS.length} approvals, saw ${approvals}`,
    );
    await fresh.page.screenshot({ path: `${output}/recovery-2-approved.png`, animations: "disabled" });
    pass(`the replacement wallet sees ${approvals} of ${threshold} by reading the guardians' own names`);

    /* Below the threshold it refuses to pretend, at it the vault comes back */

    const action = fresh.page.locator(".recovery-block button.primary").last();
    if (Number(approvals) < Number(threshold)) {
        assert.equal(await action.isDisabled(), true);
        assert.match(await action.innerText(), /^Waiting for \d+ more$/);
        pass("below the threshold the action names how many are missing and stays disabled");
    } else {
        await action.click();
        await expect(fresh.page.getByText(/Rebuilt the recovery key/)).toBeVisible({ timeout: 180000 });
        await fresh.page.screenshot({ path: `${output}/recovery-3-recovered.png`, animations: "disabled" });
        pass("at the threshold the vault is recovered and the rebuilt key is named");
    }

    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
    await browser.close();
}
