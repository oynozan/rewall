"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Onborda, OnbordaProvider, useOnborda, type CardComponentProps } from "onborda";
import { useWorkspace } from "./dashboard-shell";
import { Glyph } from "./ui";

const STORAGE_KEY = "rewall:onboarding:v1";
const subscribe = (notify: () => void) => {
    const media = matchMedia("(max-width: 760px)");
    media.addEventListener("change", notify);
    return () => media.removeEventListener("change", notify);
};
const isMobile = () => matchMedia("(max-width: 760px)").matches;
const serverMobile = () => false;

function rememberTour() {
    try {
        localStorage.setItem(STORAGE_KEY, "done");
    } catch {}
}

function TourCard({ step, currentStep, totalSteps, nextStep, prevStep }: CardComponentProps) {
    const { closeOnborda } = useOnborda();
    const card = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
    const [box, setBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const finish = () => {
        rememberTour();
        closeOnborda();
    };

    useEffect(() => {
        const target = document.querySelector(step.selector);
        let frame = 0;
        const measure = () => {
            if (!target) return;
            const rect = target.getBoundingClientRect();
            setBox({ x: rect.x - 5, y: rect.y - 5, width: rect.width + 10, height: rect.height + 10 });
            const width = card.current?.offsetWidth ?? 352;
            const height = card.current?.offsetHeight ?? 240;
            const gap = 16;
            const clamp = (value: number, max: number) => Math.max(gap, Math.min(value, max - gap));
            let x = rect.left;
            let y = rect.bottom + gap;
            if (rect.right + gap + width <= innerWidth - gap) {
                x = rect.right + gap;
                y = rect.top + (rect.height - height) / 2;
            } else if (y + height > innerHeight - gap && rect.top - gap - height >= gap) {
                y = rect.top - gap - height;
            }
            setPosition({ x: clamp(x, innerWidth - width), y: clamp(y, innerHeight - height) });
        };
        const update = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
        };
        measure();
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
            frame = requestAnimationFrame(() => {
                target?.scrollIntoView({ behavior: "instant", block: "center" });
                measure();
            });
        }
        window.addEventListener("scroll", update, true);
        window.addEventListener("resize", update);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("scroll", update, true);
            window.removeEventListener("resize", update);
        };
    }, [step.selector, currentStep]);

    const positioned = position !== null;
    useEffect(() => {
        if (positioned) card.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    }, [positioned, currentStep]);

    return (
        <>
            {box &&
                createPortal(
                    <svg className="tour-mask" aria-hidden="true">
                        <defs>
                            <mask id="home-tour-cutout">
                                <rect width="100%" height="100%" fill="white" />
                                <rect {...box} rx="6" fill="black" />
                            </mask>
                        </defs>
                        <rect width="100%" height="100%" fill="#000" fillOpacity="0.65" mask="url(#home-tour-cutout)" />
                        <rect {...box} rx="6" fill="none" stroke="#777" strokeWidth="1" />
                    </svg>,
                    document.body,
                )}
            <div
                className="tour-card"
                style={{ left: position?.x ?? 16, top: position?.y ?? 16, visibility: position ? "visible" : "hidden" }}
                ref={card}
                role="dialog"
                aria-modal="true"
                aria-labelledby="tour-title"
                aria-describedby="tour-description"
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        finish();
                    }
                    if (event.key === "Tab") {
                        const buttons = card.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
                        if (!buttons?.length) return;
                        const first = buttons[0],
                            last = buttons[buttons.length - 1];
                        if (
                            event.shiftKey &&
                            (document.activeElement === first || document.activeElement?.tagName === "H2")
                        ) {
                            event.preventDefault();
                            last.focus();
                        } else if (!event.shiftKey && document.activeElement === last) {
                            event.preventDefault();
                            first.focus();
                        }
                    }
                }}
            >
                <header>
                    <span className="tour-classifier">Getting started</span>
                    <span className="mono">
                        {String(currentStep + 1).padStart(2, "0")} / {String(totalSteps).padStart(2, "0")}
                    </span>
                </header>
                <div className="tour-copy" key={currentStep}>
                    <h2 id="tour-title" tabIndex={-1}>
                        {step.title}
                    </h2>
                    <p id="tour-description">{step.content}</p>
                </div>
                <footer>
                    <button className="text-button" onClick={finish}>
                        Skip
                    </button>
                    <div>
                        {currentStep > 0 && (
                            <button className="button small" onClick={prevStep}>
                                Back
                            </button>
                        )}
                        <button
                            className="button primary small"
                            onClick={currentStep + 1 === totalSteps ? finish : nextStep}
                        >
                            {currentStep + 1 === totalSteps ? "Done" : "Next"}
                            <Glyph name="chevron_right" size={16} />
                        </button>
                    </div>
                </footer>
            </div>
        </>
    );
}

