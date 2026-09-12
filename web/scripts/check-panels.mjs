// Measures every label against the control it names, in every panel, because a nested label drops its margin silently

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

// Below this a label reads as part of the box under it, which is the bug this exists to catch
const MIN_GAP = 6;

const PANELS = [
    { name: "Store a secret", url: "/dashboard/secrets", button: "Store a secret" },
    { name: "Find a secret", url: "/dashboard/secrets", button: "Find a secret" },
    { name: "Add an authenticator", url: "/dashboard/2fa", button: "Add account" },
    { name: "Deposit", url: "/dashboard/transfers", button: "Deposit" },
    { name: "Take funds out", url: "/dashboard/transfers", button: "Withdraw" },
    { name: "Send confidential transfer", url: "/dashboard/transfers", button: "Send confidential transfer" },
    { name: "Your vault", url: "/dashboard", locator: ".sidebar-vault" },
    { name: "Your wallet", url: "/dashboard", locator: ".sidebar-account" },
    { name: "A stored secret", url: "/dashboard/secrets", locator: ".secrets-browser button.secret-name" },
];

/* Geometry */

// Read from the rendered boxes rather than the stylesheet, since the bug is a margin the layout throws away
const measure = () =>
    [...document.querySelectorAll(".panel-content label")].map((label) => {
        const text = (label.textContent || "").trim().slice(0, 40);
        const wrapped = label.querySelector("input, select, textarea");
        const control = label.htmlFor ? document.getElementById(label.htmlFor) : wrapped;
        const box = label.getBoundingClientRect();
        if (!box.height) return { text, state: "hidden" };
        if (!control) return { text, state: "orphan" };

        // A label wrapping its own control puts them side by side, so there is no gap to measure
        if (wrapped) return { text, state: "wraps" };

        const under = control.getBoundingClientRect();
        if (!under.height) return { text, state: "hidden" };
        return { text, state: "measured", gap: Math.round(under.top - box.bottom) };
    });

// A disclosure that opens a section and then touches it reads as that section's first line, not a control
const measureDisclosures = () =>
    [...document.querySelectorAll('.panel-content button[aria-expanded="true"]:not([role="combobox"])')]
        .map((button) => {
            const revealed = button.nextElementSibling?.querySelector("label") || button.nextElementSibling;
            if (!revealed) return null;
            const box = button.getBoundingClientRect();
            const below = revealed.getBoundingClientRect();
            if (!box.height || !below.height) return null;
            return { text: (button.textContent || "").trim().slice(0, 40), gap: Math.round(below.top - box.bottom) };
        })
        .filter(Boolean);

const browser = await chromium.launch({ executablePath });
const wallet = headlessWallet({ mnemonic: process.env.REWALL_TEST_MNEMONIC, addressIndex: 0 });
const context = await browser.newContext({ baseURL, viewport: { width: 1512, height: 1100 } });
const page = await context.newPage();
const vaultReady = page.locator(".sidebar-vault strong, .workspace-switcher strong");

await skipTour(page);
await attachWallet(page, wallet);
await openOwnVault(page, { url: `${baseURL}/dashboard`, address: wallet.address.slice(0, 6), name: OWNER });

const checked = [];
const skipped = [];
const tight = [];
const orphans = [];

for (const panel of PANELS) {
    await page.goto(`${baseURL}${panel.url}`);

    // Half these triggers only exist once the vault says it is the caller's, so the page is waited out first
    await expect(vaultReady).toHaveText(OWNER, { timeout: 90000 });
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 90000 });

    const trigger = panel.button
        ? page.getByRole("button", { name: panel.button, exact: true })
        : page.locator(panel.locator).first();

    // waitFor rather than isVisible, which answers from the current frame and calls a late trigger missing
    const appears = (locator) =>
        locator.waitFor({ state: "visible", timeout: 60000 }).then(
            () => true,
            () => false,
        );

    if (!(await appears(trigger))) {
        skipped.push(`${panel.name}, its trigger never appeared`);
        continue;
    }

    await trigger.click();
    if (!(await appears(page.locator(".panel-content")))) {
        skipped.push(`${panel.name}, the trigger opened no panel`);
        continue;
    }

    // A collapsed section is where this bug hides, and a Radix select trigger is not one of them
    const disclosures = page.locator('.panel-content button[aria-expanded]:not([role="combobox"])');
    for (let index = 0; index < (await disclosures.count()); index++) {
        const disclosure = disclosures.nth(index);
        if ((await disclosure.getAttribute("aria-expanded")) === "true") continue;
        if (
            !(await disclosure.click({ timeout: 10000 }).then(
                () => true,
                () => false,
            ))
        ) {
            skipped.push(`${panel.name}, a collapsed section would not open`);
            continue;
        }

        // The attribute is the render landing, so measuring after it beats measuring after the click
        await expect(disclosure).toHaveAttribute("aria-expanded", "true", { timeout: 10000 });
    }

    const labels = (await page.evaluate(measure)).filter((label) => label.state !== "hidden");
    if (!labels.length) {
        skipped.push(`${panel.name}, it holds no labelled field`);
        continue;
    }

    for (const label of labels) {
        if (label.state === "orphan") orphans.push(`${panel.name} · ${label.text}`);
        if (label.state !== "measured") continue;
        checked.push(`${panel.name} · ${label.text} · ${label.gap}px`);
        if (label.gap < MIN_GAP) tight.push(`${panel.name} · ${label.text} sits ${label.gap}px above its field`);
    }

    for (const disclosure of await page.evaluate(measureDisclosures)) {
        checked.push(`${panel.name} · ${disclosure.text} opens onto · ${disclosure.gap}px`);
        if (disclosure.gap < MIN_GAP) {
            tight.push(`${panel.name} · ${disclosure.text} sits ${disclosure.gap}px above what it opens`);
        }
    }

    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${output}/panel-${panel.name.replace(/\W+/g, "-").toLowerCase()}.png` });
}

await browser.close();

// Printed before the assertions, so a run that fails still says what it could and could not reach
console.log(JSON.stringify({ measured: checked.length, labels: checked, skipped, artifacts: output }, null, 2));

assert.deepEqual(tight, [], `labels sitting flat on their field\n${tight.join("\n")}`);
assert.deepEqual(orphans, [], `labels naming a control that is not there\n${orphans.join("\n")}`);
// The transfer panels need the rail running, so they are allowed to be skipped and these are not
const REQUIRED = ["Store a secret", "Find a secret", "Add an authenticator"];
const missed = REQUIRED.filter((name) => !checked.some((line) => line.startsWith(`${name} ·`)));
assert.deepEqual(missed, [], `these panels were never measured ${missed.join(", ")}`);
