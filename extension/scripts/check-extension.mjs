// Loads the built extension into a real browser and drives the parts that only exist once it is installed

import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import QRCode from "qrcode";

let passed = 0;
const pass = (message) => {
    passed++;
    console.log(`PASS  ${message}`);
};
const fail = (message) => {
    throw new Error(`FAIL  ${message}`);
};

// The published RFC 6238 account, so nothing here is anyone's real seed
const URI =
    "otpauth://totp/RFC%206238:Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=RFC%206238&digits=8&period=30";

const LOGIN = `<!doctype html><meta charset="utf-8"><title>Sign in</title>
<form><label for="code">Two-factor code</label>
<input id="code" name="otp" autocomplete="one-time-code" maxlength="8"></form>`;

const PLAIN = `<!doctype html><meta charset="utf-8"><title>Nothing</title><p>No code here`;

// A setup dialog shaped like the ones that ship it, small code on a light plate over a dark page
const CODED = (qr) => `<!doctype html><meta charset="utf-8"><title>Setup</title>
<body style="margin:0;background:#0d1117;padding:60px">
<div style="width:270px;height:270px;background:#d0d7de;border-radius:8px;display:grid;place-items:center">
<img id="qr" src="${qr}" style="width:200px;height:200px"></div>`;

/* A real origin, because the whole match is keyed on a hostname */

const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (request.url.startsWith("/code")) {
        const qr = new URL(request.url, "http://x").searchParams.get("qr") || "";
        return response.end(CODED(qr));
    }
    response.end(request.url === "/plain" ? PLAIN : LOGIN);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://localhost:${server.address().port}`;

const extension = join(process.cwd(), ".output", "chrome-mv3");
const profile = await mkdtemp(join(tmpdir(), "rewall-ext-"));

const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});

const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker", { timeout: 30000 }));
pass("the extension installs and its service worker starts");

const [, extensionId] = worker.url().match(/^chrome-extension:\/\/([a-z]+)\//) || [];

// A worker's own sendMessage never reaches its own listener, so an extension page is what asks it anything
const client = await context.newPage();
await client.goto(`chrome-extension://${extensionId}/popup.html`);
const ask = (message) => client.evaluate((sent) => chrome.runtime.sendMessage(sent), message);

/* Before pairing */

const fresh = await ask({ type: "rewall:state" });
if (fresh.paired || fresh.unlocked) fail(`a fresh install reported ${JSON.stringify(fresh)}`);
pass("a fresh install reports itself unpaired and locked");

const page = await context.newPage();
await page.goto(`${origin}/login`);
await page.waitForSelector("#code");

// The content script announces on its own, so the toolbar knows before anyone clicks
await page.waitForTimeout(600);
const tabId = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab.id;
});

const lockedPopup = await worker.evaluate((id) => chrome.action.getPopup({ tabId: id }), tabId);
if (!lockedPopup.endsWith("popup.html")) fail(`a locked extension staged ${lockedPopup} instead of the menu`);
pass("with no vault open, a code field still opens the menu rather than filling");

/* With a vault open */

// Written straight to storage, the way the popup writes it once it has read the vault
await worker.evaluate(async (uri) => {
    await chrome.storage.session.set({
        open: { name: "rewall-test-1.eth", secretKey: "", accounts: { localhost: { uri, label: "rfc-6238" } } },
    });
}, URI);
await page.waitForTimeout(800);

const armedPopup = await worker.evaluate((id) => chrome.action.getPopup({ tabId: id }), tabId);
const badge = await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
if (armedPopup !== "") fail(`a matching account staged ${armedPopup} instead of fill mode`);
if (badge !== "1") fail(`the badge read ${JSON.stringify(badge)}`);
pass("a matching account puts that tab into fill mode, so a click fills instead of opening the menu");

/* The toolbar staging, which used to live in the worker and vanish with it */

const parkedFields = await worker.evaluate(() => chrome.storage.session.get("fields"));
if (!Object.keys(parkedFields.fields ?? {}).length) fail("no tab was noted as holding a field");
pass("which tabs hold a code field is parked where a recycled worker still finds it");

// A worker that came back with nothing still has to stage the tab, which is the bug people actually hit
await worker.evaluate(() => chrome.storage.session.remove("fields"));
await page.bringToFront();
// Put back the way a tab looks when the note was lost before the vault ever opened, which is the real failure
await worker.evaluate((id) => chrome.action.setPopup({ tabId: id, popup: "popup.html" }), tabId);
const lostPopup = await worker.evaluate((id) => chrome.action.getPopup({ tabId: id }), tabId);
if (lostPopup === "") fail("the tab could not be put back into menu mode, so this proves nothing");

// Opening the popup is what says it again, the way it does after any recycle
await page.bringToFront();
await client.evaluate(() => chrome.runtime.sendMessage({ type: "rewall:seen", present: true }));

const restaged = await worker.evaluate((id) => chrome.action.getPopup({ tabId: id }), tabId);
if (restaged !== "") fail(`after saying so again the tab staged ${restaged} instead of fill mode`);
pass("a tab says so again when the popup opens, so fill mode comes back after a recycle");

