import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { artifacts } from "./lib/artifacts.mjs";
const origin = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const page = await browser.newPage();
const results = [];
page.on("pageerror", (e) => console.log(e.message));

try {
    for (const width of [1920, 1680, 1440, 1280, 1024, 900, 760, 390]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.goto(origin + "/dashboard", { waitUntil: "domcontentloaded" });
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator(".home-sections table")).toHaveCount(4, { timeout: 10000 });
        const data = await page.locator(".home-sections table").evaluateAll((tables) =>
            tables.map((table) => {
                const row = table.tHead.rows[0];
                const offset = table.classList.contains("secrets-table") ? 1 : 0;
                const x = (i) =>
                    row.cells[i].getBoundingClientRect().x + parseFloat(getComputedStyle(row.cells[i]).paddingLeft);
                const right =
                    row.cells[row.cells.length - 1].getBoundingClientRect().right -
                    parseFloat(getComputedStyle(row.cells[row.cells.length - 1]).paddingRight);
                return {
                    primary: x(offset),
                    secondary: x(offset + 1),
                    tertiary: offset === 1 || table.classList.contains("otp-table") ? x(offset + 2) : null,
                    right,
                    width: table.getBoundingClientRect().width,
                };
            }),
        );
        assert.equal(data.length, 4);
        for (const column of ["primary", "secondary", "right", "width"])
            assert(
                Math.max(...data.map((d) => d[column])) - Math.min(...data.map((d) => d[column])) < 0.5,
                JSON.stringify({ width, column, data }),
            );
        assert(Math.abs(data[0].tertiary - data[1].tertiary) < 0.5);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if ([1920, 1280, 390].includes(width))
            await page.screenshot({
                path: (await artifacts()) + "/live-shared-columns-" + width + ".png",
                fullPage: true,
                animations: "disabled",
            });
        results.push({ viewport: width, columns: data[0] });
        console.log("Aligned viewport", width);
    }
    console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally {
    await browser.close();
}
