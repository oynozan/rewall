/*
 * Brings up an emulated Ledger running the real Key Ring app, from nothing
 * Clones app-ledger-sync, builds it in Ledger's own image, then starts Speculos on it
 * Every step is skipped if its output already exists, so re-running costs a few seconds
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const APP = "https://github.com/LedgerHQ/app-ledger-sync.git";
const BUILDER = "ghcr.io/ledgerhq/ledger-app-builder/ledger-app-dev-tools:latest";
const SPECULOS = "ghcr.io/ledgerhq/speculos:latest";
const CONTAINER = "speculos";

// nanos2 is what the Nano S+ SDK emits, and nanosp is what Speculos calls the same device
const BUILD_DIR = "build/nanos2/bin";
const MODEL = "nanosp";

const work = resolve("work");
const app = resolve(work, "app-ledger-sync");
// Docker on Windows wants forward slashes even though node hands back backslashes
const mount = (path) => path.replace(/\\/g, "/");

const run = (command, args, options = {}) => execFileSync(command, args, { stdio: "inherit", ...options });

const quiet = (command) => {
    try {
        return execSync(command, { stdio: ["ignore", "pipe", "ignore"] })
            .toString()
            .trim();
    } catch {
        return "";
    }
};

function main() {
    if (!quiet("docker info")) {
        throw new Error("docker is not running, start Docker Desktop and try again");
    }

    mkdirSync(work, { recursive: true });

    if (!existsSync(app)) {
        console.log("cloning app-ledger-sync");
        run("git", ["clone", "--depth", "1", APP, app]);
    } else {
        console.log("app-ledger-sync already cloned");
    }

    if (!existsSync(resolve(app, BUILD_DIR, "app.elf"))) {
        console.log("building the Key Ring app, this takes a couple of minutes the first time");
        run("docker", [
            "run",
            "--rm",
            "-v",
            `${mount(app)}:/app`,
            BUILDER,
            "bash",
            "-c",
            "BOLOS_SDK=$NANOSP_SDK make -j4",
        ]);
    } else {
        console.log("app.elf already built");
    }

    // Replaced rather than reused, because a container left mid approval refuses the next run
    if (quiet(`docker ps -aq --filter name=^${CONTAINER}$`)) {
        run("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
    }

    console.log("starting speculos");
    run("docker", [
        "run",
        "-d",
        "--name",
        CONTAINER,
        "-p",
        "5000:5000",
        "-p",
        "9999:9999",
        "-v",
        `${mount(resolve(app, BUILD_DIR))}:/apps`,
        SPECULOS,
        "--display",
        "headless",
        "--api-port",
        "5000",
        "--apdu-port",
        "9999",
        "-m",
        MODEL,
        "/apps/app.elf",
    ]);

    console.log("\nwaiting for the app to come up");
}

main();

// The container is up before the app is, so the screen is what says it is ready
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
    const screen = await fetch("http://127.0.0.1:5000/events?currentscreenonly=true")
        .then((response) => response.json())
        .then((json) => (json.events ?? []).map((event) => event.text).join(" "))
        .catch(() => "");

    if (/ready/i.test(screen)) {
        console.log(`device up, screen reads "${screen}"`);
        console.log("\nnow run: pnpm run enroll");
        process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
}

console.error("speculos did not report ready, check: docker logs speculos");
process.exit(1);
