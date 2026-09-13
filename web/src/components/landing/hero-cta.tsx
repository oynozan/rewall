"use client";

import { LiquidMetalButton } from "@/src/components/dashboard/liquid-metal-button";

// The shader button sizes itself from its container, so the width lives here rather than in its props
export function HeroCta({ label, href }: { label: string; href: string }) {
    return (
        <span className="hero-metal">
            <LiquidMetalButton label={label} href={href} fullWidth />
        </span>
    );
}
