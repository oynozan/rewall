// Patterns are written out rather than generated, because a random fill would differ across hydration

import type { CSSProperties } from "react";

const RAMP = ["#2a2a2a", "#454543", "#8c8c89", "#ededeb"];

function tone(digit: string) {
    return RAMP[Number(digit)] ?? RAMP[0];
}

// Stagger is carried on the element so the CSS keyframes need no per child selector
const step = (i: number) => ({ "--i": i }) as CSSProperties;

/* Every padded blob is the same length, so the bars differ in tone and never in height */
const PADDING = "3323231121001021221211003312332103";

export function PaddingMark() {
    const width = 200 / PADDING.length;
    return (
        <svg className="mark" viewBox="0 0 200 92" role="img" aria-label="Bars of identical height in four tones">
            {[...PADDING].map((d, i) => (
                <rect
                    className="a-tone"
                    style={step(i)}
                    key={i}
                    x={i * width}
                    y={0}
                    width={width - 2}
                    height={92}
                    fill={tone(d)}
                />
            ))}
        </svg>
    );
}

/* The authorization counter only ever climbs, one step per change to the grantee lists */
const COUNTER = [
    [8, 78],
    [50, 78],
    [50, 60],
    [92, 60],
    [92, 40],
    [134, 40],
    [134, 22],
    [192, 22],
];

// The rider follows this exact path, so it stays welded to the drawing head instead of floating beside it
const TRACK = COUNTER.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");

export function CounterMark() {
    return (
        <svg className="mark" viewBox="0 0 200 92" role="img" aria-label="A step line climbing left to right">
            <g stroke="#2c2c2b" strokeWidth="1">
                {[0, 1, 2, 3, 4].map((i) => (
                    <line key={`h${i}`} x1="0" y1={8 + i * 19} x2="200" y2={8 + i * 19} />
                ))}
                {[0, 1, 2, 3, 4, 5].map((i) => (
                    <line key={`v${i}`} x1={4 + i * 39} y1="4" x2={4 + i * 39} y2="88" />
                ))}
            </g>
            <polyline
                className="a-draw"
                pathLength={1}
                points={COUNTER.map(([x, y]) => `${x},${y}`).join(" ")}
                fill="none"
                stroke="#ededeb"
                strokeWidth="2"
            />
            <rect className="a-node-start" x="4" y="74" width="8" height="8" fill="#ededeb" />
            <rect
                className="a-rider"
                style={{ offsetPath: `path("${TRACK}")` }}
                x={-4}
                y={-4}
                width="8"
                height="8"
                fill="#ededeb"
            />
        </svg>
    );
}

/* A slot holds a wrap or it does not, so the squares snap between the two rather than fading */
const SLOTS = 24;

export function SlotsMark() {
    return (
        <svg className="mark" viewBox="0 0 200 92" role="img" aria-label="A grid of slots filling and clearing">
            {Array.from({ length: SLOTS }, (_, i) => {
                const x = (i % 8) * 25 + 2;
                const y = Math.floor(i / 8) * 31 + 1;
                return (
                    <g key={i}>
                        <rect x={x + 0.5} y={y + 0.5} width={20} height={26} fill="none" stroke="#3c3c3a" />
                        <rect className="a-slot" style={step(i)} x={x} y={y} width={21} height={27} fill="#ededeb" />
                    </g>
                );
            })}
        </svg>
    );
}

/* Records sit side by side under one resolver, keyed by namehash, so they never collide */
const RECORDS = "3213023112033120321302";

export function RecordsMark() {
    const rows = 11;
    const height = 92 / rows;
    // Viewbox units, chosen so the stripes sit 2px apart at the size this mark actually renders
    // The same value runs down the seam, which the two halves scale away from rather than across
    const gap = 1.3;
    return (
        <svg className="mark" viewBox="0 0 200 92" role="img" aria-label="Rows of stripes shifting width and tone">
            {Array.from({ length: rows }, (_, r) => {
                const split = 60 + ((r * 37) % 90);
                return (
                    <g className="a-tone" style={step(r)} key={r}>
                        <rect
                            className="a-col-l"
                            x={0}
                            y={r * height}
                            width={split}
                            height={height - gap}
                            fill={tone(RECORDS[r * 2])}
                        />
                        <rect
                            className="a-col-r"
                            x={split + gap}
                            y={r * height}
                            width={200 - split - gap}
                            height={height - gap}
                            fill={tone(RECORDS[r * 2 + 1])}
                        />
                    </g>
                );
            })}
        </svg>
    );
}
