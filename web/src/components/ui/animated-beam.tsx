"use client";

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

interface AnimatedBeamProps {
    /** The positioned element both refs live inside. */
    containerRef: RefObject<HTMLElement | null>;
    fromRef: RefObject<HTMLElement | null>;
    toRef: RefObject<HTMLElement | null>;
    /** Arc height in pixels. Positive bows up, negative bows down, 0 is straight. */
    curvature?: number;
    /** Route as a right angle, down the start column and then across, instead of a curve. */
    elbow?: boolean;
    /** Leave and arrive on the elements' facing edges instead of running to their centres. */
    edge?: boolean;
    /** Send the pulse from `toRef` to `fromRef` instead. */
    reverse?: boolean;
    /** Pixels per second. Overrides `duration` so beams of different lengths travel at one speed. */
    speed?: number;
    duration?: number;
    delay?: number;
    pathColor?: string;
    gradientStart?: string;
    gradientStop?: string;
    className?: string;
}

/* The lit head and the dimmer trail behind it, in pixels of path */
const HEAD = 16;
const TRAIL = 58;

/**
 * Draws a beam between two elements and sends a pulse along it.
 *
 * The path is measured from the live geometry of the two elements rather than
 * hardcoded, so it survives responsive reflow, font loading and content
 * changes: a `ResizeObserver` on the container recomputes it whenever
 * anything moves.
 */
export function AnimatedBeam({
    containerRef,
    fromRef,
    toRef,
    curvature = 0,
    elbow = false,
    edge = false,
    reverse = false,
    speed = 0,
    duration = 3,
    delay = 0,
    pathColor = "var(--border)",
    gradientStart = "var(--brand)",
    gradientStop = "var(--accent-pink)",
    className = "",
}: AnimatedBeamProps) {
    const [path, setPath] = useState("");
    const [length, setLength] = useState(0);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const railRef = useRef<SVGPathElement>(null);
    const prefersReducedMotion = useReducedMotion();

    const measure = useCallback(() => {
        const container = containerRef.current;
        const from = fromRef.current;
        const to = toRef.current;
        if (!container || !from || !to) return;

        const containerRect = container.getBoundingClientRect();
        const fromRect = from.getBoundingClientRect();
        const toRect = to.getBoundingClientRect();

        setSize({ width: containerRect.width, height: containerRect.height });

        // Centres, expressed relative to the container's own coordinate space.
        let sx = fromRect.left - containerRect.left + fromRect.width / 2;
        let sy = fromRect.top - containerRect.top + fromRect.height / 2;
        let ex = toRect.left - containerRect.left + toRect.width / 2;
        let ey = toRect.top - containerRect.top + toRect.height / 2;

        if (edge) {
            const right = ex > sx;
            const down = ey > sy;
            // An elbow leaves on its vertical leg and arrives on its horizontal one
            if (elbow && Math.abs(ey - sy) > fromRect.height / 2) {
                sy = (down ? fromRect.bottom : fromRect.top) - containerRect.top;
                ex = (right ? toRect.left : toRect.right) - containerRect.left;
            } else if (Math.abs(ex - sx) >= Math.abs(ey - sy)) {
                sx = (right ? fromRect.right : fromRect.left) - containerRect.left;
                ex = (right ? toRect.left : toRect.right) - containerRect.left;
            } else {
                sy = (down ? fromRect.bottom : fromRect.top) - containerRect.top;
                ey = (down ? toRect.top : toRect.bottom) - containerRect.top;
            }
        }

        // Snapped to whole pixels, because a rail on a half pixel is drawn as two grey rows, never a line
        const startX = Math.round(sx);
        const startY = Math.round(sy);
        const endX = Math.round(ex);
        const endY = Math.round(ey);

        const controlX = (startX + endX) / 2;
        const controlY = (startY + endY) / 2 - curvature;

        setPath(
            elbow
                ? `M ${startX},${startY} V ${endY} H ${endX}`
                : `M ${startX},${startY} Q ${controlX},${controlY} ${endX},${endY}`,
        );
    }, [containerRef, fromRef, toRef, curvature, elbow, edge]);

    useEffect(() => {
        measure();

        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver(measure);
        observer.observe(container);
        // Watch the endpoints too: the container can hold its size while the
        // elements inside it move.
        if (fromRef.current) observer.observe(fromRef.current);
        if (toRef.current) observer.observe(toRef.current);

        return () => observer.disconnect();
    }, [measure, containerRef, fromRef, toRef]);

    // Measured off the rail itself, so a corner or a curve is counted at its true length
    useEffect(() => {
        if (railRef.current) setLength(railRef.current.getTotalLength());
    }, [path]);

    // An axis aligned run is drawn without antialiasing, which is the whole difference between a rail
    // and a soft grey smear. A curve needs the smoothing, so it keeps it.
    const render = elbow || !curvature ? "crispEdges" : "auto";
    const span = length + TRAIL;
    const sweep = {
        duration: speed ? span / speed : duration,
        delay,
        repeat: Infinity,
        repeatDelay: 0.4,
        ease: "linear" as const,
    };
    // The pulse is a dash travelling the path, not a gradient swept across the box, because a gradient
    // is a straight band and would light both legs of an elbow at once instead of turning the corner.
    const run = (dash: number, lead: number) => ({
        strokeDasharray: `${dash} ${span}`,
        initial: { strokeDashoffset: reverse ? lead - span : lead },
        animate: { strokeDashoffset: reverse ? lead : lead - span },
        transition: sweep,
    });

    if (!path) return null;

    return (
        <svg
            fill="none"
            width={size.width}
            height={size.height}
            viewBox={`0 0 ${size.width} ${size.height}`}
            aria-hidden="true"
            /*
             * `overflow-visible` because the arc is not obliged to stay inside the
             * box the endpoints describe. The SVG is sized to the container, and an
             * SVG clips to its viewport by default, so a curvature taller than the
             * gap between the two elements had its whole middle cut away: at
             * `curvature={90}` across a row of 44px nodes, everything but a stub at
             * each end. The container decides where the beam is allowed to draw;
             * the beam should not clip itself.
             */
            className={`beam-svg ${className}`.trim()}
        >
            {/* Opaque, so two beams sharing a trunk paint the same grey as one and the seam disappears */}
            <path ref={railRef} d={path} stroke={pathColor} strokeWidth={2} shapeRendering={render} />
            {length > 0 && !prefersReducedMotion && (
                <>
                    <motion.path
                        d={path}
                        stroke={gradientStop}
                        strokeWidth={2}
                        shapeRendering={render}
                        {...run(TRAIL, TRAIL)}
                    />
                    <motion.path
                        d={path}
                        stroke={gradientStart}
                        strokeWidth={2}
                        shapeRendering={render}
                        {...run(HEAD, HEAD)}
                    />
                </>
            )}
        </svg>
    );
}

export default AnimatedBeam;
