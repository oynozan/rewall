"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { otpSnapshot, type TOTP } from "@rewall/sdk/2fa";
import { Glyph, SegmentedProgress } from "./ui";

export function OtpCells({ otp, label }: { otp: TOTP; label: string }) {
    const [timestamp, setTimestamp] = useState<number | null>(null);
    useEffect(() => {
        const tick = () => setTimestamp(Math.floor(Date.now() / 1000) * 1000);
        const timer = window.setInterval(tick, 250);
        document.addEventListener("visibilitychange", tick);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", tick);
        };
    }, []);
    const snapshot = timestamp === null ? null : otpSnapshot(otp, timestamp);
    async function copy() {
        try {
            await navigator.clipboard.writeText(otpSnapshot(otp, Date.now()).code);
            toast("Code copied", { id: "otp-copy" });
        } catch {
            toast("Could not copy code", { id: "otp-copy" });
        }
    }
    return (
        <>
            <td className="otp-code-cell">
                <div className="otp-copy-wrap">
                    <button
                        className="otp-code"
                        aria-label={`Copy code for ${label}`}
                        onClick={copy}
                        disabled={!snapshot}
                    >
                        <span className="otp-digits mono" aria-hidden="true">
                            {snapshot?.code.replace(/(.{3,4})(.{3,4})$/, "$1 $2") || "••• •••"}
                        </span>
                        <span className="otp-tooltip" aria-hidden="true">
                            <Glyph name="copy" size={20} />
                        </span>
                    </button>
                </div>
            </td>
            <td className="otp-expiry-cell">
                <div
                    className="otp-timer"
                    data-urgency={
                        snapshot && snapshot.remaining / otp.period <= 1 / 3
                            ? "low"
                            : snapshot && snapshot.remaining / otp.period <= 2 / 3
                              ? "medium"
                              : "high"
                    }
                >
                    <SegmentedProgress
                        value={snapshot?.remaining || 0}
                        max={otp.period}
                        segments={20}
                        label={`${label} code expires in ${snapshot?.remaining || 0} seconds`}
                    />
                    <span className="mono">{snapshot ? `${snapshot.remaining}s` : "—"}</span>
                </div>
            </td>
        </>
    );
}
