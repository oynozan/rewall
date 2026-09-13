"use client";

import { useSyncExternalStore } from "react";
import { DotGrid } from "./dot-grid";
import { useWorkspace } from "./dashboard-shell";
import { useExtension } from "./use-extension";
import { Glyph, Icon } from "./ui";

type Browser = "Chrome" | "Firefox" | "mobile" | null;
const subscribe = () => () => {};
const serverBrowser = (): Browser => null;
function currentBrowser(): Browser {
    const ua = navigator.userAgent;
    if (/Android|iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))
        return "mobile";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Chrome\/|Chromium\//.test(ua)) return "Chrome";
    return null;
}

export function ExtensionBanner({ compact = false }: { compact?: boolean }) {
    const browser = useSyncExternalStore(subscribe, currentBrowser, serverBrowser);
    const { setPanel } = useWorkspace();
    const { present } = useExtension();

    // Nothing to install once one is here, and PairExtension is what stands in its place
    if (present) return null;
    // Nothing on a phone or tablet can install a desktop extension
    if (browser === "mobile") return null;
    const browsers: Exclude<Browser, "mobile" | null>[] = browser ? [browser] : ["Chrome", "Firefox"];
    return (
        <aside
            className={"extension-banner" + (compact ? " extension-banner-compact" : "")}
            aria-label="2FA browser extension"
        >
            <DotGrid />
            <div className="extension-copy">
                <h2>2FA extension</h2>
                <p>Fill sign-in codes from your browser.</p>
            </div>
            <div className="extension-actions">
                {browsers.map((name) => (
                    <button
                        key={name}
                        type="button"
                        className="button extension-install"
                        aria-label={"Add to " + name}
                        onClick={() => setPanel("extension")}
                    >
                        <Icon name={name === "Chrome" ? "chrome" : "firefox"} size={22} />
                        {browser ? "Add to " + name : name}
                        <Glyph name="chevron_right" size={16} />
                    </button>
                ))}
            </div>
        </aside>
    );
}
