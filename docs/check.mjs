// Reads the served home page and fails if a trace of the stock theme or a missing asset shows
import assert from "node:assert/strict";

const base = process.env.REWALL_DOCS_URL || "http://127.0.0.1:3001";

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

console.log("docs ok: forced dark, Rewall title, logo, favicon, repo link, mermaid wired, no theme branding");
