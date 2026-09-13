// A wallet that has never been told about Sepolia has to be asked to add it before Rewall signs anything

import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mainnet, sepolia } from "viem/chains";
import { artifacts } from "./lib/artifacts.mjs";
import { skipTour } from "./lib/tour.mjs";
import { headlessWallet, attachWallet } from "./lib/wallet.mjs";
import { connectWallet, claimVault } from "./lib/session.mjs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const output = await artifacts();
const checks = [];
const SEPOLIA = `0x${sepolia.id.toString(16)}`;

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
await skipTour(page);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

// Where the bug report started, connected on mainnet with Sepolia not in the wallet yet
const wallet = headlessWallet({
    mnemonic: process.env.REWALL_TEST_MNEMONIC,
    addressIndex: 0,
    chainId: mainnet.id,
    knownChains: [mainnet.id],
});
await attachWallet(page, wallet);
const chainOf = () => page.evaluate(() => window.__headlessWallet.request({ method: "eth_chainId" }));

try {
    await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120000 });
    assert.equal(await chainOf(), `0x${mainnet.id.toString(16)}`, "The wallet starts somewhere else");

    await connectWallet(page);
    await expect(page.locator(".sidebar-account")).toContainText("0xD2F8", { timeout: 60000 });

    // Refusing the switch with 4902 is what asks a wallet to add the chain, so the refusal has to be understood
    assert.deepEqual(wallet.calls.addedChains, [sepolia.id], "Connecting adds Sepolia to a wallet that lacks it");
    assert.equal(await chainOf(), SEPOLIA, "The wallet is moved to Sepolia by connecting");
    checks.push("connecting a wallet that has never seen Sepolia adds the chain and switches to it");

    await claimVault(page, "rewall-test-1.eth");
    await expect(page.locator(".sidebar-vault strong, .workspace-switcher strong")).toHaveText("rewall-test-1.eth", {
        timeout: 90000,
    });
    assert.equal(wallet.calls.typedData, 0, "Reading a vault takes no signature");

    /* Nothing may be signed while the wallet sits on another chain */

    // Moved the way a user moves it, so Privy's cached chainId still says Sepolia while the wallet does not
    // Sepolia is dropped too, since Privy only adds it at login and a returning session never goes through that
    wallet.setChain(mainnet.id, { forget: sepolia.id });
    assert.equal(await chainOf(), `0x${mainnet.id.toString(16)}`, "The wallet has drifted off Sepolia");

    await page.locator(".sidebar-account").click();
    await expect(page.locator("dialog.workspace-dialog[open]")).toHaveCount(1, { timeout: 30000 });
    const unlock = page
        .locator("dialog.workspace-dialog[open]")
        .getByRole("button", { name: /Unlock/i })
        .first();
    await expect(unlock).toBeVisible({ timeout: 30000 });
    await unlock.click();
    await expect(page.locator(".rail-access li").filter({ hasText: "Decrypt values" })).toHaveClass(/granted/, {
        timeout: 90000,
    });

    // A signature taken on the wrong chain is what the wallet answers with CHAIN_ID_MISMATCH
    assert.equal(await chainOf(), SEPOLIA, "A drifted wallet is put back on Sepolia before it is asked to sign");
    assert.equal(wallet.calls.typedData, 1, "The identity is derived once, the published key proves the signer stable");
    assert.deepEqual(
        wallet.calls.addedChains,
        [sepolia.id, sepolia.id],
        "A wallet that lost Sepolia is given it again",
    );

    // A wallet keeps the endpoint it is handed, so it has to be one this app is willing to read through
    const added = wallet.calls.addParams.at(-1);
    assert.equal(added.chainId, SEPOLIA, "The add names Sepolia");
    assert.ok(added.rpcUrls?.[0]?.startsWith("http"), "The add carries a usable RPC url");
    assert.ok(!added.rpcUrls[0].includes("thirdweb"), "The add does not hand the wallet viem's third party default");
    assert.ok(
        added.nativeCurrency?.symbol?.length >= 1 && added.nativeCurrency.symbol.length <= 6,
        "The symbol is within the 1 to 6 characters a wallet will accept",
    );
    await page.screenshot({ path: `${output}/chain-unlocked.png`, animations: "disabled" });
    checks.push("a wallet moved off Sepolia behind the app's back is switched back before anything is signed");

    assert.deepEqual(errors, [], "The browser must not have runtime errors");
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
    await browser.close();
}
