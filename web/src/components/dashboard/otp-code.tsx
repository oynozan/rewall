"use client";

import { useEffect, useState } from "react";
import type { TOTP } from "otpauth";
import { otpSnapshot } from "@/src/lib/otp";
import { Glyph, SegmentedProgress } from "./ui";

export function OtpCode({ otp, label }: { otp: TOTP; label: string }) {
    const [timestamp, setTimestamp] = useState<number | null>(null);
    const [status, setStatus] = useState("");
    useEffect(() => {
        const tick = () => setTimestamp(Math.floor(Date.now() / 1000) * 1000);
        const timer = window.setInterval(tick, 250);
        document.addEventListener("visibilitychange", tick);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", tick);
        };
    }, []);
    useEffect(() => {
        if (!status) return;
        const timer = window.setTimeout(() => setStatus(""), 2000);
        return () => clearTimeout(timer);
    }, [status]);
    const snapshot = timestamp === null ? null : otpSnapshot(otp, timestamp);
    async function copy() {
        try {
            await navigator.clipboard.writeText(otpSnapshot(otp, Date.now()).code);
            setStatus("Copied");
        } catch {
            setStatus("Copy unavailable");
        }
    }
    return (
        <div className="otp-live">
            <div className="otp-copy-wrap">
                <button className="otp-code" aria-label={`Copy code for ${label}`} onClick={copy} disabled={!snapshot}>
                    <span className="otp-digits mono" aria-hidden="true">
                        {snapshot?.code.replace(/(.{3,4})(.{3,4})$/, "$1 $2") || "••• •••"}
                    </span>
                    <span className="otp-tooltip" aria-hidden="true">
                        <Glyph name="copy" size={20} />
                    </span>
                </button>
                <span className="otp-copy-status" role="status">
                    {status}
                </span>
            </div>
            <div className="otp-timer">
                <SegmentedProgress
                    value={snapshot?.remaining || 0}
                    max={otp.period}
                    segments={20}
                    label={`${label} code expires in ${snapshot?.remaining || 0} seconds`}
                />
                <span className="mono">{snapshot ? `${snapshot.remaining}s` : "—"}</span>
            </div>
        </div>
    );
}
