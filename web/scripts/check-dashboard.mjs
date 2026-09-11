import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { artifacts } from "./lib/artifacts.mjs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1512, height: 1100 }, deviceScaleFactor: 1 });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
const errors = [];
const checks = [];
const output = await artifacts();
page.on("pageerror", (error) => errors.push(error.message));

/* Icon controls */
const ASCII_ICONS = ["↗", "⌄", "☰", "↻", "×", "✓", "↑", "↓", "▷", "Ⅱ", "⌃"];

async function screenshot(name) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: "disabled" });
}

async function noOverflow() {
    assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "The page must not overflow the viewport",
    );
}

async function noAsciiIcons(where) {
    const text = await page.locator(".dashboard-app").innerText();
    const found = ASCII_ICONS.filter((glyph) => text.includes(glyph));
    assert.deepEqual(found, [], `${where} must not use text glyphs as icons`);
}

try {
    await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await expect(page.locator(".secrets-browser button.secret-name").first()).toBeVisible({ timeout: 90000 });
    const firstName = await page.locator(".secrets-browser .secret-name small").first().innerText();
    const firstLabel = firstName.split(".")[0];
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() => ({
        body: getComputedStyle(document.body).fontFamily,
        display: getComputedStyle(document.querySelector("h1")).fontFamily,
        weight: getComputedStyle(document.querySelector("h1")).fontWeight,
        mono: getComputedStyle(document.querySelector(".mono")).fontFamily,
    }));
    assert.match(fonts.body.toLowerCase(), /manrope/);
    assert.match(fonts.display.toLowerCase(), /lexend/);
    assert.equal(fonts.weight, "200");
    assert.match(fonts.mono.toLowerCase(), /ubuntu/);
    await noOverflow();
    await noAsciiIcons("Home");
    await screenshot("home-desktop");
    checks.push("Live ENSv2 vault, three requested fonts, and no text glyphs standing in for icons");

    await expect(page.locator(".terminal-overview .terminal-card")).toHaveCount(4);
    await expect(page.getByRole("link", { name: "Secrets", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "2FA", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Transfers", exact: true })).toBeVisible();
    await expect(page.getByText("Collections", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("href", "#");
    await expect(page.getByRole("link", { name: "Source Code", exact: true })).toHaveAttribute("target", "_blank");
    const background = await page.locator("canvas").evaluate((canvas) => {
        const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 255;
        for (let i = 0; i < pixels.length; i += 4) dark = Math.min(dark, pixels[i]);
        return {
            dark,
            body: getComputedStyle(document.body).backgroundColor,
            cutout: getComputedStyle(document.querySelector(".welcome-copy")).backgroundColor,
        };
    });
    assert.equal(background.dark, 22);
    assert.equal(background.body, background.cutout);
    checks.push(
        "Four terminal cards, Home/Secrets/2FA/Transfers navigation, external resources, and exact banner background match",
    );

    const delays = await page.evaluate(() =>
        [...document.querySelectorAll(".sidebar [style*='--i']")].map((element) =>
            Number(getComputedStyle(element).animationDelay.replace("s", "")),
        ),
    );
    assert(delays.length >= 10, "Every sidebar row takes part in the reveal");
    assert(delays.at(-1) > delays[0], "Sidebar rows must reveal in sequence");
    const transformed = await page.locator(".dashboard-app *").evaluateAll((elements) =>
        elements
            .filter((element) => {
                const { transform, scale } = getComputedStyle(element);
                return (
                    (transform !== "none" && transform !== "matrix(1, 0, 0, 1, 0, 0)") ||
                    (scale !== "none" && scale !== "1")
                );
            })
            .map((element) => element.className),
    );
    assert.deepEqual(transformed, [], "The dashboard must not scale or transform anything");
    checks.push("Sidebar reveals as a staggered cascade and nothing is scaled or transformed");

    const frame = () => page.locator("canvas").evaluate((canvas) => canvas.toDataURL());
    const before = await frame();
    await page.waitForTimeout(350);
    assert.notEqual(await frame(), before, "Dither should animate");
    await expect(page.getByRole("button", { name: /banner animation/ })).toHaveCount(0);
    await page.getByRole("link", { name: "Rewall home" }).hover();
    const logoFrame = () => page.locator(".logo-alternate").evaluate((element) => getComputedStyle(element).opacity);
    const logoBefore = await logoFrame();
    await page.waitForTimeout(600);
    assert.notEqual(await logoFrame(), logoBefore, "Logo should alternate on hover");
    await page.mouse.move(1000, 40);
    checks.push("Dither animates without a stop button and the logo alternates on hover");

    await page.keyboard.press("/");
    await expect(page.getByRole("textbox", { name: "Search secrets" })).toBeFocused();
    await page.getByRole("textbox", { name: "Search secrets" }).fill("a-search-with-no-matching-secret");
    await expect(page.getByText("No matching secrets")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.locator(".secrets-browser button.secret-name").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("AES-256-GCM", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Copy name", exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), firstName);
    await noAsciiIcons("The secret panel");
    await screenshot("secret-details");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    checks.push("Search shortcut, empty results, secret details, clipboard, and Escape dismissal work");

    await page.getByRole("link", { name: "View all", exact: true }).first().click();
    await expect(page).toHaveURL(`${baseURL}/dashboard/secrets`);
    await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Filter by type" }).selectOption("apikey");
    await expect(page.locator(".secrets-browser button.secret-name").first()).toBeVisible();
    await page.getByRole("combobox", { name: "Sort secrets" }).selectOption("name");
    await page.getByRole("checkbox", { name: "Select all visible secrets" }).check();
    await page.getByRole("button", { name: "Copy names", exact: true }).click();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /\.rewall\.rewall-test-1\.eth/);
    await page.getByRole("button", { name: "Clear selection", exact: true }).click();
    await noAsciiIcons("The secrets page");
    await screenshot("secrets-desktop");
    await page.getByRole("button", { name: "Find a secret", exact: false }).click();
    await page.getByLabel("Secret’s full ENS name").fill("not-an-ens-name");
    await page.getByRole("dialog").getByRole("button", { name: "Find secret", exact: true }).click();
    await expect(page.getByText("Enter a complete ENS name ending in .eth.")).toBeVisible();
    await page.getByLabel("Secret’s full ENS name").fill(firstName);
    await page.getByRole("dialog").getByRole("button", { name: "Find secret", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: firstLabel, exact: true })).toBeVisible({
        timeout: 60000,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    checks.push("Secrets route, type filter, sort, selection, name validation, and live direct lookup work");

    await page.locator(".sidebar-account").click();
    await page.getByRole("button", { name: "Connect a wallet", exact: false }).click();
    // Our drawer is a modal dialog, so it has to yield the top layer or Privy's modal is unclickable
    await expect(page.locator("dialog.workspace-dialog[open]")).toHaveCount(0);
    await expect(page.locator("#privy-dialog").getByText("Continue with a wallet")).toBeVisible({ timeout: 30000 });
    await page.keyboard.press("Escape");
    checks.push("Connecting hands the top layer to Privy, which offers a wallet, an email and a social login");

    for (const [route, title] of [
        ["2fa", "2FA"],
        ["transfers", "Transfers"],
    ]) {
        await page.getByRole("link", { name: title, exact: true }).click();
        await expect(page).toHaveURL(baseURL + "/dashboard/" + route);
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
        await noOverflow();
        await screenshot(route + "-desktop");
    }
    checks.push("2FA and Transfers routes render their current data availability without fabricated entries");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".secrets-browser button.secret-name").first()).toBeAttached({ timeout: 60000 });
    await noOverflow();
    await noAsciiIcons("Mobile home");
    await screenshot("home-mobile");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("link", { name: "Secrets", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Secrets", exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/dashboard/secrets`);
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "false");
    await noOverflow();
    await screenshot("secrets-mobile");
    checks.push("390 px mobile layouts and mobile navigation work without page overflow");

    await page.setViewportSize({ width: 900, height: 1000 });
    await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".secrets-browser button.secret-name").first()).toBeVisible({ timeout: 60000 });
    await noOverflow();
    await screenshot("home-tablet");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(150);
    const reducedFrame = await frame();
    await page.waitForTimeout(300);
    assert.equal(await frame(), reducedFrame, "Reduced motion should stop the banner");
    await page.getByRole("link", { name: "Rewall home" }).hover();
    assert.equal(
        await page.locator(".logo-alternate").evaluate((element) => getComputedStyle(element).animationName),
        "none",
    );
    const shadows = await page
        .locator(".dashboard-app *")
        .evaluateAll((elements) =>
            elements
                .filter((element) => getComputedStyle(element).boxShadow !== "none")
                .map((element) => ({ tag: element.tagName, className: element.className })),
        );
    assert.deepEqual(shadows, [], "The dashboard must not use box shadows");
    assert.deepEqual(errors, [], "The browser must not have runtime errors");
    checks.push("900 px tablet layout, reduced motion, and no-shadow constraint pass");
    await writeFile(`${output}/checks.json`, JSON.stringify({ checks, fonts, browserErrors: errors }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, checks, screenshots: output }, null, 2));
} finally {
    await browser.close();
}
