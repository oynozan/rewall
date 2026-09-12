/*
 * Redaction of a secret and its common encodings out of anything the model is about to read
 * This is defence in depth and not the control, the allowlist is the control
 * An allowed host that returns the secret transformed in a way we cannot predict defeats this, which
 * is why a redaction is treated as an alarm rather than a repair
 */

const MIN_NEEDLE = 8;

const hex = (bytes: Uint8Array) =>
    Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

// Every shape the same bytes can arrive in, longest first so a longer form is never left half eaten
export function needlesFor(secret: Uint8Array): string[] {
    const raw = new TextDecoder().decode(secret);
    const base64 = Buffer.from(secret).toString("base64");
    const lower = hex(secret);

    const candidates = [
        raw,
        encodeURIComponent(raw),
        JSON.stringify(raw).slice(1, -1),
        // JSON may escape a forward slash as \/, which the stringify above does not produce
        raw.replace(/\//g, "\\/"),
        base64,
        base64.replace(/\//g, "\\/"),
        base64.replace(/=+$/, ""),
        base64.replace(/\+/g, "-").replace(/\//g, "_"),
        base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
        lower,
        lower.toUpperCase(),
        `0x${lower}`,
        `0x${lower.toUpperCase()}`,
    ];

    const seen = new Set<string>();
    for (const candidate of candidates) {
        // A short secret would redact ordinary words out of the response and tell the model nothing
        if (candidate.length >= MIN_NEEDLE) seen.add(candidate);
    }
    return [...seen].sort((a, b) => b.length - a.length);
}

export type Scrubbed = { text: string; redactions: number };

export function scrub(text: string, needles: string[]): Scrubbed {
    let out = text;
    let redactions = 0;
    for (const needle of needles) {
        for (;;) {
            const at = out.indexOf(needle);
            if (at < 0) break;
            out = out.slice(0, at) + "[redacted by rewall]" + out.slice(at + needle.length);
            redactions++;
        }
    }
    return { text: out, redactions };
}

/* Check */

// node --experimental-strip-types src/scrub.ts
if (process.argv[1]?.endsWith("scrub.ts")) {
    const { strictEqual, ok } = await import("node:assert");
    const secret = new TextEncoder().encode("sk-live-6f2a9c4b8e1d");
    const needles = needlesFor(secret);
    const gone = (body: string, what: string) => {
        const result = scrub(body, needles);
        ok(!result.text.includes("6f2a9c4b8e1d"), what);
        ok(result.redactions > 0, `${what} counted`);
    };

    gone("token sk-live-6f2a9c4b8e1d rejected", "raw");
    gone(`?key=${encodeURIComponent("sk-live-6f2a9c4b8e1d")}`, "percent encoded");
    gone(Buffer.from(secret).toString("base64"), "base64");
    gone(Buffer.from(secret).toString("base64").replace(/=+$/, ""), "base64 unpadded");
    gone(Buffer.from(secret).toString("base64url"), "base64url");
    gone(hex(secret), "hex");
    gone(hex(secret).toUpperCase(), "hex upper");
    gone(`0x${hex(secret)}`, "hex prefixed");
    gone(`{"k":"sk-live-6f2a9c4b8e1d"}`, "inside json");

    const clean = scrub("nothing to see", needles);
    strictEqual(clean.redactions, 0);
    strictEqual(clean.text, "nothing to see");

    // Two occurrences are both removed, so a body echoing a credential twice cannot leak the second
    strictEqual(scrub("a sk-live-6f2a9c4b8e1d b sk-live-6f2a9c4b8e1d", needles).redactions, 2);

    // A short value is not used as a needle, or every response would come back shredded
    strictEqual(needlesFor(new TextEncoder().encode("abc")).includes("abc"), false);

    // A value with a forward slash, escaped as \/ the way JSON is allowed to, is still caught
    const slashy = new TextEncoder().encode("path/to/secret/value");
    const slashNeedles = needlesFor(slashy);
    ok(
        !scrub("here is path\\/to\\/secret\\/value inline", slashNeedles).text.includes("path\\/to"),
        "json slash escape",
    );

    console.log("scrub.ts ok");
}
