"use client";

/*
 * The agent exchange, played back one turn at a time and looped. Every turn is always in the DOM and
 * only its opacity moves, so the panel never resizes as the talk builds and a reader with scripting
 * off still gets the whole transcript. The reset happens before the first paint rather than after,
 * which is what keeps the finished conversation from flashing on load.
 */

import { useEffect, useLayoutEffect, useState } from "react";

const useBeforePaint = typeof document === "undefined" ? useEffect : useLayoutEffect;

type Turn = { from: "user" | "agent"; text: string } | { from: "tool"; call: string; back: string };

const TALK: Turn[] = [
    { from: "user", text: "List the models my key can reach." },
    {
        from: "tool",
        call: 'http_with_secret("openai-key", "/v1/models")',
        back: "200 OK · authorization:",
    },
    { from: "agent", text: "Got the list. The key stayed inside the tool process." },
    { from: "user", text: "Paste it into CI for me." },
    { from: "agent", text: "I never receive it. Grant ci.alice.eth instead." },
];

const OPENING = 500;
const TURN = 1500;
const HOLD = 4500;

export function AgentChat() {
    const [shown, setShown] = useState(TALK.length);

    useBeforePaint(() => {
        if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setShown(0);
    }, []);

    useEffect(() => {
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const done = shown >= TALK.length;
        const wait = shown === 0 ? OPENING : done ? HOLD : TURN;
        const timer = window.setTimeout(() => setShown(done ? 0 : shown + 1), wait);
        return () => clearTimeout(timer);
    }, [shown]);

    return (
        <div className="b-panel-body b-chat">
            {TALK.map((turn, index) => {
                const state = index < shown ? "b-turn" : "b-turn is-waiting";
                if (turn.from === "tool")
                    return (
                        <div className={`${state} b-tool`} key={turn.call}>
                            <code>{turn.call}</code>
                            <span>
                                {turn.back} <mark>redacted</mark>
                            </span>
                        </div>
                    );
                return (
                    <p className={`${state} b-msg from-${turn.from}`} key={turn.text}>
                        {turn.text}
                    </p>
                );
            })}
        </div>
    );
}
