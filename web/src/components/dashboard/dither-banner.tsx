"use client";

import { useEffect, useRef } from "react";

const BAYER = [
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30,
    54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23,
    61, 29, 53, 21,
];

export function DitherBanner() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;
        const media = matchMedia("(prefers-reduced-motion: reduce)");
        let frame = 0;
        let lastTime = 0;
        let phase = 0;
        let visible = true;
        let pixels: ImageData;
        const draw = (time: number) => {
            const width = canvas.width;
            const height = canvas.height;
            if (!pixels || pixels.width !== width || pixels.height !== height)
                pixels = context.createImageData(width, height);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const u = x / width;
                    const v = y / height;
                    const bend = Math.sin(u * 9 + v * 3 + time * 0.22) * 0.8;
                    const field =
                        Math.sin(u * 13 + v * 6 + bend + time * 0.12) +
                        Math.cos(v * 9 - u * 4 + time * 0.18) * 0.62 +
                        Math.sin(u * 23 - v * 12 + time * 0.08) * 0.3;
                    const intensity = Math.max(0, Math.min(0.87, (field + 0.65) * 0.32));
                    const on = intensity > (BAYER[(y % 8) * 8 + (x % 8)] + 0.5) / 64;
                    const offset = (y * width + x) * 4;
                    pixels.data[offset] = on ? 214 : 22;
                    pixels.data[offset + 1] = on ? 214 : 22;
                    pixels.data[offset + 2] = on ? 214 : 22;
                    pixels.data[offset + 3] = 255;
                }
            }
            context.putImageData(pixels, 0, 0);
        };
        const tick = (time: number) => {
            if (time - lastTime > 70) {
                phase += 0.065;
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
            canvas.width = Math.max(1, Math.round(canvas.clientWidth / 2));
            canvas.height = Math.max(1, Math.round(canvas.clientHeight / 2));
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

    return (
        <section className="welcome-banner" aria-label="Welcome to Rewall">
            <canvas ref={canvasRef} aria-hidden="true" />
            <div className="welcome-copy">
                <h1>Welcome to Rewall.</h1>
            </div>
        </section>
    );
}
