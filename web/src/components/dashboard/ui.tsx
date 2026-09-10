"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

export type IconName =
    | "home"
    | "key"
    | "lock"
    | "shield"
    | "wallet"
    | "authenticator"
    | "github"
    | "documents"
    | "folder_search"
    | "hamburger_menu";

/* Stroke drawings on the Arcticons 48 grid for the controls the icon set has no entry for */
const GLYPHS = {
    close: "M15 15L33 33M33 15L15 33",
    pause: "M19 13V35M29 13V35",
    play: "M18 12L36 24L18 36Z",
    refresh: "M33.9 33.9A14 14 0 1 1 36.7 18.1M37.7 12.2L36.7 18.1L31.5 15.1",
} as const;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
    return (
        <Image
            className="arc-icon"
            src={`/arcticons/${name}.svg`}
            width={size}
            height={size}
            alt=""
            aria-hidden="true"
            unoptimized
        />
    );
}

export function Glyph({ name, size = 20 }: { name: keyof typeof GLYPHS; size?: number }) {
    return (
        <svg
            className="glyph"
            width={size}
            height={size}
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d={GLYPHS[name]} />
        </svg>
    );
}

export function SegmentedProgress({
    value,
    max,
    label,
    segments = 24,
}: {
    value: number;
    max: number;
    label: string;
    segments?: number;
}) {
    const reduced = useReducedMotion();
    const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
    const filled = ratio > 0 ? Math.max(1, Math.round(ratio * segments)) : 0;
    return (
        <div
            className="segmented-progress"
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={value}
        >
            {Array.from({ length: segments }, (_, index) => (
                <motion.span
                    key={index}
                    initial={{ backgroundColor: "#2f2f2f" }}
                    animate={{ backgroundColor: index < filled ? "#dcdcd4" : "#2f2f2f" }}
                    transition={{ duration: reduced ? 0 : 0.28, delay: reduced ? 0 : index * 0.024 }}
                />
            ))}
        </div>
    );
}

export function CopyButton({ value, label = "Copy name" }: { value: string; label?: string }) {
    const [status, setStatus] = useState("");
    async function copy() {
        try {
            await navigator.clipboard.writeText(value);
            setStatus("Copied");
        } catch {
            setStatus("Copy unavailable");
        }
    }
    return (
        <button className="button small" onClick={copy} aria-label={label}>
            <span aria-live="polite">{status || "Copy"}</span>
        </button>
    );
}
