// Copies the built zips into the dashboard's public folder, which is the only place a browser can download them from

import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT = join(process.cwd(), ".output");
const PUBLIC = join(process.cwd(), "..", "web", "public", "extension");

// The dashboard links these names, so a version bump must not change the download URL
const WANTED = { chrome: "rewall-2fa-chrome.zip", firefox: "rewall-2fa-firefox.zip" };

// A development zip points at the local dashboard, and it publishes under the same names so the links never move
const dev = process.argv.includes("--dev");
const suffix = (browser) => (dev ? `-${browser}-dev.zip` : `-${browser}.zip`);

const built = await readdir(OUTPUT);
await mkdir(PUBLIC, { recursive: true });

const copied = [];
for (const [browser, name] of Object.entries(WANTED)) {
    const source = built.find((file) => file.endsWith(suffix(browser)));
    if (!source) throw new Error(`no ${browser} zip named ${suffix(browser)} in .output`);

    await copyFile(join(OUTPUT, source), join(PUBLIC, name));
    const { size } = await stat(join(PUBLIC, name));
    copied.push({ browser, name, kb: Math.round(size / 1024) });
}

console.log(JSON.stringify({ into: PUBLIC, dashboard: dev ? "localhost" : "rewall.me", copied }, null, 2));
