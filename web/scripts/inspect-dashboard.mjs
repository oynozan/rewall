import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1512, height: 1100 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await mkdir(".next/visual", { recursive: true });
try {
    await page.goto("http://127.0.0.1:3000/dashboard", { waitUntil: "networkidle", timeout: 120000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: ".next/visual/home-desktop.png", fullPage: true });
    console.log(JSON.stringify({ title: await page.title(), text: await page.locator("main").innerText(), errors }, null, 2));
} finally {
    await browser.close();
}
