import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { artifacts } from "./lib/artifacts.mjs";
const output = await artifacts();
const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ["--enable-unsafe-swiftshader"],
});
const source = await readFile("src/components/dashboard/liquid-metal-button.tsx", "utf8");
try {
    for (const baseline of [true, false]) {
        const result = await build({
            stdin: {
                contents: `import React from 'react';import{createRoot}from'react-dom/client';import{LiquidMetalButton}from'./src/components/dashboard/liquid-metal-button';const root=createRoot(document.getElementById('root'));root.render(<LiquidMetalButton fullWidth label="Add secret" onClick={()=>window.clicked=true}/>);window.unmount=()=>root.unmount();`,
                loader: "tsx",
                resolveDir: process.cwd(),
            },
            bundle: true,
            write: false,
            jsx: "automatic",
            define: { "process.env.NODE_ENV": '"production"' },
            plugins: baseline
                ? [
                      {
                          name: "old-shader-settings",
                          setup(b) {
                              b.onLoad({ filter: /liquid-metal-button\.tsx$/ }, () => ({
                                  contents: source
                                      .replace("u_shape: LiquidMetalShapes.none", "u_shape: 1")
                                      .replace("u_originX: 0.5", "u_originX: 0")
                                      .replace("u_originY: 0.5", "u_originY: 0")
                                      .replace("u_offsetX: 0,", "u_offsetX: 0.1,")
                                      .replace("u_offsetY: 0,", "u_offsetY: -0.1,"),
                                  loader: "tsx",
                              }));
                          },
                      },
                  ]
                : [],
        });
        const page = await browser.newPage({ viewport: { width: 244, height: 90 }, deviceScaleFactor: 1 });
        await page.setContent(
            '<style>*{box-sizing:border-box}body{margin:0;padding:12px;background:#161616;font:14px sans-serif}button{font:inherit}#root{width:220px}</style><div id="root"></div>',
        );
        await page.addScriptTag({ content: result.outputFiles[0].text });
        await expect(page.locator("canvas")).toBeVisible();
        for (const width of baseline ? [220] : [142, 220, 480, 960]) {
            await page.setViewportSize({ width: width + 24, height: 90 });
            await page.locator("#root").evaluate((el, w) => (el.style.width = w + "px"), width);
            await expect
                .poll(() => page.locator("canvas").evaluate((c) => c.width), { timeout: 15000 })
                .toBe(width * 2);
            const alpha = await page.locator(".shader-container-exploded").evaluate(async (el) => {
                const mount = el.paperShaderMount;
                mount.setSpeed(0);
                mount.setFrame(1000);
                return new Promise((resolve) =>
                    requestAnimationFrame(() => {
                        const c = el.querySelector("canvas");
                        const gl = c.getContext("webgl2");
                        const pixels = new Uint8Array(c.width * c.height * 4);
                        gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                        const at = (x, y) => pixels[(y * c.width + x) * 4 + 3];
                        resolve({
                            left: at(0, Math.floor(c.height / 2)),
                            right: at(c.width - 1, Math.floor(c.height / 2)),
                            topRight: at(c.width - 3, c.height - 1),
                            bottomRight: at(c.width - 3, 0),
                            buffer: [c.width, c.height],
                        });
                    }),
                );
            });
            console.log(baseline ? "Before" : "After", width, alpha);
            if (baseline) assert.equal(alpha.right, 0, "Must reproduce the missing right edge");
            else
                for (const edge of ["left", "right", "topRight", "bottomRight"])
                    assert.equal(alpha[edge], 255, width + " " + edge + " must contain shader pixels");
            if (width === 220)
                await page.screenshot({ path: output + "/metal-coverage-" + (baseline ? "before" : "after") + ".png" });
        }
        await page.locator("button").click();
        assert(await page.evaluate(() => window.clicked));
        await page.evaluate(() => window.unmount());
        await expect(page.locator("canvas")).toHaveCount(0);
        await page.close();
    }
    console.log("Shader pixel coverage, resizing, click and cleanup checks passed. Screenshots:", output);
} finally {
    await browser.close();
}
