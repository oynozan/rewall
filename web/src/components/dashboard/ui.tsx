"use client";

import Image from "next/image";
import { useState } from "react";

export type IconName =
    | "home"
    | "key"
    | "lock"
    | "bitwarden"
    | "authenticator"
    | "github"
    | "documents"
    | "folder_shared"
    | "folder_search"
    | "folder_settings";

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
    const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
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
                <span key={index} className={index < Math.round((percent / 100) * segments) ? "filled" : ""} />
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
