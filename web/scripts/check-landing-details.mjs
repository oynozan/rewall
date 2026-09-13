import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { artifacts } from "./lib/artifacts.mjs";
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const output = await artifacts();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
    await page.goto(process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000", {
        waitUntil: "networkidle",
        timeout: 120000,
    });
    await page.evaluate(() => document.fonts.ready);
    for (const width of [1440, 1100, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(page.locator("[data-works] .wk-step")).toHaveCount(4);
        await page.locator("#flows").scrollIntoViewIfNeeded();
        const result = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth - innerWidth,
            labels: [...document.querySelectorAll(".fl-person")].map((el) => {
                const icon = el.querySelector("svg").getBoundingClientRect(),
                    label = el.querySelector("span").getBoundingClientRect();
                return { label: el.textContent.trim(), offset: label.x + label.width / 2 - icon.x - icon.width / 2 };
            }),
        }));
        assert.equal(result.overflow, 0);
        for (const label of result.labels) assert(Math.abs(label.offset) < 0.1, JSON.stringify(label));
        await expect(page.locator(".fl-twofactor .fl-slab b")).toHaveCount(0);
        await expect(page.getByText("Allowed model", { exact: true })).toBeVisible();
        if (width === 1440 || width === 390)
            for (const section of ["flows", "works"])
                await page
                    .locator("#" + section)
                    .screenshot({ path: output + "/landing-" + section + "-" + width + ".png" });
        console.log(
            "PASS",
            width,
            "px no overflow; labels centered within",
            Math.max(...result.labels.map((l) => Math.abs(l.offset))),
            "px",
        );
    }
    // The docs preview is there while a step is hovered or focused, gone otherwise, and stays inside its own section
    const display = () =>
        page
            .locator("[data-works] .wk-card")
            .nth(1)
            .evaluate((el) => getComputedStyle(el).display);
    async function preview() {
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        assert.equal(await display(), "none", "the card shows with nothing on its step");
        await page.locator("[data-works] .wk-step").nth(1).hover();
        await page.waitForTimeout(300);
        assert.equal(await display(), "flex", "the card did not show under the pointer");
        const fit = await page.evaluate(() => {
            const card = document.querySelectorAll("[data-works] .wk-card")[1].getBoundingClientRect();
            const section = document.getElementById("works").getBoundingClientRect();
            return {
                inside: card.bottom <= section.bottom,
                overflow: document.documentElement.scrollWidth - innerWidth,
            };
        });
        assert.ok(fit.inside, "an open card reaches past its own section");
        assert.equal(fit.overflow, 0);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        assert.equal(await display(), "none", "the card stayed after the pointer left");
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator("#works").scrollIntoViewIfNeeded();
    await expect(page.locator("[data-works] a[target=_blank][rel~=noreferrer]")).toHaveCount(4);
    for (const [index, side] of [
        [0, "left"],
        [3, "right"],
    ]) {
        await page.locator("[data-works] .wk-step").nth(index).hover();
        await page.waitForTimeout(300);
        const off = await page.evaluate(
            ([i, s]) => {
                const step = document.querySelectorAll("[data-works] .wk-step")[i];
                return Math.abs(
                    step.getBoundingClientRect()[s] - step.querySelector(".wk-card").getBoundingClientRect()[s],
                );
            },
            [index, side],
        );
        assert.ok(off < 0.5, `the ${side} card sits ${off}px off its step`);
    }
    await preview();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator("[data-works] .wk-step")).toHaveCount(4);
    await preview();
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log("Screenshots:", output);
} finally {
    await browser.close();
}