function TourContent({ children }: { children: ReactNode }) {
    const mobile = useSyncExternalStore(subscribe, isMobile, serverMobile);
    const { startOnborda, isOnbordaVisible } = useOnborda();
    const { account, busy, ownName } = useWorkspace();
    const started = useRef(false);
    const [gateStep, setGateStep] = useState(false);

    // Held in state so a list that loses a step under an open card cannot leave it nothing to draw
    const settled = Boolean(account) && !busy;
    const start = useCallback(() => {
        started.current = true;
        setGateStep(settled && !ownName);
        startOnborda("home");
    }, [settled, ownName, startOnborda]);

    // The first step is the gate banner, which reaches the page only once the vault lookup has answered
    useEffect(() => {
        if (started.current || !settled) return;
        const timer = setTimeout(() => {
            if (started.current) return;
            try {
                if (localStorage.getItem(STORAGE_KEY)) return;
            } catch {}
            start();
        }, 800);
        return () => clearTimeout(timer);
    }, [settled, start]);
    useEffect(() => {
        if (!isOnbordaVisible) return;
        const previous = document.activeElement as HTMLElement | null;
        const app = document.querySelector<HTMLElement>(".dashboard-app");
        if (app) app.inert = true;
        document.body.dataset.homeTour = "active";
        return () => {
            if (app) app.inert = false;
            delete document.body.dataset.homeTour;
            previous?.focus({ preventScroll: true });
        };
    }, [isOnbordaVisible]);
    const homeSteps = [
        {
            icon: null,
            title: "Set up your vault",
            content: "Secrets live under an ENS name you own. Set one up here, or say which name is already yours.",
            selector: "#tour-gate",
        },
        {
            icon: null,
            title: "Choose your vault",
            content: mobile
                ? "Open the menu and choose the vault above your wallet. Enter the ENS name you want to open."
                : "Choose the ENS name for your vault here. Read only means you can browse its list, but cannot change it.",
            selector: mobile ? ".account-rail > section:nth-child(2)" : "#tour-vault",
        },
        {
            icon: null,
            title: "Store your first secret",
            content:
                "From your own vault, choose View all, then Store a secret. You can save a private note, API key, or sign-in details.",
            selector: "#tour-secrets",
        },
        {
            icon: null,
            title: "Copy a sign-in code",
            content:
                "Your 2FA codes appear here. Unlock an account, then click its code to copy it. The timer shows when it changes.",
            selector: "#tour-otp",
        },
        {
            icon: null,
            title: "Check your transfers",
            content:
                "Sent receipts and receipts shared with your ENS name are listed separately. Use View all when you want the full list.",
            selector: "#tour-transfers",
        },
    ];
    const steps = [
        {
            tour: "home",
            steps: (gateStep ? homeSteps : homeSteps.slice(1)).map((step) => ({
                ...step,
                pointerPadding: 10,
                pointerRadius: 6,
            })),
        },
    ];
    return (
        <Onborda steps={steps} cardComponent={TourCard} cardTransition={{ duration: 0 }} shadowOpacity="0">
            {children}
            <button
                type="button"
                className="tour-restart"
                aria-label="Restart the tour"
                title="Restart the tour"
                onClick={start}
            >
                <Glyph name="magic_wand" size={24} />
            </button>
        </Onborda>
    );
}

export function HomeOnboarding({ children }: { children: ReactNode }) {
    return (
        <OnbordaProvider>
            <TourContent>{children}</TourContent>
        </OnbordaProvider>
    );
}