/* The code itself, for the pages that refuse to be filled */

const shown = await client.evaluate(() => chrome.runtime.sendMessage({ type: "rewall:code", hostname: "localhost" }));
if (!/^\d{8}$/.test(shown.code)) fail(`the popup was given ${JSON.stringify(shown.code)}`);
if (!(shown.remaining > 0 && shown.remaining <= 30)) fail(`the code expires in ${shown.remaining}`);
pass(`a matching account can be read as ${shown.code.length} digits with ${shown.remaining}s left`);

const absent = await client.evaluate(() =>
    chrome.runtime.sendMessage({ type: "rewall:code", hostname: "nowhere.example" }),
);
if (absent.code) fail("a hostname with no account still produced a code");
pass("a hostname with no account produces no code");

/* A page with no field */

const plain = await context.newPage();
await plain.goto(`${origin}/plain`);
await plain.waitForTimeout(800);
const plainId = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab.id;
});
const plainPopup = await worker.evaluate((id) => chrome.action.getPopup({ tabId: id }), plainId);
if (!plainPopup.endsWith("popup.html")) fail(`a page with no code field staged ${plainPopup}`);
pass("a page with no code field opens the menu");

/* The popup itself */

const popup = await context.newPage();
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await popup.waitForSelector("#pair:not([hidden])", { timeout: 15000 });
pass("the popup offers to pair when nothing is paired yet");

const errors = [];
popup.on("pageerror", (error) => errors.push(error.message));
await popup.waitForTimeout(500);
if (errors.length) fail(`the popup threw ${errors.join(", ")}`);
pass("the popup raised no page errors");

/* Pairing, driven without the dashboard because the nonce is the only thing that makes a reply real */

const FAKE_KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, index) => index + 1)));

const forged = await ask({ type: "rewall:paired", nonce: "not-the-one", name: "attacker.eth", secretKey: FAKE_KEY });
if (forged.ok) fail("a reply carrying an unissued nonce was accepted");
if ((await ask({ type: "rewall:state" })).needsPassphrase) fail("an unissued nonce still staged a key");
pass("a pairing reply that carries no issued nonce is refused");

// pendingUrl, because rewall.me does not resolve yet and a failed tab keeps no URL worth reading
await worker.evaluate(() => {
    globalThis.opening = new Promise((resolve) => {
        chrome.tabs.onCreated.addListener((tab) => resolve(tab.pendingUrl || tab.url || ""));
        setTimeout(() => resolve(""), 20000);
    });
});

await ask({ type: "rewall:begin-pairing" });
const opened = await worker.evaluate(() => globalThis.opening);
const nonce = opened ? new URL(opened).searchParams.get("pair") : "";
if (!nonce) fail(`pairing opened ${opened || "nothing"} with no nonce`);
if (!opened.includes("/dashboard/2fa")) fail(`pairing opened ${opened}`);
pass("beginning to pair opens the dashboard carrying a fresh nonce");

const accepted = await ask({ type: "rewall:paired", nonce, name: "rewall-test-1.eth", secretKey: FAKE_KEY });
if (!accepted.ok) fail("the reply carrying the issued nonce was refused");
pass("a reply carrying the issued nonce is accepted");

const replayed = await ask({ type: "rewall:paired", nonce, name: "attacker.eth", secretKey: FAKE_KEY });
if (replayed.ok) fail("the same nonce was accepted twice");
pass("the same nonce is not accepted a second time");

const protect = await ask({ type: "rewall:set-passphrase", passphrase: "correct horse battery staple" });
if (protect.error) fail(`protecting the key said ${protect.error}`);
const open = await ask({ type: "rewall:state" });
if (!open.paired || !open.unlocked) fail(`after pairing the state was ${JSON.stringify(open)}`);
if (open.name !== "rewall-test-1.eth") fail(`the vault name came back as ${open.name}`);
pass("a passphrase stores the key and leaves the vault open");

const wrapped = await worker.evaluate(() => chrome.storage.local.get("paired"));
if (wrapped.paired.wrapped.includes(FAKE_KEY)) fail("the key was written to disk unwrapped");
pass("what lands on disk is the wrapped key and not the key");

await ask({ type: "rewall:lock" });
if ((await ask({ type: "rewall:state" })).unlocked) fail("locking left the vault open");
const wrong = await ask({ type: "rewall:unlock", passphrase: "wrong" });
if (!wrong.error) fail("a wrong passphrase unlocked the vault");
pass("a wrong passphrase is refused after locking");

const right = await ask({ type: "rewall:unlock", passphrase: "correct horse battery staple" });
if (right.error) fail(`the right passphrase said ${right.error}`);
if (!(await ask({ type: "rewall:state" })).unlocked) fail("the right passphrase did not unlock");
pass("the right passphrase unlocks it again");

await ask({ type: "rewall:forget" });
const forgotten = await ask({ type: "rewall:state" });
if (forgotten.paired || forgotten.unlocked) fail(`forgetting left ${JSON.stringify(forgotten)}`);
pass("forgetting this browser removes the stored key");

/* What the dashboard sees, which decides whether it offers to install or to pair */

const relayed = await context.newPage();
await relayed.goto(`${origin}/login`);

