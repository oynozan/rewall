// The landing page is grayscale by rule, so this fails on any hue as well as on overflow or a missing section

import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { artifacts } from "./lib/artifacts.mjs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const output = await artifacts();

const checks = [];
const pass = (message) => checks.push(message);

const WIDTHS = [
    [1512, "wide"],
    [900, "tablet"],
    [390, "mobile"],
];

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

try {
    for (const [width, label] of WIDTHS) {
        const page = await browser.newPage({ viewport: { width, height: 950 }, deviceScaleFactor: 1 });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 120000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(1200);

        assert.deepEqual(errors, [], `${label} raised page errors`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 1, `${label} scrolls sideways by ${overflow}px`);
        pass(`${label} renders clean with no sideways scroll`);

        // Anything with a channel spread this wide is a colour, and only highlighted code may have one
        const hues = await page.evaluate(() => {
            const parse = (value) => (value.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
            const found = [];
            for (const el of document.querySelectorAll(".lp, .lp *")) {
                if (el.closest(".code, .b-panel")) continue;
                const style = getComputedStyle(el);
                for (const prop of ["color", "backgroundColor", "borderTopColor", "borderLeftColor", "fill"]) {
                    const raw = style[prop];
                    if (!raw || raw === "none" || raw.includes("rgba(0, 0, 0, 0)")) continue;
                    const [r, g, b] = parse(raw);
                    if ([r, g, b].some((n) => Number.isNaN(n))) continue;
                    if (Math.max(r, g, b) - Math.min(r, g, b) > 12)
                        found.push(`${el.className || el.tagName} ${prop} ${raw}`);
                }
            }
            return [...new Set(found)];
        });
        assert.deepEqual(hues, [], `${label} paints a colour outside the grayscale palette`);
        pass(`${label} stays grayscale`);

        await page.screenshot({ path: `${output}/landing-${label}.png`, fullPage: true, animations: "disabled" });
        await page.close();
    }

    const page = await browser.newPage({ viewport: { width: 1512, height: 950 } });
    await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.evaluate(() => document.fonts.ready);

    // Beams render nothing until the client effect has measured their endpoints
    await page
        .waitForFunction(() => document.querySelectorAll(".flow .beam-svg").length >= 6, { timeout: 15000 })
        .catch(() => {
            throw new assert.AssertionError({ message: "the flow beams never mounted" });
        });

    const counts = await page.evaluate(() => ({
        h1: document.querySelectorAll(".lp h1").length,
        brands: document.querySelectorAll(".brands li").length,
        marks: document.querySelectorAll(".feat-cells .cell").length,
        bento: document.querySelectorAll(".bento .b-cell").length,
        faq: document.querySelectorAll(".faq details").length,
        steps: document.querySelectorAll("[data-secret-journey] [role=tab]").length,
        bands: document.querySelectorAll(".lp > .band").length,
        diagrams: document.querySelectorAll(".flow .fl-stage").length,
        beams: document.querySelectorAll(".flow .beam-svg").length,
        flowMarks: document.querySelectorAll(".flow .fl-mark").length,
        flowPeople: Math.min(
            ...[...document.querySelectorAll(".flow")].map((f) => f.querySelectorAll(".fl-person").length),
        ),
        tokens: document.querySelectorAll('.code pre span[class^="t-"]').length,
        kinds: new Set([...document.querySelectorAll('.code pre span[class^="t-"]')].map((el) => el.className)).size,
        heroFont: getComputedStyle(document.querySelector(".hero h1")).fontFamily,
        headFont: getComputedStyle(document.querySelector(".lp h2")).fontFamily,
    }));

    assert.equal(counts.h1, 1, "the page needs exactly one h1");
    assert.equal(counts.brands, 4, "the hero closes on four brand marks");
    assert.equal(counts.marks, 4, "the feature grid holds four marks");
    assert.equal(counts.bento, 4, "the client row holds four cells");
    assert.equal(counts.faq, 8, "the faq holds eight questions");
    assert.equal(counts.steps, 3, "how it works is three moves");
    assert.equal(counts.bands, 8, "nav, hero, how it works, protocol, flows, clients, faq and footer");
    assert.equal(counts.diagrams, 3, "the three capability diagrams are in place");
    assert.ok(counts.beams >= 6, `only ${counts.beams} animated beams mounted across the flows`);
    assert.equal(counts.flowMarks, 3, "every flow carries the mark wherever Rewall is the one operating");
    assert.ok(counts.flowPeople >= 1, "every flow shows the person the secret belongs to");

    // A rail that is off axis or off the pixel grid renders as a soft grey smear instead of a line
    const rails = await page.evaluate(() =>
        [...document.querySelectorAll(".flow .beam-svg path")].map((p) => p.getAttribute("d")),
    );
    const soft = rails.filter((d) => {
        if (d.includes("V")) return !/^M -?\d+,-?\d+ V -?\d+ H -?\d+$/.test(d);
        const pts = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
        const level = pts.every((p) => p[1] === pts[0][1]) || pts.every((p) => p[0] === pts[0][0]);
        return !level || !Number.isInteger(pts[0][0]) || !Number.isInteger(pts[0][1]);
    });
    assert.equal(soft.length, 0, `beams that would render soft: ${soft.join(" | ")}`);

    // A rail stops on a node's edge, it never carries on to the centre and sticks out the far side
    const stubs = await page.evaluate(() => {
        const bad = [];
        for (const wrap of document.querySelectorAll(".fl-wrap")) {
            const w = wrap.getBoundingClientRect();
            const boxes = [...wrap.querySelectorAll(".fl-node")].map((n) => {
                const b = n.getBoundingClientRect();
                return { l: b.left - w.left, r: b.right - w.left, t: b.top - w.top, b: b.bottom - w.top };
            });
            for (const svg of wrap.querySelectorAll(".beam-svg")) {
                const d = svg.querySelector("path").getAttribute("d");
                const n = d.match(/-?[\d.]+/g).map(Number);
                const ends = d.includes("V")
                    ? [
                          [n[0], n[1]],
                          [n[3], n[2]],
                      ]
                    : [
                          [n[0], n[1]],
                          [n[4], n[5]],
                      ];
                for (const [x, y] of ends) {
                    if (boxes.some((b) => x > b.l + 1 && x < b.r - 1 && y > b.t + 1 && y < b.b - 1)) bad.push(d);
                }
            }
        }
        return bad;
    });
    assert.equal(stubs.length, 0, `rails that run into a node instead of stopping on it: ${stubs.join(" | ")}`);

    // Everything a flow reaches stands on one vertical line, and a refusal leaves the mark itself
    const align = await page.evaluate(() =>
        [...document.querySelectorAll(".flow")].map((flow) => {
            const stage = flow.querySelector(".fl-stage");
            const reached = [...stage.children].slice(2).map((el) => {
                const node = el.classList.contains("fl-node") ? el : el.querySelector(".fl-node");
                return node.getBoundingClientRect();
            });
            const mark = stage.querySelector(".fl-mark").getBoundingClientRect();
            const cut = stage.querySelector(".fl-break").getBoundingClientRect();
            const lefts = reached.map((r) => r.left);
            return {
                spread: Math.max(...lefts) - Math.min(...lefts),
                gap: cut.left - mark.right,
                drift: (cut.top + cut.bottom) / 2 - (mark.top + mark.bottom) / 2,
            };
        }),
    );
    align.forEach((a, i) => {
        const flow = `flow ${i + 1}`;
        assert.ok(Math.abs(a.spread) <= 1, `${flow} leaves what it reaches ${a.spread.toFixed(1)}px out of line`);
        assert.ok(Math.abs(a.gap) <= 1, `${flow} starts its refusal ${a.gap.toFixed(1)}px away from the mark`);
        assert.ok(Math.abs(a.drift) <= 1, `${flow} hangs its refusal ${a.drift.toFixed(1)}px off the mark's centre`);
    });
    assert.ok(counts.tokens > 40, `the sdk sample lost its highlighting, only ${counts.tokens} tokens`);
    assert.ok(counts.kinds >= 6, `highlighting collapsed to ${counts.kinds} token kinds`);

    // The code block is the one place hue is allowed, so a grayscale sample means the theme is gone
    const lit = await page.evaluate(() => {
        const seen = new Set();
        for (const el of document.querySelectorAll('.code pre span[class^="t-"]')) {
            const [r, g, b] = (getComputedStyle(el).color.match(/\d+/g) || []).map(Number);
            if (Math.max(r, g, b) - Math.min(r, g, b) > 20) seen.add(el.className);
        }
        return seen.size;
    });
    assert.ok(lit >= 4, `only ${lit} token kinds carry real colour, highlighting reads as grayscale`);
    pass(`the sdk sample is highlighted in ${lit} coloured token kinds`);
    assert.ok(/akt/i.test(counts.heroFont), `hero headline fell back to ${counts.heroFont}`);
    assert.ok(/lexend/i.test(counts.headFont), `section headings fell back to ${counts.headFont}`);
    pass("structure, counts, highlighting and both display fonts are in place");

    // The canvas only leaves its 300x150 default once the client effect has measured and painted it
    await page
        .waitForFunction(
            () => {
                const el = document.querySelector(".hero-dither");
                return el && el.width !== 300 && el.width > 1;
            },
            { timeout: 15000 },
        )
        .catch(() => {
            throw new assert.AssertionError({ message: "the hero dither never sized itself, so it never painted" });
        });
    const dither = await page.evaluate(() => {
        const el = document.querySelector(".hero-dither");
        const box = el.getBoundingClientRect();
        return { w: el.width, h: el.height, boxW: Math.round(box.width), boxH: Math.round(box.height) };
    });
    assert.ok(dither.boxH > 400, `dither covers only ${dither.boxH}px of the hero`);
    pass(`dither paints ${dither.boxW}x${dither.boxH} of hero ground at ${dither.w}x${dither.h}`);

    // A collapsed summary must still expand, since the faq ships no javascript of its own
    const first = page.locator(".faq details").first();
    assert.equal(await first.evaluate((el) => el.open), false, "the faq starts collapsed");
    await first.locator("summary").click();
    assert.equal(await first.evaluate((el) => el.open), true, "the faq did not open on click");
    pass("the faq opens without scripting");

    await page.close();
} finally {
    await browser.close();
}

console.log(checks.map((line) => `ok ${line}`).join("\n"));
