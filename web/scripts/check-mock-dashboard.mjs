import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const fixture = await build({
    entryPoints: ["scripts/dashboard-mocks.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
});
const { mockSecrets, mockOtpAccounts, mockTransfers, mockVolume, mockVault } = await import(
    "data:text/javascript;base64," + Buffer.from(fixture.outputFiles[0].text).toString("base64")
);
const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
});
const context = await browser.newContext({ viewport: { width: 1680, height: 1100 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
const errors = [];
const rpc = [];
const checks = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
    if (request.url().includes("publicnode.com")) rpc.push(request.url());
});
const origin = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const output = "artifacts/dashboard";
await mkdir(output, { recursive: true });
async function capture(name) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: "disabled" });
}
async function noOverflow() {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Page must fit the viewport");
}
async function tableGeometry() {
    for (const selector of [".otp-table", ".transfer-table"]) {
        const geometry = await page.locator(selector).evaluateAll((tables) =>
            tables.map((table) => {
                const cells = (row) =>
                    [...row.cells].map((cell) => {
                        const box = cell.getBoundingClientRect();
                        return { x: box.x, width: box.width };
                    });
                return { headers: cells(table.tHead.rows[0]), rows: [...table.tBodies[0].rows].map(cells) };
            }),
        );
        for (const table of geometry) {
            assert.equal(table.headers.length, selector === ".otp-table" ? 4 : 3);
            for (const row of table.rows) {
                assert.equal(row.length, table.headers.length);
                row.forEach((cell, index) => {
                    assert(Math.abs(cell.x - table.headers[index].x) < 0.5, selector + " cell/header x");
                    assert(Math.abs(cell.width - table.headers[index].width) < 0.5, selector + " cell/header width");
                });
            }
        }
        if (selector === ".transfer-table" && geometry.length === 2) {
            geometry[0].headers.forEach((cell, index) => {
                assert(Math.abs(cell.x - geometry[1].headers[index].x) < 0.5, "Sent/shared column x");
                assert(Math.abs(cell.width - geometry[1].headers[index].width) < 0.5, "Sent/shared column width");
            });
        }
    }
    if (await page.locator(".otp-table").count()) {
        await expect(page.locator(".otp-table th").nth(1)).toHaveText("Code");
        await expect(page.locator(".otp-table th").nth(2)).toHaveText("Expires in");
    }
}
async function cardGeometry(width) {
    const boxes = await Promise.all(
        ["secrets-card", "otp-card", "transfers-card", "volume-card"].map((name) =>
            page.locator(".terminal-overview > ." + name).boundingBox(),
        ),
    );
    const [secrets, otp, transfers, chart] = boxes;
    const close = (a, b) => assert(Math.abs(a - b) < 1, "Card edges must align");
    close(secrets.y, otp.y);
    close(secrets.x, transfers.x);
    close(otp.x + otp.width, transfers.x + transfers.width);
    assert(transfers.y >= secrets.y + secrets.height);
    if (width > 760) {
        close(chart.y, secrets.y);
        close(chart.y + chart.height, transfers.y + transfers.height);
        assert(chart.x >= otp.x + otp.width - 0.5);
    } else {
        close(chart.x, transfers.x);
        close(chart.width, transfers.width);
        assert(chart.y >= transfers.y + transfers.height);
    }
}
try {
    await page.goto(origin + "/dashboard", { waitUntil: "networkidle", timeout: 120000 });
    await expect(page.locator(".workspace-switcher strong")).toContainText(mockVault.owner);
    await expect(page.locator(".workspace-switcher small")).toContainText("Mock preview");
    await expect(page.locator(".otp-code")).toHaveCount(mockOtpAccounts.length);
    await expect(page.locator(".otp-code").first()).toBeEnabled();
    const cards = page.locator(".terminal-overview .terminal-card");
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0).locator(".terminal-value")).toHaveText(String(mockSecrets.length).padStart(2, "0"));
    await expect(cards.nth(1).locator(".terminal-value")).toHaveText(String(mockOtpAccounts.length).padStart(2, "0"));
    await expect(cards.nth(2).locator("h2")).toHaveText("Confidential Transfers");
    await expect(cards.nth(2).locator("strong").first()).toHaveText(String(mockTransfers.sent.length).padStart(2, "0"));
    await expect(cards.nth(2).locator("strong").last()).toHaveText(
        String(mockTransfers.shared.length).padStart(2, "0"),
    );
    await expect(page.getByText("Confidential receipts", { exact: true })).toHaveCount(0);
    await expect(page.locator(".chart-sent")).toHaveCount(1);
    await expect(page.locator(".chart-shared")).toHaveCount(1);
    await expect(page.locator(".volume-legend")).toContainText(mockVolume.sentTotal);
    await expect(page.locator(".volume-legend")).toContainText(mockVolume.sharedTotal);
    const labelFonts = await page
        .locator(".terminal-card h2,.section-heading h2,.account-rail h2,.nav-caption")
        .evaluateAll((elements) =>
            elements.map((el) => ({ font: getComputedStyle(el).fontFamily, weight: getComputedStyle(el).fontWeight })),
        );
    assert(labelFonts.every((style) => /lexend/i.test(style.font) && style.weight === "200"));
    await expect(page.locator(".welcome-copy")).toHaveCSS("border-top-right-radius", "32px");
    assert((await page.locator(".volume-plot").boundingBox()).height >= 160);
    await expect(page.locator(".chart-y-axis span")).toHaveCount(4);
    for (const direction of ["sent", "shared"]) {
        const sum = mockTransfers[direction].reduce(
            (total, row) => total + Number(row.amount.replaceAll(",", "").split(" ")[0]),
            0,
        );
        assert.equal(
            sum,
            mockVolume.points.reduce((total, point) => total + point[direction], 0),
        );
    }
    checks.push("Mock cards, tables, and 30-day chart totals agree; no RPC requests");
    checks.push(
        "Lexend 200 section labels, preserved 32px corner, taller chart with y-axis labels, and no redundant card footer",
    );
    await tableGeometry();
    await cardGeometry(1680);
    await expect(page.locator(".wallet-connect .glyph")).toHaveCount(1);
    await expect(page.locator(".sidebar-account .wallet-chevron .glyph")).toHaveCount(1);
    const rail = page.getByRole("complementary", { name: "Account and vault" });
    await expect(rail).toHaveCSS("position", "sticky");
    const railBox = await rail.boundingBox();
    const contentBox = await page.locator(".home-sections").boundingBox();
    assert(railBox.x >= contentBox.x + contentBox.width);
    await noOverflow();
    await capture("home-mock-desktop");
    await page.evaluate((y) => window.scrollTo(0, y), railBox.y + 100);
    await expect.poll(async () => Math.round((await rail.boundingBox()).y)).toBe(24);
    await page.screenshot({ path: output + "/home-mock-sticky.png", animations: "disabled" });
    checks.push("Right sidebar occupies its own column and sticks 24px from the top while scrolling");
    await page.evaluate(() => window.scrollTo(0, 0));
    const otp = page.locator(".otp-code").first();
    await otp.hover();
    await expect(otp.locator(".otp-tooltip")).toHaveCSS("opacity", "1");
    await otp.click();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^\d{6}$/);
    await expect(otp.locator(".otp-digits")).toHaveCSS("filter", "blur(0px)");
    await page.getByRole("link", { name: "2FA", exact: true }).click();
    await expect(page.locator(".otp-code")).toHaveCount(3);
    await expect(page.locator(".volume-card")).toHaveCount(0);
    await page.getByRole("button", { name: "Lock", exact: true }).first().click();
    await expect(page.locator(".otp-code")).toHaveCount(2);
    await tableGeometry();
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.locator(".otp-code")).toHaveCount(3);
    checks.push("Mock OTP accounts copy, lock, and unlock without a wallet signature");
    await page.getByRole("link", { name: "Transfers", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Transfers", exact: true })).toBeVisible();
    await expect(page.locator(".volume-card")).toHaveCount(0);
    const tables = page.locator(".transfers-page-tables > section");
    await expect(tables).toHaveCount(2);
    const first = await tables.first().boundingBox(),
        second = await tables.last().boundingBox();
    assert(second.y >= first.y + first.height);
    assert.equal(first.x, second.x);
    await expect(tables.first().locator("tbody tr")).toHaveCount(mockTransfers.sent.length);
    await expect(tables.last().locator("tbody tr")).toHaveCount(mockTransfers.shared.length);
    await tableGeometry();
    await capture("transfers-mock-desktop");
    checks.push("Transfers contains vertically stacked Sent and Shared tables with no chart");
    for (const width of [1280, 900, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(origin + "/dashboard", { waitUntil: "networkidle" });
        await expect(page.locator(".otp-code")).toHaveCount(3);
        await noOverflow();
        await tableGeometry();
        await cardGeometry(width);
        await capture("home-mock-" + width);
        if (width > 980) await expect(rail).toHaveCSS("position", "sticky");
        else await expect(rail).toHaveCSS("position", "static");
    }
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("link", { name: "Transfers", exact: true }).click();
    await noOverflow();
    await tableGeometry();
    await capture("transfers-mock-mobile");
    checks.push(
        "OTP headers and all row cells align, including locked rows; Sent and Shared columns match within 0.5px",
    );
    checks.push("Secrets and 2FA share the first row; transfers span underneath; chart spans both rows on desktop");
    checks.push("Desktop, tablet, and mobile layouts fit; sidebar stacks on narrow screens");
    assert.deepEqual(rpc, []);
    assert.deepEqual(errors, []);
    await writeFile(output + "/mock-checks.json", JSON.stringify({ checks, browserErrors: errors }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
    await browser.close();
}
