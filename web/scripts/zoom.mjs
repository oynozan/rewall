import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const [url, name, selector] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1512, height: 1000 }, deviceScaleFactor: 4 });
await mkdir(".next/visual", { recursive: true });
try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(9000);
    await page
        .locator(selector)
        .first()
        .screenshot({ path: `.next/visual/${name}.png` });
    console.log("ok");
} finally {
    await browser.close();
}
