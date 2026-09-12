import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { artifacts } from "./lib/artifacts.mjs";
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const output = await artifacts();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
    await page.goto(process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000", {
        waitUntil: "networkidle",
        timeout: 120000,
    });
    await page.evaluate(() => document.fonts.ready);
    const demo = page.locator("[data-secret-journey]");
    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1100 });
        await demo.scrollIntoViewIfNeeded();
        await expect(demo.getByRole("tab", { name: "03 Share" })).toBeDisabled();
        await expect(demo.getByRole("textbox", { name: "Example secret name" })).toHaveAttribute(
            "placeholder",
            "<key>",
        );
        await page.locator("#works").screenshot({ path: output + "/journey-name-" + width + ".png" });
        await demo.getByRole("textbox").fill("sample-key");
        await demo.getByRole("button", { name: "Seal secret", exact: true }).click();
        await expect(demo.locator('[data-sealed="true"]')).toBeVisible({ timeout: 60000 });
        await expect(demo.getByRole("tab", { name: "02 Seal" })).toHaveAttribute("aria-selected", "true");
        await expect(demo.getByLabel("Encrypted sample ciphertext")).toContainText(/^[0-9a-f]+$/);
        await demo
            .getByLabel("Encrypted sample ciphertext")
            .locator("span")
            .evaluateAll((els) => Promise.all(els.flatMap((el) => el.getAnimations().map((a) => a.finished))));
        const firstCipher = await demo.getByLabel("Encrypted sample ciphertext").textContent();
        assert.equal(firstCipher.length, 632);
        await expect(demo.getByRole("button", { name: "Choose readers" })).toBeEnabled();
        await page.locator("#works").screenshot({ path: output + "/journey-sealed-" + width + ".png" });
        await demo.getByRole("button", { name: "Choose readers" }).click();
        await demo.getByRole("button", { name: "Give bob.eth a key" }).click();
        await expect(demo.locator('[data-open="true"]')).toHaveCount(1);
        await expect(demo.locator('[data-open="true"] [aria-hidden="true"]')).toHaveText("sk_demo_8f2a");
        await expect(demo.locator('[data-open="false"]')).not.toContainText("sk_demo_8f2a");
        await expect(demo.getByRole("button", { name: "bob.eth has a key" })).toBeDisabled();
        await page.locator("#works").screenshot({ path: output + "/journey-shared-" + width + ".png" });
        await demo.getByRole("button", { name: "Give charlie.eth a key" }).click();
        await expect(demo.locator('[data-open="true"]')).toHaveCount(2);
        const keys = await demo.locator("code").allTextContents();
        assert.notEqual(keys[0], keys[1]);
        await demo.getByRole("tab", { name: "01 Name" }).click();
        await demo.getByRole("textbox").fill("different-name");
        await expect(demo.locator('[data-sealed="false"]')).toBeVisible();
        await expect(demo.getByRole("tab", { name: "03 Share" })).toBeDisabled();
        await demo.getByRole("textbox").press("Enter");
        await expect(demo.locator('[data-sealed="true"]')).toBeVisible();
        assert.notEqual(await demo.getByLabel("Encrypted sample ciphertext").textContent(), firstCipher);
        await demo.getByRole("button", { name: "Reset example" }).click();
        await expect(demo.getByRole("textbox")).toHaveValue("");
        await expect(demo.getByRole("tab", { name: "01 Name" })).toHaveAttribute("aria-selected", "true");
        await demo.getByRole("tab", { name: "01 Name" }).focus();
        await page.keyboard.press("ArrowRight");
        await expect(demo.getByRole("tab", { name: "02 Seal" })).toBeFocused();
        await page.keyboard.press("ArrowRight");
        await expect(demo.getByRole("tab", { name: "01 Name" })).toBeFocused();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
        console.log(
            "PASS",
            width,
            "name, SDK encryption, wrapped-key decryption, unselected reader, reset, rename and keyboard navigation",
        );
    }
    for (const width of [320, 768, 1100, 1920]) {
        await page.setViewportSize({ width, height: 1100 });
        await demo.getByRole("textbox").fill("long-example-label");
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
            0,
            width + " overflow",
        );
        await demo.getByRole("button", { name: "Reset example" }).click();
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await demo.getByRole("button", { name: "Seal secret", exact: true }).click();
    await expect(demo.locator('[data-sealed="true"]')).toBeVisible();
    const animations = await demo
        .getByLabel("Encrypted sample ciphertext")
        .locator("span")
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
    assert(animations.every((name) => name === "none"));
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log("PASS responsive overflow and reduced motion; screenshots", output);
} finally {
    await browser.close();
}
