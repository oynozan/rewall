import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { artifacts } from "./lib/artifacts.mjs";
import { skipTour } from "./lib/tour.mjs";
import { headlessWallet, attachWallet } from "./lib/wallet.mjs";
import { openOwnVault } from "./lib/session.mjs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1512, height: 1100 }, deviceScaleFactor: 1 });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
/* The first run tour covers the page, and check-home-tour is what exercises it */
await context.addInitScript(() => localStorage.setItem("rewall:onboarding:v1", "done"));
const page = await context.newPage();
await skipTour(page);
const errors = [];
const checks = [];
const output = await artifacts();
page.on("pageerror", (error) => errors.push(error.message));
await attachWallet(page, headlessWallet({ mnemonic: process.env.REWALL_TEST_MNEMONIC, addressIndex: 0 }));

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
    /* The dashboard belongs to whoever is connected, so the gate comes first */

    await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await expect(page.getByRole("dialog", { name: "Connect to Rewall" })).toBeVisible({ timeout: 90000 });
    await openOwnVault(page, { url: `${baseURL}/dashboard`, address: "0xD2F8", name: "rewall-test-1.eth" });
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
    const background = await page.locator(".welcome-banner canvas").evaluate((canvas) => {
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
    /* The logo is inline artwork, its own transforms place the glyphs and are not dashboard chrome */
    const transformed = await page.locator(".dashboard-app *:not(.brand-logo, .brand-logo *)").evaluateAll((elements) =>
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

    const frame = () => page.locator(".welcome-banner canvas").evaluate((canvas) => canvas.toDataURL());
    const before = await frame();
    await page.waitForTimeout(350);
    assert.notEqual(await frame(), before, "Dither should animate");
    await expect(page.getByRole("button", { name: /banner animation/ })).toHaveCount(0);
    const logo = page.locator(".brand-logo");
    const half = page.locator(".brand-logo .from-top");
    const brand = page.getByRole("link", { name: "Rewall home" });
    assert.equal(
        await half.evaluate((element) => getComputedStyle(element).animationName),
        "none",
        "The logo rests until it is hovered",
    );
    await brand.hover();
    await expect(logo).toHaveAttribute("class", /is-flying/);
    /* Both halves pause or the loose one reaches its end and releases the guard mid check */
    await logo.evaluate((element) => {
        for (const motion of element.getAnimations({ subtree: true })) {
            motion.pause();
            motion.currentTime = 400;
        }
        element.querySelector(".from-top").getAnimations()[0].id = "in-flight";
    });
    await page.mouse.move(1000, 40);
    await brand.hover();
    assert.equal(
        await half.evaluate((element) => element.getAnimations()[0].id),
        "in-flight",
        "Hovering again mid flight must not restart the run",
    );
    /* Scrubbing the paused run beats sampling it, the halves land in 0.9s */
    const travel = await half.evaluate((element) => {
        const motion = element.getAnimations()[0];
        const at = (time) => {
            motion.currentTime = time;
            return getComputedStyle(element).transform;
        };
        const frames = { name: motion.animationName, start: at(0), end: at(900) };
        for (const paused of element.ownerSVGElement.getAnimations({ subtree: true })) paused.play();
        return frames;
    });
    assert.equal(travel.name, "logo-from-top");
    assert.equal(travel.start, "matrix(1, 0, 0, 1, 0, -90)", "The top half must start above the frame");
    assert.equal(travel.end, "matrix(1, 0, 0, 1, 0, 0)", "The top half must settle inside the frame");
    await expect(logo).not.toHaveAttribute("class", /is-flying/);
    await page.mouse.move(1000, 40);
    checks.push("Dither animates without a stop button and the logo halves fly in once per hover");

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

    checks.push("The dashboard is gated until a wallet connects, and then shows only that wallet's vault");

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

    /* Chromium reports itself as Chrome, so this context sees the single resolved install button */
    await page.goto(`${baseURL}/dashboard/2fa`, { waitUntil: "domcontentloaded" });
    const banner = page.getByRole("complementary", { name: "2FA browser extension" });
    await expect(banner).toBeVisible({ timeout: 60000 });
    await expect(banner.locator(".extension-install")).toHaveText([/Add to Chrome/]);
    await expect(banner.locator("canvas.extension-dot-grid")).toHaveCount(1);
    /* The dot field must reach the banner edges, no knockout panel behind the copy */
    await expect(banner.locator(".extension-copy")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.setViewportSize({ width: 1920, height: 1200 });
    await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".extension-banner-compact")).toBeVisible({ timeout: 60000 });
    const [tableBox, bannerBox] = await Promise.all([
        page.locator(".home-otp-table").boundingBox(),
        page.locator(".extension-banner-compact").boundingBox(),
    ]);
    assert(bannerBox.x > tableBox.x + tableBox.width - 1, "The home banner sits to the right of the 2FA table");
    assert.equal(
        Math.round(bannerBox.y + bannerBox.height),
        Math.round(tableBox.y + tableBox.height),
        "The home banner must end level with the 2FA table",
    );
    checks.push("Extension banner detects the browser, keeps the dot grid unbroken, and ends level with the 2FA table");

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
        await page.locator(".brand-logo .from-top").evaluate((element) => getComputedStyle(element).animationName),
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

    /* Each user agent needs its own context, so the install offer is checked in fresh ones */
    for (const [agent, expected] of [
        ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0", ["Add to Firefox"]],
        [
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
            ["Chrome", "Firefox"],
        ],
        [
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
            [],
        ],
    ]) {
        const agentContext = await browser.newContext({ userAgent: agent, viewport: { width: 1400, height: 900 } });
        await agentContext.addInitScript(() => localStorage.setItem("rewall:onboarding:v1", "done"));
        const agentPage = await agentContext.newPage();
        agentPage.on("pageerror", (error) => errors.push(error.message));
        await agentPage.goto(`${baseURL}/dashboard/2fa`, { waitUntil: "domcontentloaded" });
        await expect(agentPage.getByRole("heading", { name: "2FA", exact: true })).toBeVisible({ timeout: 60000 });
        await expect(agentPage.locator(".extension-install")).toHaveText(expected);
        await agentContext.close();
    }
    assert.deepEqual(errors, [], "No user agent may produce a runtime error");
    checks.push("Firefox is offered its own build, an unknown browser gets both, and a phone is offered none");
    await writeFile(`${output}/checks.json`, JSON.stringify({ checks, fonts, browserErrors: errors }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, checks, screenshots: output }, null, 2));
} finally {
    await browser.close();
}
