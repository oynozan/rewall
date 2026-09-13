import { browser } from "wxt/browser";
import { visitedHostname } from "../../src/capture.ts";
import { readAccounts } from "../../src/vault.ts";
import { splitMoved, type Sites } from "../../src/sites.ts";
import type { Status } from "../../src/protocol.ts";

// Every write to Rewall is a transaction, so the dashboard signs and this only ever hands work to it
const DASHBOARD = process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://rewall.me";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const field = el("field");
const problem = el("problem");
const summary = el("summary");
const save = el<HTMLButtonElement>("save");
const scan = el<HTMLButtonElement>("scan");
const codeRow = el("code-row");
const digits = el("digits");
const expires = el("expires");

const sections = {
    pair: el("pair"),
    protect: el("protect"),
    locked: el("locked"),
    open: el("open"),
};

const ask = <T>(message: unknown): Promise<T> => browser.runtime.sendMessage(message) as Promise<T>;

function show(which: keyof typeof sections | null): void {
    for (const [name, section] of Object.entries(sections)) section.hidden = name !== which;
}

function complain(message: string): void {
    problem.textContent = message;
    problem.hidden = !message;
}

/* Scanning */

// The selection lives in the page, because this popup closes the moment anyone clicks outside it
async function startCrop(): Promise<void> {
    complain("");
    const { ok } = await ask<{ ok: boolean }>({ type: "rewall:begin-crop" });
    if (!ok) return complain("Rewall cannot read this page, so there is nothing to select on it.");
    window.close();
}

/* The tab */

async function describeTab(): Promise<string> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const hostname = visitedHostname(tab?.url);

    if (hostname) {
        save.hidden = false;
        save.textContent = `Save 2FA for ${hostname}`;
        save.onclick = async () => {
            // The hostname is watched here and typed on the dashboard, which is where it goes wrong
            await browser.tabs.create({ url: `${DASHBOARD}/dashboard/2fa?site=${encodeURIComponent(hostname)}` });
            window.close();
        };

        scan.hidden = false;
        scan.onclick = () => void startCrop();
    }

    if (!tab?.id) return hostname;
    const reply = await browser.tabs
        .sendMessage(tab.id, { type: "rewall:detect" })
        .then((answer) => answer as { present: boolean } | undefined)
        .catch(() => undefined);

    field.textContent = !reply
        ? "Rewall cannot read this page"
        : reply.present
          ? `A sign-in code field is ready on ${hostname}`
          : "No sign-in code field on this page";

    // The worker forgets which tabs hold a field every time it is recycled, so opening this says so again
    await ask({ type: "rewall:seen", present: Boolean(reply?.present) });
    return hostname;
}

/* The vault */

const SEEN = "sites";
let moved: Sites = {};

// Opened here rather than in the worker, because this is the only page allowed to load wasm and a full RPC client
async function loadAccounts(): Promise<void> {
    const open = (await browser.storage.session.get("open")).open as
        { name: string; secretKey: string; accounts: Record<string, unknown> } | undefined;
    if (!open || Object.keys(open.accounts).length) return;

    summary.textContent = "Reading your vault…";
    const secretKey = Uint8Array.from(atob(open.secretKey), (character) => character.charCodeAt(0));
    try {
        const { accounts, contested, sites } = await readAccounts(open.name, secretKey);
        const seen = ((await browser.storage.local.get(SEEN))[SEEN] ?? {}) as Sites;

        const split = splitMoved(sites, seen);
        moved = split.moved;
        for (const hostname of Object.values(moved)) delete accounts[hostname];

        await browser.storage.local.set({ [SEEN]: { ...seen, ...split.settled } });
        await browser.storage.session.set({ open: { ...open, accounts } });

        if (contested.length) complain(`More than one account claims ${contested.join(", ")}, so none of them fills.`);
    } catch {
        complain("Could not read your vault. Check your connection and open this again.");
    } finally {
        secretKey.fill(0);
    }
}

// Accepting rewrites the remembered hostname, after which the next read treats it as settled
async function acceptMoved(): Promise<void> {
    const seen = ((await browser.storage.local.get(SEEN))[SEEN] ?? {}) as Sites;
    await browser.storage.local.set({ [SEEN]: { ...seen, ...moved } });
    moved = {};

    const open = (await browser.storage.session.get("open")).open as { accounts: Record<string, unknown> } | undefined;
    if (open) await browser.storage.session.set({ open: { ...open, accounts: {} } });
    await loadAccounts();
    await render();
}

/* The code itself */

let ticking: ReturnType<typeof setTimeout> | undefined;

// Shown so a page that refuses to be filled can still be got past by reading six digits
async function showCode(hostname: string): Promise<void> {
    const held = await ask<{ code: string; remaining?: number }>({ type: "rewall:code", hostname });
    codeRow.hidden = !held.code;
    if (!held.code) return;

    digits.textContent = held.code.replace(/(\d{3})(?=\d)/, "$1 ");
    expires.textContent = `${held.remaining}s`;

    clearTimeout(ticking);
    ticking = setTimeout(() => void showCode(hostname), Math.max(1, held.remaining ?? 1) * 1000);
}

el("code").onclick = async () => {
    const text = (digits.textContent || "").replace(/\s/g, "");
    if (!text) return;

    // execCommand, because the clipboard API is refused in some extension pages and this one always works
    await navigator.clipboard.writeText(text).catch(() => {
        const holder = document.createElement("textarea");
        holder.value = text;
        document.body.append(holder);
        holder.select();
        document.execCommand("copy");
        holder.remove();
    });

    expires.textContent = "Copied";
};

/* Render */

async function render(): Promise<void> {
    const status = await ask<Status>({ type: "rewall:state" });

    if (status.needsPassphrase) show("protect");
    else if (!status.paired) show("pair");
    else if (!status.unlocked) show("locked");
    else {
        show("open");
        if (status.matched) void showCode(status.hostname);
        else codeRow.hidden = true;

        summary.textContent = status.matched
            ? `${status.matched} fills on ${status.hostname}. Click the toolbar icon to use it.`
            : `${status.accounts} ${status.accounts === 1 ? "account" : "accounts"} from ${status.name}. Nothing here matches ${status.hostname || "this page"}.`;

        const changed = Object.entries(moved);
        el("moved").hidden = changed.length === 0;
        if (changed.length) {
            const listed = changed.map(([secretName, host]) => `${label(secretName)} now says ${host}`).join(", ");
            el("moved-note").textContent = `${listed}. It will not fill until you confirm that is right.`;
        }
    }
}

const label = (secretName: string) => secretName.split(".")[0] ?? secretName;

el("begin").onclick = async () => {
    await ask({ type: "rewall:begin-pairing" });
    window.close();
};

el("lock").onclick = async () => {
    await ask({ type: "rewall:lock" });
    await render();
};

el("accept-moved").onclick = async () => {
    complain("");
    await acceptMoved();
};

el<HTMLFormElement>("protect-form").onsubmit = async (event) => {
    event.preventDefault();
    complain("");
    const passphrase = el<HTMLInputElement>("new-passphrase").value;
    const { error } = await ask<{ error: string }>({ type: "rewall:set-passphrase", passphrase });
    if (error) return complain(error);
    await loadAccounts();
    await render();
};

el<HTMLFormElement>("unlock-form").onsubmit = async (event) => {
    event.preventDefault();
    complain("");
    const passphrase = el<HTMLInputElement>("passphrase").value;
    const { error } = await ask<{ error: string }>({ type: "rewall:unlock", passphrase });
    if (error) return complain(error);
    await loadAccounts();
    await render();
};

void describeTab();
void render().then(loadAccounts).then(render);
