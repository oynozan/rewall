// Every failure the dashboard shows has to read as a sentence, never as the call viem printed

import assert from "node:assert/strict";
import { explain } from "../src/lib/errors.ts";

const checks = [];
const pass = (message) => checks.push(message);

/* A viem read failure names the endpoint, not the vault, and never pastes its hex into the page */

const rpc = new Error(
    [
        "An unknown RPC error occurred.",
        "Raw Call Arguments:",
        `  data: 0x${"9061b923".padEnd(600, "0")}`,
        "Version: viem@2.56.3",
    ].join("\n"),
);
const read = explain(rpc);
assert.equal(read, "The Sepolia endpoint did not answer. Try again in a moment.");
assert.ok(!read.includes("0x"), "no encoded call reaches the page");
pass("a failed read reports the endpoint instead of dumping the call");

/* Anything without a sentence of its own still says what it was, in one short line */

const odd = new Error(
    ["Something unmapped happened.", "Raw Call Arguments:", `  data: 0x${"0".repeat(600)}`].join("\n"),
);
const shown = explain(odd);
assert.ok(shown.startsWith("Something went wrong. Try again. "), "the fallback keeps its opening sentence");
assert.ok(shown.includes("Something unmapped happened."), "the first line of the cause survives");
assert.ok(!shown.includes("0x"), "the later lines are dropped");
assert.ok(shown.length < 160, `a shown failure stays readable, got ${shown.length} characters`);
pass("an unmapped failure keeps its first line and drops the rest");

const long = explain(new Error("x".repeat(400)));
assert.ok(long.length < 160, `a single long line is cut, got ${long.length} characters`);
assert.ok(long.endsWith("..."), "a cut line says it was cut");
pass("a single long line is cut rather than pasted whole");

assert.equal(explain(new Error("")), "Something went wrong. Try again.");
assert.equal(explain("not an error"), "Something went wrong. Try again.");
pass("an empty or unknown failure still says something");

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
