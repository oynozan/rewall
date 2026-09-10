import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1512, height: 1100 }, deviceScaleFactor: 1 });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
const errors = [];
const checks = [];
const output = "artifacts/dashboard";
await mkdir(output, { recursive: true });
page.on("pageerror", (error) => errors.push(error.message));

/* Text glyphs that used to stand in for icons, none of them may come back */
const ASCII_ICONS = ["↗", "⌄", "☰", "↻", "×", "✓", "↑", "↓", "▷", "Ⅱ", "⌃"];

async function screenshot(name) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
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
    await expect(page.getByRole("button", { name: "View openai details" })).toBeVisible({ timeout: 90000 });
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

    const rail = page.getByRole("complementary", { name: "Account and vault" });
    await expect(rail).toBeVisible();
    const meters = rail.getByRole("progressbar");
    await expect(meters).toHaveCount(2);
    const secretRows = await page.getByRole("button", { name: /^View .* details$/ }).count();
    assert.equal(Number(await meters.first().getAttribute("aria-valuenow")), secretRows);
    assert.equal(Number(await meters.first().getAttribute("aria-valuemax")), 128);
    /* The bar has to have painted at least one segment for a non empty vault */
    const litSegments = await meters
        .first()
        .locator("span")
        .evaluateAll(
            (spans) => spans.filter((span) => getComputedStyle(span).backgroundColor !== "rgb(47, 47, 47)").length,
        );
    assert(litSegments > 0, "A non empty vault must light at least one progress segment");
    assert(await rail.getByText("Read metadata").isVisible(), "The rail must state what this viewer is allowed to do");
    checks.push("Account rail reports the live vault against the 128 name viewer limit and its access level");

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
    await page.getByRole("button", { name: "Pause banner animation" }).click();
    await page.waitForTimeout(100);
    const paused = await frame();
    await page.waitForTimeout(250);
    assert.equal(await frame(), paused, "Paused dither should stay still");
    await page.getByRole("button", { name: "Play banner animation" }).click();
    await page.getByRole("link", { name: "Rewall home" }).hover();
    const logoFrame = () => page.locator(".logo-alternate").evaluate((element) => getComputedStyle(element).opacity);
    const logoBefore = await logoFrame();
    await page.waitForTimeout(600);
    assert.notEqual(await logoFrame(), logoBefore, "Logo should alternate on hover");
    await page.mouse.move(1000, 40);
    checks.push("Dither animates and pauses, logo alternates on hover");

    await page.keyboard.press("/");
    await expect(page.getByRole("textbox", { name: "Search secrets" })).toBeFocused();
    await page.getByRole("textbox", { name: "Search secrets" }).fill("a-search-with-no-matching-secret");
    await expect(page.getByText("No matching secrets")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("button", { name: "View openai details" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("AES-256-GCM", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Copy name", exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "openai.rewall.rewall-test-1.eth");
    await noAsciiIcons("The secret panel");
    await screenshot("secret-details");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    checks.push("Search shortcut, empty results, secret details, clipboard, and Escape dismissal work");

    await page.getByRole("link", { name: "View all", exact: false }).click();
    await expect(page).toHaveURL(`${baseURL}/dashboard/secrets`);
    await expect(page.getByRole("heading", { name: "All secrets", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Filter by type" }).selectOption("apikey");
    await expect(page.getByRole("button", { name: "View openai details" })).toBeVisible();
    await page.getByRole("combobox", { name: "Sort secrets" }).selectOption("name");
    await page.getByRole("checkbox", { name: "Select all visible secrets" }).check();
    await page.getByRole("button", { name: "Copy names", exact: true }).click();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /openai\.rewall\.rewall-test-1\.eth/);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await noAsciiIcons("The secrets page");
    await screenshot("secrets-desktop");
    await page.getByRole("button", { name: "Find a secret", exact: false }).click();
    await page.getByLabel("Secret’s full ENS name").fill("not-an-ens-name");
    await page.getByRole("dialog").getByRole("button", { name: "Find secret", exact: true }).click();
    await expect(page.getByText("Enter a complete ENS name ending in .eth.")).toBeVisible();
    await page.getByLabel("Secret’s full ENS name").fill("openai.rewall.rewall-test-1.eth");
    await page.getByRole("dialog").getByRole("button", { name: "Find secret", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "openai", exact: true })).toBeVisible({
        timeout: 60000,
    });
    await page.keyboard.press("Escape");
    checks.push("Secrets route, type filter, sort, selection, name validation, and live direct lookup work");

    await page.locator(".sidebar-account").click();
    await page.getByRole("button", { name: "Connect MetaMask", exact: false }).click();
    await expect(
        page.getByText("MetaMask wasn’t found in this browser. Install the extension, then reload this page."),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    checks.push("Missing wallet is explained without simulating a connection");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "View openai details" })).toBeAttached({ timeout: 60000 });
    await noOverflow();
    await noAsciiIcons("Mobile home");
    await screenshot("home-mobile");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("link", { name: /All secrets/ })).toBeVisible();
    await page.getByRole("link", { name: /All secrets/ }).click();
    await expect(page).toHaveURL(`${baseURL}/dashboard/secrets`);
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "false");
    await noOverflow();
    await screenshot("secrets-mobile");
    checks.push("390 px mobile layouts and mobile navigation work without page overflow");

    await page.setViewportSize({ width: 900, height: 1000 });
    await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "View openai details" })).toBeVisible({ timeout: 60000 });
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
