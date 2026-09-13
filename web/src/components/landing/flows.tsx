"use client";

/*
 * The three flows. Every node is a real element on a grid and every carrying line is an AnimatedBeam
 * measured between two of them, routed as a right angle so a rail lands on whole pixels and stays
 * sharp. A route that carries nothing is not a beam at all, it is a dashed run with a break struck
 * through it, which keeps a refusal impossible to mistake for a delivery.
 */

import { useRef, type ReactNode, type RefObject } from "react";

import { AnimatedBeam } from "@/src/components/ui/animated-beam";

/* The unlit rail, the trail behind the pulse, and the pulse itself */
const PATH = "#3a3a37";
const TRAIL = "#6a6a64";
const LIT = "#ededeb";

/* Pixels per second, shared by every beam so no rail outruns the one beside it */
const SPEED = 170;

type NodeRef = RefObject<HTMLDivElement | null>;

/* The mark stands wherever Rewall itself is the thing operating */
function Mark({ nodeRef }: { nodeRef: NodeRef }) {
    return (
        <div className="fl-node fl-mark" ref={nodeRef}>
            <svg viewBox="0 0 680 810" aria-hidden="true">
                <path
                    fill="currentColor"
                    fillRule="evenodd"
                    d="M20,20 L660,340 L660,790 L20,470 Z M340,205 L630,350 L630,550 L340,405 Z M50,260 L340,405 L340,605 L50,460 Z"
                />
                <polygon points="20,20 660,340 660,790 20,470" fill="none" stroke="currentColor" strokeWidth="6" />
            </svg>
        </div>
    );
}

function Person({ label, dim, nodeRef }: { label: string; dim?: boolean; nodeRef: NodeRef }) {
    return (
        <div className={dim ? "fl-node fl-person is-dim" : "fl-node fl-person"}>
            <div className="fl-person-anchor" ref={nodeRef} aria-hidden="true" />
            <svg viewBox="0 0 40 44" aria-hidden="true">
                <circle cx="20" cy="11" r="8" />
                <path d="M 4 42 a 16 16 0 0 1 32 0" />
            </svg>
            <span>{label}</span>
        </div>
    );
}

function Slab({ label, dim, nodeRef }: { label: string; dim?: boolean; nodeRef: NodeRef }) {
    return (
        <div className={dim ? "fl-node fl-slab is-dim" : "fl-node fl-slab"} ref={nodeRef}>
            <span>{label}</span>
        </div>
    );
}

/* A refusal reads as a route that exists and does not carry, so it is drawn and then struck */
function Refused({ children }: { children: ReactNode }) {
    return (
        <div className="fl-refused">
            <span className="fl-break" aria-hidden="true">
                <svg viewBox="0 0 16 16">
                    <line x1="3" y1="3" x2="13" y2="13" />
                    <line x1="13" y1="3" x2="3" y2="13" />
                </svg>
            </span>
            {children}
        </div>
    );
}

function Stage({ kind, children }: { kind: string; children: ReactNode }) {
    return <div className={`fl-stage fl-${kind}`}>{children}</div>;
}

export function TransfersFlow() {
    const stage = useRef<HTMLDivElement>(null);
    const alice = useRef<HTMLDivElement>(null);
    const mark = useRef<HTMLDivElement>(null);
    const charlie = useRef<HTMLDivElement>(null);
    const bob = useRef<HTMLDivElement>(null);
    const org = useRef<HTMLDivElement>(null);

    return (
        <div className="fl-wrap" ref={stage}>
            <Stage kind="transfers">
                <Person label="alice.eth" nodeRef={alice} />
                <Mark nodeRef={mark} />
                <Refused>
                    <Person label="charlie.eth" dim nodeRef={charlie} />
                </Refused>
                <Person label="bob.eth" nodeRef={bob} />
                <Person label="org.bob.eth" nodeRef={org} />
            </Stage>
            <AnimatedBeam
                containerRef={stage}
                edge
                fromRef={alice}
                toRef={mark}
                pathColor={PATH}
                gradientStart={LIT}
                gradientStop={TRAIL}
                speed={SPEED}
            />
            <AnimatedBeam
                containerRef={stage}
                edge
                fromRef={mark}
                toRef={bob}
                elbow
                pathColor={PATH}
                gradientStart={LIT}
                gradientStop={TRAIL}
                speed={SPEED}
                delay={0.35}
            />
            <AnimatedBeam
                containerRef={stage}
                edge
                fromRef={mark}
                toRef={org}
                elbow
                pathColor={PATH}
                gradientStart={LIT}
                gradientStop={TRAIL}
                speed={SPEED}
                delay={0.7}
            />
        </div>
    );
}

export function TwoFactorFlow() {
    const stage = useRef<HTMLDivElement>(null);
    const alice = useRef<HTMLDivElement>(null);
    const mark = useRef<HTMLDivElement>(null);
    const lookalike = useRef<HTMLDivElement>(null);
    const site = useRef<HTMLDivElement>(null);

    return (
        <div className="fl-wrap" ref={stage}>
            <Stage kind="twofactor">
                <Person label="alice.eth" nodeRef={alice} />
                <Mark nodeRef={mark} />
                <Refused>
                    <Slab label="g1thub.com" dim nodeRef={lookalike} />
                </Refused>
                <Slab label="github.com" nodeRef={site} />
            </Stage>
            <AnimatedBeam
                containerRef={stage}
                edge
                fromRef={alice}
                toRef={mark}
                pathColor={PATH}
                gradientStart={LIT}
                gradientStop={TRAIL}
                speed={SPEED}
            />
            <AnimatedBeam
                containerRef={stage}
                edge
                fromRef={mark}
                toRef={site}
                elbow
                pathColor={PATH}
                gradientStart={LIT}
                gradientStop={TRAIL}
                speed={SPEED}
                delay={0.35}
            />
        </div>
    );
}

export function AgentFlow() {
    const stage = useRef<HTMLDivElement>(null);
    const alice = useRef<HTMLDivElement>(null);
    const mark = useRef<HTMLDivElement>(null);
    const model = useRef<HTMLDivElement>(null);
    const api = useRef<HTMLDivElement>(null);

    return (
        <div className="fl-wrap" ref={stage}>
            <Stage kind="agent">
                <Person label="alice.eth" nodeRef={alice} />
                <Mark nodeRef={mark} />
                <Refused>
                    <Slab label="Model" dim nodeRef={model} />
                </Refused>
                <Slab label="Allowed model" nodeRef={api} />
            </Stage>
            <AnimatedBeam
                containerRef={stage}
                edge
                fromRef={alice}
                toRef={mark}
                pathColor={PATH}
                gradientStart={LIT}
                gradientStop={TRAIL}
                speed={SPEED}
            />
            <AnimatedBeam
                containerRef={stage}
                edge
                fromRef={mark}
                toRef={api}
                elbow
                pathColor={PATH}
                gradientStart={LIT}
                gradientStop={TRAIL}
                speed={SPEED}
                delay={0.35}
            />
        </div>
    );
}
