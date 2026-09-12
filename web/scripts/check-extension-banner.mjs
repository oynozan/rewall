import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { artifacts } from "./lib/artifacts.mjs";
const origin = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const output = await artifacts();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const code = await build({
    stdin: {
        contents: `import React from 'react';import{createRoot}from'react-dom/client';import{Toaster}from'sonner';import{ExtensionBanner}from'./src/components/dashboard/extension-banner';document.querySelectorAll('.extension-banner').forEach(el=>{const compact=el.classList.contains('extension-banner-compact');const mount=document.createElement('div');mount.style.display='contents';el.replaceWith(mount);createRoot(mount).render(<ExtensionBanner compact={compact}/>)});const toast=document.createElement('div');document.body.append(toast);createRoot(toast).render(<Toaster theme="dark" position="bottom-right" toastOptions={{className:'dashboard-toast'}}/>);`,
        resolveDir: process.cwd(),
        loader: "tsx",
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
        {
            name: "next-image",
            setup(b) {
                b.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "stub" }));
                b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
                    contents:
                        'import{createElement}from"react";export default function Image({unoptimized,...props}){return createElement("img",props)}',
                    resolveDir: process.cwd(),
                }));
            },
        },
    ],
});
const css = await readFile("src/app/dashboard/dashboard.css", "utf8");
const errors = [];
const chrome =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const firefox = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0";
const safari =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
try {
    for (const [route, width, ua, name] of [
        ["/dashboard", 1920, chrome, "Chrome"],
        ["/dashboard/2fa", 1440, firefox, "Firefox"],
        ["/dashboard", 1440, chrome, "Chrome"],
        ["/dashboard", 390, safari, null],
        ["/dashboard/2fa", 390, safari, null],
    ]) {
        const html = (await (await fetch(origin + route)).text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
        const context = await browser.newContext({ viewport: { width, height: 1000 }, userAgent: ua });
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        let downloads = 0;
        page.on("download", () => downloads++);
        await page.route(origin + route, (r) => r.fulfill({ contentType: "text/html", body: html }));
        await page.goto(origin + route, { waitUntil: "domcontentloaded" });
        await page.addStyleTag({ content: css + " .extension-banner {filter:none!important;opacity:1!important}" });
        await page.evaluate(() =>
            document.querySelectorAll("[style]").forEach((e) => {
                if (e.style.opacity === "0") e.style.opacity = "1";
            }),
        );
        await page.evaluate(() => document.querySelectorAll("[inert]").forEach((e) => e.removeAttribute("inert")));
        await page.addScriptTag({ content: code.outputFiles[0].text });
        await page.evaluate(() => document.fonts.ready);
        const banner = page.getByRole("complementary", { name: "2FA browser extension" });
        if (ua === safari) {
            await expect(banner).toHaveCount(0);
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await page.screenshot({ path: output + "/extension-mobile-" + route.split("/").pop() + ".png" });
            await context.close();
            console.log("Mobile hides desktop install prompt", route);
            continue;
        }
        await expect(banner).toBeVisible();
        await expect(banner.locator("button")).toHaveCount(name ? 1 : 2);
        if (name) await expect(banner.getByRole("button", { name: "Add to " + name })).toBeVisible();
        await banner.scrollIntoViewIfNeeded();
        const box = await banner.boundingBox();
        if (route === "/dashboard") {
            const table = await page.locator(".home-otp-table").boundingBox();
            if (width === 1920) assert(box.x >= table.x + table.width, "Desktop banner should be right of table");
            else assert(box.y >= table.y + table.height, "Narrow layouts should stack without squeezing the table");
        } else {
            const table = await page.locator(".page-search").boundingBox();
            assert(box.y + box.height <= table.y);
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const dots = await banner
            .locator("canvas")
            .evaluate(
                (c) =>
                    Array.from(c.getContext("2d").getImageData(0, 0, c.width, c.height).data).filter(
                        (v, i) => i % 4 === 3 && v > 0,
                    ).length,
            );
        assert(dots > 100);
        await page.screenshot({
            path: output + "/extension-" + route.split("/").pop() + "-" + width + "-" + (name || "fallback") + ".png",
        });
        await banner.locator("button").first().click();
        await expect(page.locator("[data-sonner-toast]")).toContainText("install link will be available soon.");
        assert.equal(page.url(), origin + route);
        assert.equal(downloads, 0);
        await context.close();
        console.log("Passed", route, width, name || "browser choices");
    }
    assert.deepEqual(errors, []);
    console.log("Extension checks passed. Screenshots:", output);
} finally {
    await browser.close();
}
