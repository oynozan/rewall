"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "./ui";
import styles from "./install-extension.module.css";

type Target = "Chrome" | "Firefox";

const subscribe = () => () => {};
const onServer = (): Target => "Chrome";

// Edge and Brave answer to the Chrome steps, and every one of them puts Chrome in the user agent
const detect = (): Target => (/Firefox\//.test(navigator.userAgent) ? "Firefox" : "Chrome");

const STEPS: Record<Target, string[]> = {
    Chrome: [
        "Unzip the file you just downloaded.",
        "Open chrome://extensions in a new tab.",
        "Turn on Developer mode, top right.",
        "Click Load unpacked and pick the folder you unzipped.",
    ],
    Firefox: [
        "Open about:debugging#/runtime/this-firefox in a new tab.",
        "Click Load Temporary Add-on.",
        "Pick the zip file you just downloaded, no unzipping needed.",
    ],
};

export function InstallExtension() {
    const target = useSyncExternalStore(subscribe, detect, onServer);
    const file = target === "Chrome" ? "rewall-2fa-chrome.zip" : "rewall-2fa-firefox.zip";

    return (
        <div className={styles.install}>
            <p className="field-help">
                Fills sign-in codes from the accounts in this vault. It gets a key that decrypts them and never your
                wallet, so it cannot sign anything.
            </p>

            <a className="button primary full-width" href={`/extension/${file}`} download>
                <Icon name={target === "Chrome" ? "chrome" : "firefox"} size={20} />
                Download for {target}
            </a>

            <ol className={styles.steps}>
                {STEPS[target].map((step) => (
                    <li key={step}>{step}</li>
                ))}
            </ol>

            <p className={styles.caveat}>
                {target === "Chrome"
                    ? "Chrome installs extensions from its Web Store only, so until Rewall is listed there this is the way in. Chrome will remind you about developer mode each time it starts."
                    : "Firefox installs add-ons Mozilla has signed only, so until Rewall is signed this one lasts until you close Firefox."}
            </p>
        </div>
    );
}
