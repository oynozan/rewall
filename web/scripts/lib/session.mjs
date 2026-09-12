// The dashboard shows the connected wallet and nobody else, so every check has to sign in before it sees anything

import { expect } from "@playwright/test";

// Privy is not listening until it has loaded, so the click is retried rather than waited on once
export async function connectWallet(page) {
    const walletRow = page.getByText("Continue with a wallet");
    const gate = page.getByRole("complementary", { name: "Connect to Rewall" });

    // Disconnected always means the gate, so waiting for it beats racing the sidebar drawer for the top layer
    await expect(gate).toBeVisible({ timeout: 90000 });
    for (let attempt = 0; attempt < 12; attempt++) {
        await gate
            .getByRole("button")
            .click({ timeout: 10000 })
            .catch(() => {});
        if (await walletRow.isVisible({ timeout: 6000 }).catch(() => false)) break;
    }

    await expect(walletRow).toBeVisible({ timeout: 30000 });
    await walletRow.click();
    await page.getByText("Rewall Test Wallet").first().click();
}

// Reverse resolution is empty on Sepolia, so an owner on a fresh browser says which name is theirs
export async function claimVault(page, name) {
    const claimField = page.getByLabel("Or name one you already own");
    if (!(await claimField.isVisible({ timeout: 2000 }).catch(() => false))) {
        const fromGate = page.getByRole("button", { name: "I already own a name" });
        if (await fromGate.isVisible({ timeout: 30000 }).catch(() => false)) await fromGate.click();
        else await page.locator(".sidebar-vault, .workspace-switcher").click();
    }
    await claimField.fill(name);
    await page.getByRole("button", { name: "This one is mine", exact: true }).click();
}

export async function openOwnVault(page, { url, address, name }) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await connectWallet(page);
    await expect(page.locator(".sidebar-account")).toContainText(address, { timeout: 60000 });
    await claimVault(page, name);

    // The sidebar naming the vault is the signal, since a vault that holds nothing is still a vault
    await expect(page.locator(".sidebar-vault strong, .workspace-switcher strong")).toHaveText(name, {
        timeout: 90000,
    });
    await expect(page.getByRole("complementary", { name: "Set up your vault" })).toHaveCount(0);
}
