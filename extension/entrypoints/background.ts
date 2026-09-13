import { defineBackground } from "#imports";
import { browser } from "wxt/browser";
import { parseOtp, otpSnapshot } from "@rewall/sdk/2fa";
import { wrapIdentity, unwrapIdentity, type Paired } from "../src/lock.ts";
import { visitedHostname } from "../src/capture.ts";
import { NoQrError, scanOtpauth, type Rect } from "../src/qr.ts";
import { OFFER, type Status, type ToBackground } from "../src/protocol.ts";

const DASHBOARD = process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://rewall.me";

// Long enough to fill a code after reading it, short enough that a walked away browser is not a vault
const IDLE_LOCK_MS = 15 * 60 * 1000;

type Account = { uri: string; label: string };
// expiresAt rides in storage, because a worker recycle drops any timer the lock relied on
type Session = { name: string; secretKey: string; accounts: Record<string, Account>; expiresAt?: number };

export default defineBackground(() => {
    /* Pairing */

    // Held in the worker rather than storage, so a nonce dies with the attempt that issued it
    let offered = "";
    let arrived: { name: string; secretKey: string } | null = null;

    // Issued for whoever is about to pair, and the previous one stops counting the moment a new one exists
    function issueNonce(): string {
        offered = crypto.randomUUID();
        return offered;
    }

    async function beginPairing(): Promise<void> {
        const tab = await browser.tabs.create({ url: `${DASHBOARD}/dashboard/2fa?pair=${issueNonce()}` });

        // The page has to exist before it can be told, and the relay runs at document_start
        const deliver = async (attempt: number): Promise<void> => {
            if (attempt > 40 || !tab.id) return;
            const sent = await browser.tabs
                .sendMessage(tab.id, { type: OFFER, nonce: offered })
                .then(() => true)
                .catch(() => false);
            if (!sent) setTimeout(() => void deliver(attempt + 1), 250);
        };
        void deliver(0);
    }

    /* Captured setup codes */

    // A seed never rides the URL, because a query string lands in history for good
    // Session storage rather than the worker's own memory, which is gone by the time the dashboard has loaded
    const CAPTURES = "captures";
    const CAPTURE_TTL_MS = 5 * 60 * 1000;

    type Held = { uri: string; site: string; at: number };
    const captures = async (): Promise<Record<string, Held>> =>
        ((await browser.storage.session.get(CAPTURES))[CAPTURES] ?? {}) as Record<string, Held>;

    async function handCapture(uri: string, site: string): Promise<void> {
        const id = crypto.randomUUID();
        await browser.storage.session.set({
            [CAPTURES]: { ...(await captures()), [id]: { uri, site, at: Date.now() } },
        });
        await browser.tabs.create({ url: `${DASHBOARD}/dashboard/2fa?capture=${id}` });
    }

    // Sent to the top frame only, or every iframe on the page would draw its own selection layer
    async function beginCrop(): Promise<{ ok: boolean }> {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false };

        const started = await browser.tabs
            .sendMessage(tab.id, { type: "rewall:crop" }, { frameId: 0 })
            .then(() => true)
            .catch(() => false);
        return { ok: started };
    }

    // The screenshot is taken here rather than in the page, which is not allowed to photograph itself
    async function cropped(selection: (Rect & { ratio: number }) | null, tabId?: number): Promise<void> {
        if (!selection || !tabId) return;

        const tab = await browser.tabs.get(tabId).catch(() => null);
        const hostname = visitedHostname(tab?.url);

        try {
            const shot = await browser.tabs.captureVisibleTab({ format: "png" });
            const uri = await scanOtpauth(shot, {
                x: selection.x * selection.ratio,
                y: selection.y * selection.ratio,
                width: selection.width * selection.ratio,
                height: selection.height * selection.ratio,
            });
            await handCapture(uri, hostname);
        } catch (failure) {
            // Told to the page, since the popup that started this closed the moment the page was clicked
            const message = failure instanceof NoQrError ? failure.message : "That screen could not be read.";
            await browser.tabs
                .sendMessage(tabId, { type: "rewall:crop-failed", message }, { frameId: 0 })
                .catch(() => {});
        }
    }

    // Good for one claim, and every expired one goes with it so a browsing session never accumulates seeds
    async function claimCapture(id: string): Promise<{ uri: string; site: string } | null> {
        const held = await captures();
        const one = held[id];
        delete held[id];

        for (const [key, value] of Object.entries(held)) {
            if (Date.now() - value.at > CAPTURE_TTL_MS) delete held[key];
        }
        await browser.storage.session.set({ [CAPTURES]: held });

        if (!one || Date.now() - one.at > CAPTURE_TTL_MS) return null;
        return { uri: one.uri, site: one.site };
    }

    /* Lock state */

    // Checked on every read, so an expired vault locks even when the worker that set the timer is gone
    const session = async (): Promise<Session | null> => {
        const open = (await browser.storage.session.get("open")).open as Session | undefined;
        if (!open) return null;
        if (open.expiresAt && Date.now() > open.expiresAt) {
            await browser.storage.session.remove("open");
            return null;
        }
        return open;
    };

    const stored = async (): Promise<Paired | null> =>
        ((await browser.storage.local.get("paired")).paired as Paired | undefined) ?? null;

    async function lock(): Promise<void> {
        await browser.storage.session.remove("open");
        await paintAll();
    }

    async function unlock(passphrase: string): Promise<string> {
        const paired = await stored();
        if (!paired) return "This browser is not paired yet.";
        try {
            const secretKey = await unwrapIdentity(paired, passphrase);
            await browser.storage.session.set({
                open: {
                    name: paired.name,
                    secretKey: btoa(String.fromCharCode(...secretKey)),
                    accounts: {},
                    expiresAt: Date.now() + IDLE_LOCK_MS,
                },
            });
            secretKey.fill(0);
            return "";
        } catch {
            return "That passphrase does not open this vault.";
        }
    }

    /* The click mechanic */

    // Which tabs hold a fillable field, in storage rather than the worker, which is recycled while a page sits open
    const FIELDS = "fields";
    type Field = { hostname: string; frameId: number };

    const fields = async (): Promise<Record<string, Field>> =>
        ((await browser.storage.session.get(FIELDS))[FIELDS] ?? {}) as Record<string, Field>;

    async function remember(tabId: number, field: Field | null): Promise<void> {
        const held = await fields();
        if (field) held[tabId] = field;
        else delete held[tabId];
        await browser.storage.session.set({ [FIELDS]: held });
    }

    async function accountFor(hostname: string): Promise<Account | null> {
        const open = await session();
        return open?.accounts[hostname] ?? null;
    }

    // An empty popup is what makes onClicked fire at all, so fill mode is staged per tab rather than globally
    async function paint(tabId: number): Promise<void> {
        const field = (await fields())[tabId];
        const fillable = field ? await accountFor(field.hostname) : null;
        await browser.action.setPopup({ tabId, popup: fillable ? "" : "popup.html" });
        await browser.action.setBadgeText({ tabId, text: fillable ? "1" : "" });
        if (fillable) await browser.action.setBadgeBackgroundColor({ tabId, color: "#3b7d4f" });
    }

    const paintAll = async () => {
        for (const tabId of Object.keys(await fields())) await paint(Number(tabId));
    };

    // Generated on demand for the popup, so a code can still be read by hand when a page refuses to be filled
    async function codeFor(hostname: string): Promise<{ code: string; remaining: number; label: string } | null> {
        const account = await accountFor(hostname);
        if (!account) return null;

        const otp = parseOtp(new TextEncoder().encode(account.uri));
        const snapshot = otpSnapshot(otp, Date.now());
        otp.secret.bytes.fill(0);
        return { ...snapshot, label: account.label };
    }

    browser.action.onClicked.addListener(async (tab) => {
        const field = tab.id ? (await fields())[tab.id] : undefined;
        if (!tab.id || !field) return;

        const account = await accountFor(field.hostname);
        if (!account) return;

        // Parsed per click rather than kept, so a seed lives as an object for exactly one generation
        const otp = parseOtp(new TextEncoder().encode(account.uri));
        const { code } = otpSnapshot(otp, Date.now());
        otp.secret.bytes.fill(0);

        await browser.tabs.sendMessage(tab.id, { type: "rewall:fill", code }, { frameId: field.frameId });
    });

    // A navigation is a new page, so the tab goes back to the safe default until the new one announces
    browser.tabs.onUpdated.addListener((tabId, change) => {
        if (!change.url && change.status !== "loading") return;
        void remember(tabId, null).then(() => paint(tabId));
    });

    browser.tabs.onRemoved.addListener((tabId) => void remember(tabId, null));

    // The popup writes the account map after it reads the vault, so the toolbar follows storage rather than a caller
    browser.storage.session.onChanged.addListener((changes) => {
        if ("open" in changes) void paintAll();
    });

    /* Idle */

    let idle: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
        clearTimeout(idle);
        idle = setTimeout(() => void lock(), IDLE_LOCK_MS);
    };

    /* Router */

    // Chrome ignores a promise returned from a listener, so every answer goes back through sendResponse
    browser.runtime.onMessage.addListener((message: ToBackground, sender, sendResponse) => {
        const answer = route(message, sender);
        if (!answer) return false;
        void answer.then(sendResponse, () => sendResponse(undefined));
        return true;
    });

    function route(
        message: ToBackground,
        sender: { tab?: { id?: number; url?: string }; url?: string; frameId?: number },
    ): Promise<unknown> | undefined {
        switch (message?.type) {
            case "rewall:announce": {
                const tabId = sender.tab?.id;
                const tabHost = visitedHostname(sender.tab?.url);
                // The frame's own origin, so a cross origin iframe on a matched page cannot receive the code
                const frameHost = visitedHostname(sender.url ?? sender.tab?.url);
                if (!tabId || !tabHost || frameHost !== tabHost) return undefined;

                return fields()
                    .then((held) => {
                        if (message.present)
                            return remember(tabId, { hostname: tabHost, frameId: sender.frameId ?? 0 });
                        if (held[tabId]?.frameId === (sender.frameId ?? 0)) return remember(tabId, null);
                        return undefined;
                    })
                    .then(() => paint(tabId))
                    .then(() => ({ ok: true }));
            }

            case "rewall:paired": {
                // A reply is only believed if it carries the nonce this worker just issued
                if (!offered || message.nonce !== offered) return Promise.resolve({ ok: false });
                offered = "";
                arrived = { name: message.name, secretKey: message.secretKey };
                return Promise.resolve({ ok: true });
            }

            case "rewall:begin-pairing":
                return beginPairing().then(() => ({ ok: true }));

            // The dashboard is already open and already has the wallet, so it pairs in place rather than in a new tab
            case "rewall:request-pairing":
                return Promise.resolve({ nonce: issueNonce() });

            case "rewall:code":
                return codeFor(message.hostname).then((held) => held ?? { code: "" });

            // A page speaks only for itself, and an extension page speaks for whichever tab is in front of it
            case "rewall:seen": {
                const asked = message.present;
                const from = visitedHostname(sender.tab?.url) && sender.tab?.id ? sender.tab : null;
                const target = from
                    ? Promise.resolve(from)
                    : browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab);

                return target.then(async (tab) => {
                    const hostname = visitedHostname(tab?.url);
                    if (!tab?.id || !hostname) return { ok: false };

                    await remember(tab.id, asked ? { hostname, frameId: 0 } : null);
                    await paint(tab.id);
                    return { ok: true };
                });
            }

            case "rewall:begin-crop":
                return beginCrop();

            case "rewall:cropped":
                return cropped(message.selection, sender.tab?.id).then(() => ({ ok: true }));

            case "rewall:hand-capture":
                return handCapture(message.uri, message.site).then(() => ({ ok: true }));

            case "rewall:claim-capture":
                return claimCapture(message.id).then((held) => held ?? { error: "That setup code is no longer held." });

            case "rewall:set-passphrase": {
                if (!arrived) return Promise.resolve({ error: "Nothing to protect yet." });
                const held = arrived;
                const bytes = Uint8Array.from(atob(held.secretKey), (character) => character.charCodeAt(0));
                return wrapIdentity(held.name, bytes, message.passphrase)
                    .then(async (paired) => {
                        bytes.fill(0);
                        arrived = null;
                        await browser.storage.local.set({ paired });
                        await browser.storage.session.set({
                            open: {
                                name: held.name,
                                secretKey: held.secretKey,
                                accounts: {},
                                expiresAt: Date.now() + IDLE_LOCK_MS,
                            },
                        });
                        touch();
                        return { error: "" };
                    })
                    .then(async (result) => {
                        await paintAll();
                        return result;
                    });
            }

            case "rewall:unlock":
                return unlock(message.passphrase).then(async (error) => {
                    if (!error) touch();
                    await paintAll();
                    return { error };
                });

            case "rewall:lock":
                return lock().then(() => ({ ok: true }));

            case "rewall:forget":
                return browser.storage.local
                    .remove("paired")
                    .then(() => lock())
                    .then(() => ({ ok: true }));

            case "rewall:state":
                return status();

            default:
                return undefined;
        }
    }

    async function status(): Promise<Status> {
        const [open, paired, tabs] = await Promise.all([
            session(),
            stored(),
            browser.tabs.query({ active: true, currentWindow: true }),
        ]);
        const hostname = visitedHostname(tabs[0]?.url);
        return {
            paired: Boolean(paired),
            unlocked: Boolean(open),
            needsPassphrase: Boolean(arrived),
            name: open?.name ?? paired?.name ?? "",
            accounts: open ? Object.keys(open.accounts).length : 0,
            hostname,
            matched: open?.accounts[hostname]?.label ?? "",
            error: "",
        };
    }
});
