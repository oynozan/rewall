// Reads the served site and fails on a trace of the stock theme, a missing asset, a dead link, a diagram that did not become a component, or a style slip
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.REWALL_DOCS_URL || "http://127.0.0.1:3001";
const content = fileURLToPath(new URL("./content/", import.meta.url));

/* Home */

const page = await fetch(base);
assert.equal(page.status, 200, `home page answered ${page.status}`);
const html = await page.text();

const visible = html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ");
assert.doesNotMatch(visible, /nextra|shuding/i, "the stock theme still names itself somewhere on the page");
assert.match(html, /\("class","theme","dark","dark"/, "the theme script does not force dark");
assert.match(html, /--nextra-bg: 22,22,22;/, "the page background is not the dashboard's");
assert.match(html, /<title>[^<]*Rewall/, "the title does not say Rewall");
assert.match(html, /href="\/icon\.svg"/, "the favicon is not the Rewall icon");
assert.match(html, /src="\/logo\.svg"/, "the navbar does not carry the Rewall logo");
assert.match(html, /\\"chart\\":\\"flowchart/, "the mermaid block did not become a diagram component");
assert.match(html, /href="https:\/\/github\.com\/oynozan\/rewall"/, "the repository link does not point at Rewall");
assert.match(html, /github\.com\/oynozan\/rewall\/issues\/new\?/, "feedback does not open an issue on the Rewall repo");
assert.match(html, /rewall\/tree\/main\/docs\/content\/index\.mdx"/, "the edit link does not reach docs/content");

for (const asset of ["/logo.svg", "/icon.svg"]) {
    const res = await fetch(base + asset);
    assert.equal(res.status, 200, `${asset} answered ${res.status}`);
    assert.match(res.headers.get("content-type") ?? "", /svg/, `${asset} is not served as svg`);
}

/* Every page */

function* walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(path);
        else if (entry.name.endsWith(".mdx")) yield path;
    }
}

const routeOf = (path) =>
    "/" +
    path
        .slice(content.length)
        .replace(/\\/g, "/")
        .replace(/(^|\/)index\.mdx$/, "")
        .replace(/\.mdx$/, "");

const sources = new Map([...walk(content)].map((path) => [routeOf(path), readFileSync(path, "utf8")]));
const served = new Map();
for (const route of sources.keys()) {
    const res = await fetch(base + route);
    assert.equal(res.status, 200, `${route} answered ${res.status}`);
    served.set(route, await res.text());
}

const BUZZ =
    /\b(leverage|seamless(ly)?|robust|powerful|revolutionary|cutting[ -]edge|empower(s|ing)?|game[ -]changing|next[ -]gen|ecosystem|supercharge|blazing)\b/i;
const problems = [];
for (const [route, source] of sources) {
    const prose = source
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`\n]*`/g, "")
        .replace(/^\|.*$/gm, "");
    if (/[–—]/.test(prose)) problems.push(`${route} has an em dash or en dash`);
    const buzz = prose.match(BUZZ);
    if (buzz) problems.push(`${route} says "${buzz[0]}"`);
    for (const sentence of prose.replace(/^---[\s\S]*?---/, "").split(/(?<=[.!?])\s+/)) {
        const words = sentence.trim().split(/\s+/).length;
        if (words > 40) problems.push(`${route} has a ${words} word sentence: "${sentence.trim().slice(0, 60)}..."`);
    }
    const diagrams = (source.match(/^```mermaid/gm) ?? []).length;
    const rendered = (served.get(route).match(/\\"chart\\":\\"/g) ?? []).length;
    if (diagrams !== rendered)
        problems.push(`${route} has ${diagrams} mermaid blocks but ${rendered} diagram components`);
    for (const [, target] of prose.matchAll(/\]\((\/[^)\s]*)\)/g)) {
        const [path, anchor] = target.split("#");
        const to = path.replace(/\/$/, "") || "/";
        if (!served.has(to)) {
            problems.push(`${route} links to ${target}, which is not a page`);
            continue;
        }
        if (anchor && !served.get(to).includes(`id="${anchor}"`))
            problems.push(`${route} links to ${target}, which has no such heading`);
    }
}
assert.equal(problems.length, 0, `\n${problems.join("\n")}`);

console.log(
    `docs ok: home carries Rewall and nothing of the theme, ${sources.size} pages serve, every link and heading resolves, every diagram is a component, no style slips`,
);
