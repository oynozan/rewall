"use client";

/*
 * The extension popup, running on the same thirty second step a real authenticator does. The step is
 * taken off the wall clock rather than a timer, so the bar is where it would be on a page opened
 * mid step, and each new step draws a fresh code. The digits are random because there is no secret
 * on a landing page, which is also why nothing here claims to be a code for anything.
 */

import { useEffect, useState } from "react";

import { SegmentedProgress } from "@/src/components/dashboard/ui";

const PERIOD = 30;

const digits = () =>
    Math.floor(Math.random() * 1000000)
        .toString()
        .padStart(6, "0")
        .replace(/(\d{3})(\d{3})/, "$1 $2");

export function OtpDemo() {
    const [now, setNow] = useState<number | null>(null);
    const [shown, setShown] = useState({ step: -1, code: "••• •••" });

    useEffect(() => {
        const tick = () => setNow(Date.now());
        tick();
        const timer = window.setInterval(tick, 250);
        // A tab that comes back has missed every tick it was hidden for, so it re-reads the clock
        document.addEventListener("visibilitychange", tick);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", tick);
        };
    }, []);

    // Drawn during render rather than in an effect, so the first painted code matches the first bar
    const step = now === null ? -1 : Math.floor(now / 1000 / PERIOD);
    if (step !== -1 && step !== shown.step) setShown({ step, code: digits() });

    const remaining = now === null ? PERIOD : PERIOD - (Math.floor(now / 1000) % PERIOD);
    const share = remaining / PERIOD;
    const urgency = share <= 1 / 3 ? "low" : share <= 2 / 3 ? "medium" : "high";

    return (
        <div className="b-panel-body b-popup">
            <div className="b-popup-row">
                <div>
                    <strong>github.com</strong>
                    <em>github.rewall.alice.eth</em>
                </div>
                <b className="b-code">{shown.code}</b>
            </div>
            <div className="b-meter" data-urgency={now === null ? "high" : urgency}>
                <SegmentedProgress
                    value={now === null ? PERIOD : remaining}
                    max={PERIOD}
                    segments={30}
                    label={`This code expires in ${remaining} seconds`}
                />
                <span className="b-meter-count">{now === null ? "—" : `${remaining}s`}</span>
            </div>
        </div>
    );
}
