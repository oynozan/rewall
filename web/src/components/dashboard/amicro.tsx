"use client";

import { motion, useReducedMotion } from "motion/react";

export function FadeIn({
    children,
    className = "",
    delay = 0,
}: {
    children: React.ReactNode;
    className?: string;
    delay?: number;
}) {
    const reduced = useReducedMotion();
    return (
        <motion.div
            className={className}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: reduced ? 0 : delay, ease: [0.215, 0.61, 0.355, 1] }}
        >
            {children}
        </motion.div>
    );
}

export function FadeDots() {
    const reduced = useReducedMotion();
    return (
        <span className="fade-dots" aria-label="Loading" role="status">
            {[0, 1, 2, 3].map((i) => (
                <motion.span
                    key={i}
                    animate={reduced ? { opacity: 0.6 } : { opacity: [0.2, 1, 0.2] }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2, ease: "linear" }}
                />
            ))}
        </span>
    );
}

export function SidebarFade({
    children,
    className,
    label,
}: {
    children: React.ReactNode;
    className: string;
    label: string;
}) {
    const reduced = useReducedMotion();
    return (
        <motion.aside
            className={className}
            aria-label={label}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.28, ease: [0.215, 0.61, 0.355, 1] }}
        >
            {children}
        </motion.aside>
    );
}

export function SidebarSection({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
    const reduced = useReducedMotion();
    return (
        <motion.section
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.36, delay: reduced ? 0 : delay, ease: [0.215, 0.61, 0.355, 1] }}
        >
            {children}
        </motion.section>
    );
}
