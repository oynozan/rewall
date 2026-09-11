/*
 * Host allowlist for http_with_secret, the control that decides where a secret may travel
 * rewall.allow is written by the secret's owner, and the local policy is the operator's own consent
 * Enforcement is the intersection, because rewall.allow sits outside the owner's signature and a
 * write delegate can widen it without any reader being able to tell
 */

export class HostRefused extends Error {
    constructor(message: string) {
        super(message);
        this.name = "HostRefused";
    }
}

// Lowercased with one trailing dot removed, so api.example.com. cannot slip past an exact match
export function normalizeHost(host: string): string {
    return host.trim().toLowerCase().replace(/\.$/, "");
}

// An allowlist entry goes through the same parser as the request, so punycode compares to punycode
export function normalizeEntry(entry: string): string {
    const trimmed = entry.trim();
    if (!trimmed) return "";
    try {
        return normalizeHost(new URL(`https://${trimmed}`).hostname);
    } catch {
        return normalizeHost(trimmed);
    }
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

// URL already folds the decimal and hex integer forms to dotted quad, so testing hostname catches them
function isAddressLiteral(hostname: string): boolean {
    return hostname.startsWith("[") || IPV4.test(hostname);
}

/*
 * Returns the hostname a request is allowed to reach, and throws otherwise
 * Every branch refuses rather than repairing, because a repaired URL is a URL nobody authorized
 */
export function checkUrl(raw: string, allow: string[]): string {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new HostRefused("that is not a URL Rewall can parse, so it refuses to send anything");
    }

    if (url.protocol !== "https:") {
        throw new HostRefused(`only https is allowed, this asked for ${url.protocol.replace(":", "")}`);
    }

    // https://api.openai.com@evil.com/ has hostname evil.com, so userinfo is refused outright
    if (url.username || url.password) {
        throw new HostRefused("a URL carrying a username or password is refused");
    }

    if (url.port) {
        throw new HostRefused("only the default https port is allowed");
    }

    const hostname = normalizeHost(url.hostname);
    if (isAddressLiteral(hostname)) {
        throw new HostRefused("an IP address is refused, name the host instead");
    }

    // An allowlist nobody set is not permission to go anywhere, and an empty record reads the same
    // as one that was never written, so the only safe reading of both is no
    const entries = allow.map(normalizeEntry).filter(Boolean);
    if (!entries.length) {
        throw new HostRefused(
            "this secret has no rewall.allow hosts, so it cannot be sent anywhere, set them on the secret first",
        );
    }

    if (!entries.includes(hostname)) {
        throw new HostRefused(`${hostname} is not in this secret's allowed hosts, which are ${entries.join(", ")}`);
    }

    return hostname;
}

/* Check */

// node --experimental-strip-types src/allow.ts
if (process.argv[1]?.endsWith("allow.ts")) {
    const { strictEqual, throws, doesNotThrow } = await import("node:assert");
    const list = ["api.openai.com"];
    const refused = (raw: string, allow = list) => throws(() => checkUrl(raw, allow), HostRefused, raw);

    doesNotThrow(() => checkUrl("https://api.openai.com/v1/chat", list));
    strictEqual(checkUrl("https://API.OpenAI.com/v1", list), "api.openai.com");
    strictEqual(checkUrl("https://api.openai.com./v1", list), "api.openai.com");
    strictEqual(checkUrl("https://api.openai.com/v1", [" API.OpenAI.com "]), "api.openai.com");

    refused("http://api.openai.com/v1");
    refused("https://evil.com/v1");
    refused("https://api.openai.com.evil.com/v1");
    refused("https://sub.api.openai.com/v1");
    refused("https://api.openai.com@evil.com/v1");
    refused("https://api.openai.com:8443/v1");
    refused("file:///etc/passwd");
    refused("not a url");
    refused("https://169.254.169.254/latest/meta-data");
    refused("https://2130706433/");
    refused("https://api.openai.com/v1", []);
    refused("https://api.openai.com/v1", [""]);
    refused("https://api.openai.com/v1", [" , "]);

    // A confusable renders as its own punycode label, so it simply fails to equal the real one
    refused("https://аpi.openai.com/v1");

    console.log("allow.ts ok");
}
