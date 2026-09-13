"use client";

import { useEffect, useRef } from "react";

const BAYER = [
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30,
    54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23,
    61, 29, 53, 21,
];
const THRESHOLD = Float32Array.from(BAYER, (v) => (v + 0.5) / 64);

const SHEET = 22;
const LIT = 52;
/* The field is smooth, so it is sampled every CELL pixels and interpolated back up to one dot per pixel */
const CELL = 4;

const TAU = Math.PI * 2;
const STEPS = 4096;
const WAVE = new Float32Array(STEPS);
for (let i = 0; i < STEPS; i++) WAVE[i] = Math.sin((i / STEPS) * TAU);
const INDEX = STEPS / TAU;
const QUARTER = STEPS >> 2;

/* Truncation is signed and the mask wraps negatives back into range, which is the behaviour wanted */
function wave(angle: number) {
    return WAVE[((angle * INDEX) | 0) & (STEPS - 1)];
}
function cowave(angle: number) {
    return WAVE[(((angle * INDEX) | 0) + QUARTER) & (STEPS - 1)];
}

export function HeroDither() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;
        const media = matchMedia("(prefers-reduced-motion: reduce)");
        const on = (0xff << 24) | (LIT << 16) | (LIT << 8) | LIT;
        const off = (0xff << 24) | (SHEET << 16) | (SHEET << 8) | SHEET;

        let frame = 0;
        let lastTime = 0;
        let phase = 0;
        let visible = true;
        let width = 0;
        let height = 0;
        let pixels: ImageData;
        let words: Uint32Array;
        let grid: Float32Array;
        let gridW = 0;
        let gridH = 0;
        let columnOf: Int32Array;
        let blendOf: Float32Array;

        const measure = () => {
            width = canvas.width;
            height = canvas.height;
            pixels = context.createImageData(width, height);
            words = new Uint32Array(pixels.data.buffer);
            gridW = Math.ceil(width / CELL) + 1;
            gridH = Math.ceil(height / CELL) + 1;
            grid = new Float32Array(gridW * gridH);
            // The horizontal bracket and weight repeat every row, so they are resolved once per resize
            columnOf = new Int32Array(width);
            blendOf = new Float32Array(width);
            for (let x = 0; x < width; x++) {
                const at = x / CELL;
                columnOf[x] = at | 0;
                blendOf[x] = at - (at | 0);
            }
        };

        const draw = (time: number) => {
            if (!pixels || pixels.width !== canvas.width || pixels.height !== canvas.height) measure();

            for (let gy = 0; gy < gridH; gy++) {
                const v = (gy * CELL) / height;
                const bendRow = v * 2 + time * 0.18;
                const oneRow = v * 4 + time * 0.1;
                const twoRow = v * 6 + time * 0.14;
                const threeRow = -v * 8 + time * 0.07;
                const at = gy * gridW;
                for (let gx = 0; gx < gridW; gx++) {
                    const u = (gx * CELL) / width;
                    const bend = wave(u * 6 + bendRow) * 0.7;
                    const field =
                        wave(u * 9 + oneRow + bend) + cowave(twoRow - u * 3) * 0.6 + wave(u * 16 + threeRow) * 0.28;
                    grid[at + gx] = (field + 0.6) * 0.26;
                }
            }

            for (let y = 0; y < height; y++) {
                const at = y / CELL;
                const row = at | 0;
                const down = at - row;
                const top = row * gridW;
                const bottom = top + gridW;
                const bayerRow = (y & 7) * 8;
                const line = y * width;
                for (let x = 0; x < width; x++) {
                    const column = columnOf[x];
                    const across = blendOf[x];
                    const a = grid[top + column];
                    const b = grid[top + column + 1];
                    const c = grid[bottom + column];
                    const d = grid[bottom + column + 1];
                    const upper = a + (b - a) * across;
                    const lower = c + (d - c) * across;
                    const intensity = upper + (lower - upper) * down;
                    words[line + x] = intensity > THRESHOLD[bayerRow + (x & 7)] ? on : off;
                }
            }
            context.putImageData(pixels, 0, 0);
        };

        const tick = (time: number) => {
            if (time - lastTime > 90) {
                phase += 0.055;
                draw(phase);
                lastTime = time;
            }
            frame = requestAnimationFrame(tick);
        };
        const sync = () => {
            cancelAnimationFrame(frame);
            draw(phase);
            if (!media.matches && visible && !document.hidden) frame = requestAnimationFrame(tick);
        };
        const resize = new ResizeObserver(() => {
            canvas.width = Math.max(1, Math.round(canvas.clientWidth));
            canvas.height = Math.max(1, Math.round(canvas.clientHeight));
            sync();
        });
        const intersection = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            sync();
        });
        resize.observe(canvas);
        intersection.observe(canvas);
        media.addEventListener("change", sync);
        document.addEventListener("visibilitychange", sync);
        return () => {
            cancelAnimationFrame(frame);
            resize.disconnect();
            intersection.disconnect();
            media.removeEventListener("change", sync);
            document.removeEventListener("visibilitychange", sync);
        };
    }, []);

    return <canvas className="hero-dither" ref={canvasRef} aria-hidden="true" />;
}
