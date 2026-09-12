import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { artifacts } from "./lib/artifacts.mjs";

const output = await artifacts();
const bundle = await build({
    stdin: {
        contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{Select}from'./src/components/select';
    const options=['Secure note','API key','Password','Database URL','SSH key','Certificate','Private key','Seed phrase','OAuth token','Webhook','Env variable','Authenticator'].map((label,i)=>({value:String(i),label}));
    function App(){const [value,setValue]=useState('all');return <><div className="table-toolbar"><input placeholder="Search"/><Select compact aria-label="Filter by type" value={value} onValueChange={setValue} options={[{value:'all',label:'All types'},...options]}/><Select compact aria-label="Sort secrets" defaultValue="newest" options={[{value:'newest',label:'Newest first'},{value:'name',label:'Name A–Z'}]}/></div><p id="value">{value}</p><button id="open" onClick={()=>document.querySelector('dialog').showModal()}>Add secret</button><Select disabled aria-label="Disabled" options={options} defaultValue="0"/><dialog><form onSubmit={e=>e.preventDefault()}><label htmlFor="type">Type</label><Select id="type" name="type" defaultValue="0" options={options}/><button type="button" id="close" onClick={()=>document.querySelector('dialog').close()}>Close drawer</button></form></dialog></>};createRoot(document.getElementById('root')).render(<App/>);`,
        loader: "tsx",
        resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    outdir: output,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
});
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
    await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
    const head = await page
        .locator("head")
        .evaluate((el) => [...el.querySelectorAll('link[rel="stylesheet"],style')].map((e) => e.outerHTML).join(""));
    const cls = await page.locator("html").getAttribute("class");
    const bodyClass = await page.locator("body").getAttribute("class");
    await page.setContent(
        `<html class="${cls || ""}"><head>${head}</head><body class="${bodyClass || ""}"><style>body{padding:32px}#root{max-width:1000px;margin:auto}.table-toolbar{display:flex;gap:8px}input{flex:1;min-width:0;background:#1b1b1b;border:1px solid #3a3a3a;border-radius:6px;padding:8px}dialog{inset:0 0 0 auto;margin:0;width:380px;max-width:100vw;height:100vh;max-height:none;background:#1c1c1c;color:#ededeb;border:0;border-left:1px solid #3a3a3a;padding:24px}dialog::backdrop{background:#0009}form{display:grid;gap:12px;margin-top:120px}#open,#close{margin-block:24px;color:#eee}</style><div id="root"></div></body></html>`,
    );
    await page.addStyleTag({ content: bundle.outputFiles.find((f) => f.path.endsWith(".css")).text });
    await page.addScriptTag({ content: bundle.outputFiles.find((f) => f.path.endsWith(".js")).text });
    const filter = page.getByRole("combobox", { name: "Filter by type" });
    await filter.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.getByRole("option", { name: "All types", exact: true })).toBeFocused();
    await page.keyboard.type("pass", { delay: 40 });
    await expect(page.getByRole("option", { name: "Password", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(filter).toHaveText("Password");
    await expect(page.locator("#value")).toHaveText("2");
    await filter.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(filter).toBeFocused();
    await expect(page.getByRole("combobox", { name: "Disabled" })).toBeDisabled();
    await filter.click();
    await expect(page.getByRole("listbox")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: output + "/select-filter.png" });
    await page.mouse.click(20, 20);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.locator("#open").click();
    await page.getByLabel("Type", { exact: true }).click();
    await expect(page.locator('dialog [role="listbox"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog")).toBeVisible();
    await expect(page.getByLabel("Type", { exact: true })).toBeFocused();
    await page.getByLabel("Type", { exact: true }).click();
    await page.keyboard.press("End");
    await expect(page.getByRole("option", { name: "Authenticator", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Type", { exact: true })).toHaveText("Authenticator");
    assert.equal(await page.locator("form").evaluate((el) => new FormData(el).get("type")), "11");
    await page.getByLabel("Type", { exact: true }).click();
    await page.keyboard.press("Home");
    await expect(page.getByRole("option", { name: "Secure note", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.getByLabel("Type", { exact: true }).click();
        await expect(page.getByRole("listbox")).toHaveCSS("opacity", "1");
        const box = await page.getByRole("listbox").boundingBox();
        assert(box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 900);
        await page.screenshot({ path: output + "/select-drawer-" + width + ".png" });
        await page.keyboard.press("End");
        await expect(page.getByRole("option", { name: "Authenticator", exact: true })).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.getByLabel("Type", { exact: true })).toHaveText("Authenticator");
    }
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
        "PASS select keyboard, typeahead, controlled filter, disabled state, outside click, dialog Escape, form value, scrolling, viewport containment and screenshots",
    );
} finally {
    await browser.close();
}
