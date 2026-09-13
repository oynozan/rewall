// Rasterizes the toolbar icon from the one brand mark the dashboard uses, so the two never drift apart

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const SOURCE = join(process.cwd(), "..", "web", "public", "icon.svg");
const INTO = join(process.cwd(), "public", "icon");
const SIZES = [16, 32, 48, 128];

// The mark is white on nothing, which disappears on a light toolbar, so it is set on the dashboard's own dark tile
const PLATE = "#1c1c1c";

// c2pa metadata is several kilobytes of base64 that no renderer reads
const mark = (await readFile(SOURCE, "utf8")).replace(/<metadata>[\s\S]*?<\/metadata>/, "");

const page = (size) => {
    // The mark is taller than it is wide, so it is fitted by height and the radius follows the size
    const inset = Math.max(1, Math.round(size * 0.16));
    const radius = Math.round(size * 0.22);
    return `<!doctype html><meta charset="utf-8"><style>
        html, body { margin: 0; background: transparent }
        .tile {
            width: ${size}px; height: ${size}px; border-radius: ${radius}px; background: ${PLATE};
            display: grid; place-items: center; overflow: hidden;
        }
        .tile svg { height: ${size - inset * 2}px; width: auto; display: block }
    </style><div class="tile">${mark}</div>`;
};

const browser = await chromium.launch();
await mkdir(INTO, { recursive: true });
const written = [];

for (const size of SIZES) {
    const view = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await view.setContent(page(size));
    const shot = await view.locator(".tile").screenshot({ omitBackground: true });
    await writeFile(join(INTO, `${size}.png`), shot);
    written.push({ size, bytes: shot.length });
    await view.close();
}

await browser.close();
console.log(JSON.stringify({ into: INTO, written }, null, 2));
