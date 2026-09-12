import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { artifacts } from "./lib/artifacts.mjs";

const origin = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const output = await artifacts();
const errors = [];
const stubs = {
    "next/image":
        'import {createElement} from "react";export default function Image({unoptimized,...props}){return createElement("img",props)}',
    "next/navigation":
        'export const useRouter=()=>({push(){}});export const usePathname=()=>"/dashboard";export const useSearchParams=()=>new URLSearchParams(window.location.search);',
    "./dashboard-shell":
        'export const useWorkspace=()=>({ready:true,busy:false,ownName:"",connect(){},account:window.fixture.account,setPanel:()=>window.panelOpened=true});',
    "./liquid-metal-button":
        'import {createElement} from "react";export const LiquidMetalButton=({label,onClick,type,className})=>createElement("button",{className:"button primary "+(className||""),type:type||"button",onClick},label);',
    "./identity":
        'export const useIdentity=()=>({unlocked:window.fixture.unlocked,fingerprint:"new-key",publicKey:"replacement-key",unlock:async()=>{},write:async(fn)=>fn({guardians:{collect:async()=>[],recover:async()=>({fingerprint:"recovered-key"}),approve:async()=>{}}})});',
    "@/src/lib/vault": 'export const ownerName=n=>n;export const UNIVERSAL_RESOLVER="";export const vaultClient={};',
    "@/src/lib/account": "export const ownsName=async()=>true;",
    "@/src/lib/errors": "export const explain=e=>e.message;",
    "@rewall/sdk":
        'export const RECORD={guardians:"guardians",recoveryThreshold:"threshold",pubkey:"key",reshare:()=>"share"};export const splitNames=s=>(s||"").split(",").filter(Boolean);export const fromBase64=s=>s;export const readTexts=async(c,r,name,keys)=>keys.includes("guardians")?{guardians:"alice.eth,bob.eth,carol.eth",threshold:"2"}:keys.includes("key")?{key:"replacement-key"}:{share:(window.fixture.approved||name==="alice.eth")?"approved":""};',
};
const bundle = await build({
    stdin: {
        contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {HomeOnboarding} from './src/components/dashboard/home-onboarding';import {GateBanner} from './src/components/dashboard/connect-gate';import {RecoveryPage} from './src/components/dashboard/recovery';const root=document.getElementById('workspace-content');root.querySelector('.tour-restart')?.remove();const html=root.innerHTML;createRoot(root).render(window.fixture.recovery?<RecoveryPage/>:<HomeOnboarding><GateBanner/><div dangerouslySetInnerHTML={{__html:html}}/></HomeOnboarding>);`,
        resolveDir: process.cwd(),
        loader: "tsx",
    },
    bundle: true,
    write: false,
    outdir: "tour-out",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
        {
            name: "ui-fixture",
            setup(b) {
                b.onResolve({ filter: /.*/ }, (a) =>
                    a.path in stubs ? { path: a.path, namespace: "stub" } : undefined,
                );
                b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
                    contents: stubs[a.path],
                    loader: "js",
                    resolveDir: process.cwd(),
                }));
            },
        },
    ],
});
const html = (await (await fetch(origin + "/dashboard")).text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const css = await readFile("src/app/dashboard/dashboard.css", "utf8");
async function open(width, fixture = {}, query = "") {
    const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: fixture.motion || "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => {
        errors.push(e.message);
        console.log("PAGE ERROR", e.message);
    });
    await page.route(origin + "/dashboard**", (route) => route.fulfill({ contentType: "text/html", body: html }));
    await page.goto(origin + "/dashboard" + query, { waitUntil: "domcontentloaded" });
    await page.addStyleTag({
        content: css + bundle.outputFiles[1].text + ' [style*="opacity:0"]{opacity:1!important}',
    });
    await page.evaluate((f) => {
        window.fixture = f;
        document.querySelectorAll("[style]").forEach((e) => {
            if (e.style.opacity === "0") e.style.opacity = "1";
        });
    }, fixture);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => document.fonts.ready);
    return { page, context };
}
try {
    for (const width of [1440, 390]) {
        const { page, context } = await open(width, { account: "0x1" });
        const card = page.locator(".tour-card");
        await expect(card).toBeVisible();
        await expect(card.locator("h2")).toBeFocused();
        for (let step = 0; step < 5; step++) {
            await expect(card.locator("header .mono")).toHaveText(String(step + 1).padStart(2, "0") + " / 05");
            assert.equal(new URL(page.url()).pathname, "/dashboard");
            await page.waitForTimeout(250);
            const box = await card.boundingBox();
            assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 900);
            assert(await page.evaluate(() => document.querySelector(".dashboard-app").inert));
            await page.screenshot({ path: output + "/tour-" + width + "-" + step + ".png" });
            await card.getByRole("button", { name: step === 4 ? "Done" : "Next", exact: true }).click();
        }
        await expect(card).toHaveCount(0);
        assert.equal(await page.evaluate(() => localStorage.getItem("rewall:onboarding:v1")), "done");
        assert.equal(await page.evaluate(() => document.querySelector(".dashboard-app").inert), false);
        await page.reload();
        await page.evaluate(() => {
            window.fixture = { account: "0x1" };
            document.querySelectorAll("[style]").forEach((e) => {
                if (e.style.opacity === "0") e.style.opacity = "1";
            });
        });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.waitForTimeout(1000);
        await expect(card).toHaveCount(0);
        const restart = page.getByRole("button", { name: "Restart the tour", exact: true });
        await expect(restart).toBeVisible();
        const restartBox = await restart.boundingBox();
        assert.equal(restartBox.width, 44);
        assert.equal(restartBox.height, 44);
        assert(width - restartBox.x - restartBox.width <= 24);
        assert(900 - restartBox.y - restartBox.height <= 24);
        await page.screenshot({ path: output + "/tour-restart-" + width + ".png" });
        await restart.click();
        await expect(card.locator("h2")).toHaveText("Set up your vault");
        await expect(restart).toBeHidden();
        await card.getByRole("button", { name: "Skip", exact: true }).click();
        await expect(restart).toBeFocused();
        assert.equal(new URL(page.url()).pathname, "/dashboard");
        await context.close();
        console.log("Tour completes on Home and persists at", width);
    }
    const { page: skip, context: skipContext } = await open(1440, { motion: "no-preference", account: "0x1" });
    await expect(skip.locator(".tour-card")).toBeVisible();
    await skip.keyboard.press("Shift+Tab");
    await expect(skip.getByRole("button", { name: "Next", exact: true })).toBeFocused();
    await skip.keyboard.press("Tab");
    await expect(skip.getByRole("button", { name: "Skip", exact: true })).toBeFocused();
    await skip.getByRole("button", { name: "Next", exact: true }).click();
    await expect(skip.locator(".tour-card h2")).toHaveText("Choose your vault");
    await skip.getByRole("button", { name: "Back", exact: true }).click();
    await expect(skip.locator(".tour-card h2")).toHaveText("Set up your vault");
    await skip.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(skip.locator(".tour-card")).toHaveCount(0);
    assert.equal(await skip.evaluate(() => localStorage.getItem("rewall:onboarding:v1")), "done");
    await skipContext.close();
    for (const width of [1440, 390])
        for (const state of ["disconnected", "locked", "waiting", "ready", "guardian"]) {
            const { page, context } = await open(
                width,
                {
                    recovery: true,
                    account: state !== "disconnected" ? "0x123" : "",
                    unlocked: !["disconnected", "locked"].includes(state),
                    approved: state === "ready",
                },
                state === "guardian" ? "?approve=owner.eth&key=new-key" : "",
            );
            await expect(page.getByRole("heading", { name: "Recovery", exact: true })).toBeVisible();
            if (["waiting", "ready"].includes(state)) {
                await page.getByLabel("Vault ENS name").fill("owner.eth");
                await expect(page.locator(".recovery-guardians li")).toHaveCount(3);
                if (state === "waiting")
                    await expect(page.getByRole("button", { name: "Recover this vault" })).toBeDisabled();
                else {
                    await page.getByRole("button", { name: "Recover this vault" }).click();
                    await expect(page.getByText("Access recovered")).toBeVisible();
                }
            }
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await page.screenshot({ path: output + "/recovery-" + width + "-" + state + ".png", fullPage: true });
            await context.close();
        }
    assert.deepEqual(errors, []);
    console.log("Recovery states, responsive layout, keyboard trapping and Escape passed. Artifacts:", output);
} finally {
    await browser.close();
}
