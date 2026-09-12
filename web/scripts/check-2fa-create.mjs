// Drives the Add an authenticator panel in a real browser, stopping short of the transaction

import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { artifacts } from "./lib/artifacts.mjs";
import { skipTour } from "./lib/tour.mjs";
import { headlessWallet, attachWallet } from "./lib/wallet.mjs";
import { openOwnVault } from "./lib/session.mjs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const output = await artifacts();

const OWNER = "rewall-test-1.eth";

// The published RFC 6238 account, so nothing here is anyone's real seed
const URI =
    "otpauth://totp/RFC%206238:Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=RFC%206238&digits=8&period=30";

const checks = [];
const passed = (name) => checks.push(name);

const browser = await chromium.launch({ executablePath });
const wallet = headlessWallet({ mnemonic: process.env.REWALL_TEST_MNEMONIC, addressIndex: 0 });
const context = await browser.newContext({ baseURL });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

await skipTour(page);
await attachWallet(page, wallet);

// The sidebar truncates, so the prefix is what a contains check can actually match
await openOwnVault(page, { url: `${baseURL}/dashboard/secrets`, address: wallet.address.slice(0, 6), name: OWNER });

// Read a label that really exists, so the collision case is a real one rather than a guessed name
await expect(page.locator(".secrets-browser button.secret-name").first()).toBeVisible({ timeout: 90000 });
const taken = (await page.locator(".secrets-browser button.secret-name").first().innerText()).trim().split("\n")[0];

await page.goto(`${baseURL}/dashboard/2fa`);
const form = page.locator(".panel-form");
const alert = form.getByRole("alert");

/* The panel is reachable from the page that lists these accounts */

await page.getByRole("button", { name: "Add account" }).click();
await expect(page.getByRole("heading", { name: "Add an authenticator" })).toBeVisible();
passed("Add account opens the authenticator panel");

/* A setup key decodes to something the user can recognise before they commit to it */

await page.getByLabel("Setup key").fill("not a setup key");
await expect(alert).toContainText(/authenticator/i);
passed("A string that is not a setup key is refused while it is typed");

await page.getByLabel("Setup key").fill(URI);
await expect(form).toContainText("RFC 6238");
await expect(form).toContainText("8 digits");
passed("A real setup key shows the issuer and the shape of the code");

const label = await page.getByLabel("Name", { exact: true }).inputValue();
assert.equal(label, "rfc-6238", `the name filled in as ${label}`);
passed("The name fills itself in from the issuer");

/* A second paste has to move the name with it, or the form shows one account and targets another */

const second = "otpauth://totp/Fastmail:me%40fm.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Fastmail";
await page.getByLabel("Setup key").fill(second);
await expect(page.getByLabel("Name", { exact: true })).toHaveValue("fastmail");
passed("Pasting a different setup key moves the name with it");

await page.getByLabel("Name", { exact: true }).fill("mine");
await page.getByLabel("Setup key").fill(URI);
await expect(page.getByLabel("Name", { exact: true })).toHaveValue("mine");
passed("Once the name is edited by hand, a later paste leaves it alone");

/* One issuer can hold several accounts, so a taken name has to suggest a distinct one */

const issuer = taken.replace(/-/g, " ");
await page.reload();

// The suggestion can only avoid a taken name once the vault it checks against has actually arrived
await expect(page.locator(".sidebar-vault strong, .workspace-switcher strong")).toHaveText(OWNER, { timeout: 90000 });
await page.getByRole("button", { name: "Add account" }).click();
await page
    .getByLabel("Setup key")
    .fill(`otpauth://totp/${issuer}:work%40corp.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=${issuer}`);
const suggested = await page.getByLabel("Name", { exact: true }).inputValue();
assert.notEqual(suggested, taken, `an issuer whose name is taken still suggested ${suggested}`);
assert.ok(suggested.startsWith(taken), `the suggestion ${suggested} dropped the issuer`);
passed(`An issuer whose name is taken suggests ${suggested} rather than colliding`);

await page.getByLabel("Setup key").fill(URI);

/* The hostname is the anti phishing control, so it has to refuse rather than guess */

const site = page.getByLabel("Site", { exact: true });
await site.fill("https://example.com:8080");
await site.blur();
await expect(alert).toContainText(/port/i);
passed("A hostname carrying a port is refused");

await site.fill("https://GitHub.com/login");
await site.blur();
await expect(form).toContainText("Fills only on github.com");
passed("A pasted URL is reduced to the exact hostname it will match");

/* A hostname typed and never blurred still gets checked, rather than reaching the chain raw */

await page.getByLabel("Name", { exact: true }).fill("never-blurred");
await site.fill("example.com:9999");
await form.getByRole("button", { name: "Store account" }).click();
await expect(alert).toContainText(/port/i);
passed("A hostname never blurred is still checked when the form is submitted");

/* Every secret type shares one namespace, so landing on another secret has to be said out loud */

await site.fill("github.com");
await site.blur();
await page.getByLabel("Name", { exact: true }).fill(taken);
await expect(alert).toContainText(/lives at this name/i);
await expect(alert).toContainText(/replaces it/i);
passed(`Reusing an existing secret's name warns before anything is replaced, tried with ${taken}`);

await page.getByLabel("Name", { exact: true }).fill("rfc-6238-unused");
await expect(form).toContainText(`rfc-6238-unused.rewall.${OWNER}`);
passed("A free name shows where it will be stored instead");

/* The extension watches the hostname and hands it over, because typing it here is what goes wrong */

await page.goto(`${baseURL}/dashboard/2fa?site=${encodeURIComponent("https://GitHub.com/login")}`);
await expect(page.locator(".sidebar-vault strong, .workspace-switcher strong")).toHaveText(OWNER, { timeout: 90000 });
await expect(page.getByRole("heading", { name: "Add an authenticator" })).toBeVisible({ timeout: 30000 });
passed("A handed over hostname opens the panel without a click");

await expect(page.getByLabel("Site", { exact: true })).toHaveValue("github.com");
await expect(form).toContainText("Fills only on github.com");
passed("The handed over hostname arrives normalized into the field");

// A link is not the extension, so the page has to say the value was not typed here
await expect(form).toContainText(/link that opened this page/i);
passed("A prefilled hostname says where it came from");

await page.goto(`${baseURL}/dashboard/2fa?site=${encodeURIComponent("https://evil.com@github.com")}`);
await expect(page.getByRole("heading", { name: "Add an authenticator" })).toBeVisible({ timeout: 30000 });
await expect(page.getByLabel("Site", { exact: true })).toHaveValue("");
passed("A hostname the normalizer refuses arrives empty rather than as something else");

// Spacing is check-panels, which measures every label in every panel rather than this one
await expect(page.getByLabel("Recovery name")).toBeHidden();
passed("Recovery options stay collapsed until they are asked for");

// Nothing is submitted, because the account above is a published test vector and not worth a transaction
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${output}/2fa-create.png`, fullPage: true });

assert.deepEqual(errors, [], `the page threw ${errors.join(", ")}`);
passed("The panel raised no page errors");

await browser.close();
console.log(JSON.stringify({ passed: checks.length, checks, screenshot: `${output}/2fa-create.png` }, null, 2));
