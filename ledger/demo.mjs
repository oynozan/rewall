/*
 * A page that runs the whole key ring story with buttons, for showing to people
 * The device is embedded from Speculos, so the approval happens on screen and a person presses it
 * Nothing here is new behaviour, it drives the same enroll and agent scripts the checks do
 */

import { createServer } from "node:http";
import { spawn, execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.PORT || 8080);
const SPECULOS = "http://127.0.0.1:5000";

const listeners = new Set();
const say = (line, kind = "log") => {
    for (const send of listeners) send({ line, kind });
};

const quiet = (command) => {
    try {
        return execSync(command, { stdio: ["ignore", "pipe", "ignore"] })
            .toString()
            .trim();
    } catch {
        return "";
    }
};

const deviceUp = () => Boolean(quiet("docker ps -q --filter name=^speculos$"));

/* Running the scripts behind the buttons */

let busy = false;

function runScript(script, env = {}) {
    if (busy) return say("something is already running", "warn");
    busy = true;

    const child = spawn("node", ["--env-file=../tools/.env", "--experimental-strip-types", `src/${script}`], {
        env: { ...process.env, ...env },
    });

    const forward = (chunk) => {
        for (const line of chunk.toString().split("\n")) {
            // The type stripping notice is noise nobody watching this needs to read
            if (line.trim() && !/ExperimentalWarning|trace-warnings/.test(line)) say(line);
        }
    };

    child.stdout.on("data", forward);
    child.stderr.on("data", forward);
    child.on("close", (code) => {
        busy = false;
        say(code === 0 ? `${script} finished` : `${script} exited with ${code}`, code === 0 ? "done" : "warn");
    });
}

/* Server */

const page = () => readFileSync(new URL("./demo.html", import.meta.url), "utf8");

createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return response.end(page());
    }

    if (url.pathname === "/api/status") {
        response.writeHead(200, { "content-type": "application/json" });
        return response.end(JSON.stringify({ device: deviceUp(), busy }));
    }

    // Server sent events, so the page shows each line as the script prints it
    if (url.pathname === "/api/log") {
        response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
        });
        const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
        listeners.add(send);
        request.on("close", () => listeners.delete(send));
        return send({ line: "ready", kind: "done" });
    }

    if (request.method === "POST") {
        if (url.pathname === "/api/device/start") {
            say("starting the emulated Ledger, first run builds the app and takes a couple of minutes");
            const child = spawn("node", ["speculos.mjs"], { env: process.env });
            child.stdout.on("data", (c) => say(c.toString().trim()));
            child.stderr.on("data", (c) => say(c.toString().trim()));
            child.on("close", () => say("device ready", "done"));
        } else if (url.pathname === "/api/device/stop") {
            quiet("docker rm -f speculos");
            say("the device is gone, nothing is plugged in anywhere", "done");
        } else if (url.pathname === "/api/enroll") {
            say("the agent minted a key and is asking to join, approve it on the device");
            runScript("enroll.ts", { LEDGER_MANUAL: "1" });
        } else if (url.pathname === "/api/agent") {
            runScript("agent.ts");
        } else {
            response.writeHead(404);
            return response.end();
        }
        response.writeHead(202);
        return response.end();
    }

    response.writeHead(404);
    response.end();
}).listen(PORT, () => {
    console.log(`\n  Rewall x Ledger demo\n  open http://localhost:${PORT}\n`);
    console.log(`  the device itself is at ${SPECULOS}\n`);
});
