import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const url = process.argv[2] || "http://127.0.0.1:3000/dashboard";
const name = process.argv[3] || "shot";
const width = Number(process.argv[4] || 1512);
const height = Number(process.argv[5] || 1000);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await mkdir(".next/visual", { recursive: true });
try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(9000);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `.next/visual/${name}.png`, fullPage: true });
    console.log(JSON.stringify({ errors, scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth), width }));
} finally {
    await browser.close();
}
