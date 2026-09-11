"use client";

import { useEffect, useRef } from "react";

// Adapted from React Bits Dot Grid, see reactbits-NOTICE.md
export function DotGrid() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        const host = canvas?.parentElement;
        const context = canvas?.getContext("2d");
        if (!canvas || !host || !context) return;
        const motion = matchMedia("(prefers-reduced-motion: reduce)");
        let width = 0;
        let height = 0;
        let frame = 0;
        let pointer = { x: -1000, y: -1000 };
        const draw = () => {
            context.clearRect(0, 0, width, height);
            const cell = 16;
            const cols = Math.floor(width / cell);
            const rows = Math.floor(height / cell);
            const startX = (width - (cols - 1) * cell) / 2;
            const startY = (height - (rows - 1) * cell) / 2;
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const x = startX + col * cell;
                    const y = startY + row * cell;
                    const distance = Math.hypot(x - pointer.x, y - pointer.y);
                    const intensity = motion.matches ? 0 : Math.max(0, 1 - distance / 140);
                    const shade = Math.round(64 + (170 - 64) * intensity);
                    context.fillStyle = `rgb(${shade},${shade},${shade})`;
                    context.beginPath();
                    context.arc(x, y, 1, 0, Math.PI * 2);
                    context.fill();
                }
            }
        };
        const resize = () => {
            const rect = host.getBoundingClientRect();
            width = rect.width;
            height = rect.height;
            const dpr = Math.min(devicePixelRatio || 1, 2);
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            draw();
        };
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(draw);
        };
        const move = (event: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            schedule();
        };
        const leave = () => {
            pointer = { x: -1000, y: -1000 };
            schedule();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(host);
        resize();
        host.addEventListener("pointermove", move);
        host.addEventListener("pointerleave", leave);
        motion.addEventListener("change", schedule);
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
            host.removeEventListener("pointermove", move);
            host.removeEventListener("pointerleave", leave);
            motion.removeEventListener("change", schedule);
        };
    }, []);
    return <canvas className="extension-dot-grid" ref={canvasRef} aria-hidden="true" />;
}
