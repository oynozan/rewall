"use client";

import Image from "next/image";
import { useState } from "react";

export type IconName =
    | "chrome"
    | "firefox"
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
    chevron_right: "M18 12L30 24L18 36",
    close: "M15 15L33 33M33 15L15 33",
    refresh: "M33.9 33.9A14 14 0 1 1 33.9 14.1M34.2 7.6L33.9 14.1L27.4 14.4",
    copy: "M17 17H35V36H17ZM11 30H9V10H28V12",
    magic_wand: "M10 36L31 15L36 20L15 41ZM27 19L32 24M13 8V16M9 12H17M35 5V11M32 8H38M38 29V37M34 33H42",
    warning: "M24 8L43 40H5ZM24 19V29M24 34V35",
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
                <span
                    key={index}
                    style={{ backgroundColor: index < filled ? "var(--progress-fill, #dcdcd4)" : "#2f2f2f" }}
                />
            ))}
        </div>
    );
}

// A grey bar standing in for a value the chain has not answered for yet
// A control that is waiting needs a mark of its own, since a changed label alone reads as a dead button
export function Spinner({ size = 13 }: { size?: number }) {
    return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function Skeleton({ width = 60, height = 12 }: { width?: number | string; height?: number }) {
    return <span className="skel" style={{ width, height }} aria-hidden="true" />;
}

// Grey rows hold a table at its real height, with the name bar over whichever column the real rows start it in
export function SkeletonRows({ rows, columns, offset = 0 }: { rows: number; columns: number; offset?: number }) {
    return (
        <>
            {Array.from({ length: rows }, (_, row) => (
                <tr key={row}>
                    {offset > 0 && <td />}
                    <td colSpan={2 - offset}>
                        <Skeleton width={150} />
                    </td>
                    {Array.from({ length: columns - 2 }, (_, cell) => (
                        <td key={cell}>
                            <Skeleton width={72} />
                        </td>
                    ))}
                </tr>
            ))}
        </>
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

export function TableColumns() {
    return (
        <colgroup>
            <col className="table-select-col" />
            <col className="table-name-col" />
            <col className="table-data-col" />
            <col className="table-status-col" />
            <col className="table-end-col" />
        </colgroup>
    );
}