// The relay only runs on the dashboard origin, so an ordinary page must show no trace of the extension
const strayMark = await relayed.evaluate(() => document.documentElement.dataset.rewallExtension ?? "");
if (strayMark) fail("an ordinary page was marked as carrying the extension");
pass("an ordinary page carries no marker, so only the dashboard can see the extension");

await relayed.close();

/* Capturing a setup code, which is the only reason the extension can see the screen at all */

await page.bringToFront();
const shot = await worker.evaluate(() => chrome.tabs.captureVisibleTab({ format: "png" }));
if (!shot.startsWith("data:image/png;base64,")) fail(`capturing the tab returned ${shot.slice(0, 40)}`);
if (shot.length < 5000) fail(`the capture came back as ${shot.length} characters, which is not a screen`);
pass("the extension can photograph the visible tab with the permissions it already asks for");

// The seed is handed over by id, so the id has to be worth exactly one claim and nothing after
await worker.evaluate(() => {
    globalThis.handing = new Promise((resolve) => {
        chrome.tabs.onCreated.addListener((tab) => resolve(tab.pendingUrl || tab.url || ""));
        setTimeout(() => resolve(""), 20000);
    });
});

const handed = await ask({ type: "rewall:hand-capture", uri: URI, site: "github.com" });
if (!handed.ok) fail("handing a captured code over was refused");

const opened2 = await worker.evaluate(() => globalThis.handing);
const captureId = opened2 ? new URL(opened2).searchParams.get("capture") : "";
if (!captureId) fail(`handing a code over opened ${opened2 || "nothing"} with no id`);
if (opened2.includes(encodeURIComponent("secret=")) || opened2.includes("GEZDGNBVGY")) {
    fail("the seed rode the URL, where it would stay in history");
}
pass("a captured code opens the dashboard by id, with no part of the seed in the link");

// Held in session storage rather than the worker, which is recycled long before a dashboard finishes loading
const parked = await worker.evaluate(() => chrome.storage.session.get("captures"));
if (!Object.keys(parked.captures ?? {}).length) fail("the capture went somewhere a worker restart would lose");
pass("a captured code is parked where a recycled worker still finds it");

const claimed = await ask({ type: "rewall:claim-capture", id: captureId });
if (claimed.uri !== URI || claimed.site !== "github.com") fail(`claiming returned ${JSON.stringify(claimed)}`);
pass("the dashboard can claim the captured code once");

const again = await ask({ type: "rewall:claim-capture", id: captureId });
if (again.uri) fail("the same capture id was claimed twice");
pass("a second claim of the same id returns nothing");

const unknown = await ask({ type: "rewall:claim-capture", id: "00000000-0000-4000-8000-000000000000" });
if (unknown.uri) fail("an id nobody issued returned a seed");
pass("an id nobody issued returns nothing");

/* Selecting a setup code by dragging a box over it, which is the whole scan path end to end */

const QR = await QRCode.toDataURL(URI, { width: 200, margin: 2 });
const coded = await context.newPage();
await coded.setViewportSize({ width: 1000, height: 700 });
await coded.goto(`${origin}/code?qr=${encodeURIComponent(QR)}`);
await coded.waitForSelector("#qr");
await coded.bringToFront();

// Opened by the popup, which then closes, so the selection layer lives in the page itself
const begun = await ask({ type: "rewall:begin-crop" });
if (!begun.ok) fail("starting a selection was refused");
await coded.waitForSelector("#rewall-crop-hint", { timeout: 10000 }).catch(() => {});
pass("starting a selection puts a layer on the page rather than in the popup");

await worker.evaluate(() => {
    globalThis.cropOpened = new Promise((resolve) => {
        chrome.tabs.onCreated.addListener((tab) => resolve(tab.pendingUrl || tab.url || ""));
        setTimeout(() => resolve(""), 25000);
    });
});

// Dragged around the code itself, the way a person would
const box = await coded.locator("#qr").boundingBox();
await coded.mouse.move(box.x - 6, box.y - 6);
await coded.mouse.down();
await coded.mouse.move(box.x + box.width + 6, box.y + box.height + 6, { steps: 12 });
await coded.mouse.up();

const cropUrl = await worker.evaluate(() => globalThis.cropOpened);
const cropId = cropUrl ? new URL(cropUrl).searchParams.get("capture") : "";
if (!cropId) fail(`a selection around the code opened ${cropUrl || "nothing"}`);
pass("a box drawn around the code reads it and hands it over");

const fromCrop = await ask({ type: "rewall:claim-capture", id: cropId });
if (fromCrop.uri !== URI) fail(`the selection produced ${fromCrop.uri || fromCrop.error}`);
pass("what the selection produced is the exact URI the code carried");

// The dimming layer must be gone before the photograph, or every selection reads its own overlay
const leftover = await coded.locator("#rewall-crop-hint").count();
if (leftover) fail("the selection layer was still on the page afterwards");
pass("the selection layer is taken off the page once it is done");

await context.close();
await rm(profile, { recursive: true, force: true });
server.close();
console.log(`\n${passed} checks passed against a real browser with the extension installed`);
