// Stores and reveals a real secret on Sepolia through the browser, wallet prompts and all

import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { artifacts } from "./lib/artifacts.mjs";
import { skipTour } from "./lib/tour.mjs";
import { createPublicClient, http, parseAbi } from "viem";
import { sepolia } from "viem/chains";
import { dnsEncode, registryLookupAbi } from "@rewall/sdk";
import { headlessWallet, attachWallet } from "./lib/wallet.mjs";
import { openOwnVault } from "./lib/session.mjs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const output = await artifacts();

const OWNER = "rewall-test-1.eth";
const RECOVERY = "rewall-test-3.eth";
const LABEL = "web-created";
const VALUE = `sk_live_from_the_browser_${Date.now()}`;

const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";
const ZERO = "0x0000000000000000000000000000000000000000";
const chain = createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"),
});

// A subname that does not exist yet costs its own transaction before any record can be written
async function registered(secretName) {
    const registry = await chain.readContract({
        address: UNIVERSAL_RESOLVER,
        abi: registryLookupAbi,
        functionName: "findParentRegistry",
        args: [dnsEncode(secretName)],
    });
    const resolver = await chain.readContract({
        address: registry,
        abi: parseAbi(["function getResolver(string label) view returns (address)"]),
        functionName: "getResolver",
        args: [secretName.split(".")[0]],
    });
    return resolver !== ZERO;
}

const checks = [];
const pass = (message) => checks.push(message);

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
await skipTour(page);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

const wallet = headlessWallet({ mnemonic: process.env.REWALL_TEST_MNEMONIC, addressIndex: 0 });
await attachWallet(page, wallet);

const drawer = () => page.locator("dialog.workspace-dialog[open]");
const closed = (timeout = 5000) => expect(drawer()).toHaveCount(0, { timeout });
const opened = () => expect(drawer()).toHaveCount(1);
const shot = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: false, animations: "disabled" });
};

try {
    /* A visitor with no wallet is shown nothing at all, let alone somewhere to store */

    await page.goto(`${baseURL}/dashboard/secrets`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await expect(page.getByRole("dialog", { name: "Connect to Rewall" })).toBeVisible({ timeout: 90000 });
    await expect(page.getByRole("button", { name: "Store a secret" })).toHaveCount(0);
    pass("a visitor who owns nothing is not offered a place to store");

    /* Connect and adopt the vault */

    await openOwnVault(page, { url: `${baseURL}/dashboard/secrets`, address: "0xD2F8", name: OWNER });
    await expect(page.locator(".secrets-browser button.secret-name").first()).toBeVisible({ timeout: 90000 });
    await expect(page.locator(".workspace-switcher small, .sidebar-vault small")).toHaveText("Yours", { timeout: 60000 });
    pass("the owner adopts their vault and the store action appears");

    /* Store a real secret */

    await closed();
    await expect(page.getByRole("button", { name: "Store a secret" })).toBeVisible();
    await page.getByRole("button", { name: "Store a secret" }).click();
    await opened();
    await page.getByLabel("Name", { exact: true }).fill(LABEL);
    await expect(page.locator(".create-target")).toHaveText(`${LABEL}.rewall.${OWNER}`);
    await page.getByLabel("Value", { exact: true }).fill(VALUE);

    // Name, value and type are the whole form, so naming a different recovery holder is behind a disclosure
    await expect(page.getByLabel("Recovery name", { exact: true })).toBeHidden();
    await page.getByRole("button", { name: "Recovery and sharing" }).click();
    await page.getByLabel("Recovery name", { exact: true }).fill(RECOVERY);
    await shot("create-1-form");

    const expected = (await registered(`${LABEL}.rewall.${OWNER}`)) ? 1 : 2;
    const before = wallet.calls.transactions;
    await page.getByRole("button", { name: "Store secret", exact: true }).click();

    // Success closes the drawer, a name already in use offers a confirmation instead
    const replaceIt = page.getByRole("button", { name: "Replace it", exact: true });
    let conflicted = false;
    for (let waited = 0; waited < 120; waited++) {
        if (await replaceIt.count()) {
            conflicted = true;
            break;
        }
        if (!(await drawer().count())) break;
        await page.waitForTimeout(1000);
    }

    if (conflicted) {
        assert.equal(wallet.calls.transactions - before, 0, "A refused create must not spend a transaction");
        pass("storing over a live secret is refused until it is confirmed");
        await replaceIt.click();
        await closed(180000);
    }

    await expect(page.locator(".secrets-browser").getByText(`${LABEL}.rewall.${OWNER}`)).toBeVisible({
        timeout: 180000,
    });
    assert.equal(
        wallet.calls.transactions - before,
        expected,
        `Storing must cost ${expected} transactions, ${expected === 2 ? "registering the subname then writing it" : "one write"}`,
    );
    pass(`the secret was stored in ${expected} transaction${expected === 1 ? "" : "s"} and appears in the listing`);

    /* Read it back, which proves it round tripped through the chain */

    await closed();
    await page.locator(".secrets-browser button.secret-name").filter({ hasText: LABEL }).first().click();
    await opened();
    await page.getByRole("button", { name: "Reveal", exact: true }).click();
    await expect(page.locator(".revealed-value .mono")).toHaveText(VALUE, { timeout: 120000 });
    await shot("create-2-revealed");
    pass("the stored value reveals back exactly as it went in");

    /* Hiding takes it off the screen */

    await page.getByRole("button", { name: "Hide", exact: true }).click();
    await expect(page.locator(".revealed-value")).toHaveCount(0);
    assert.equal((await page.locator(".dashboard-app").innerText()).includes(VALUE), false);
    pass("hiding removes the plaintext from the page");

    /* Replacing the value rotates it under a new key */

    await page.getByRole("button", { name: "Reveal", exact: true }).click();
    await expect(page.locator(".revealed-value .mono")).toHaveText(VALUE, { timeout: 120000 });

    const rotated = `${VALUE}_rotated`;
    const beforeRotate = wallet.calls.transactions;
    await page.getByRole("button", { name: "Replace value", exact: true }).click();
    await page.getByLabel("New value", { exact: true }).fill(rotated);
    await page.getByRole("button", { name: "Replace", exact: true }).click();
    await expect(page.locator(".revealed-value .mono")).toHaveText(rotated, { timeout: 180000 });
    assert.equal(wallet.calls.transactions - beforeRotate, 1, "A rotation must cost exactly one transaction");
    await shot("create-3-rotated");
    pass("replacing the value rotates it in one transaction and shows the new one");

    assert.deepEqual(errors, [], "The page must not throw");
    console.log(JSON.stringify({ passed: checks.length, checks, stored: `${LABEL}.rewall.${OWNER}` }, null, 2));
} finally {
    await browser.close();
}
