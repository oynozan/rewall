// Deleted outright from a host by the URL parser, so a pasted string would quietly become another hostname
const FORBIDDEN = /[\s\\]/;

// Requires the slashes so a bare host with a port falls through to the authority check instead
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

// One pattern covers every notation, because the parser normalizes 0x7f.1 to 127.0.0.1 before this runs
const IPV4 = /^\d+(\.\d+){3}$/;

/* Hostname */

// Accepts what a user pastes, a bare hostname or a full URL, and returns the one form stored in rewall.site
export function normalizeSite(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) throw new Error("Enter the hostname where this code is used.");

    if (FORBIDDEN.test(trimmed)) {
        throw new Error("A hostname cannot contain spaces or backslashes.");
    }

    const scheme = SCHEME.exec(trimmed);
    if (scheme && !/^https?:\/\//i.test(trimmed)) {
        throw new Error("Only http and https addresses can be used here.");
    }

    const withoutScheme = scheme ? trimmed.slice(scheme[0].length) : trimmed;
    const authority = withoutScheme.split(/[/?#]/)[0] ?? "";

    // Checked before parsing, because a default port normalizes away and evil.com@github.com resolves to github.com
    if (authority.includes(":") || authority.includes("@")) {
        throw new Error("Leave out any port or sign-in details, just the hostname.");
    }

    let hostname: string;
    try {
        hostname = new URL(`https://${authority}`).hostname;
    } catch {
        throw new Error(`${trimmed} is not a hostname.`);
    }

    // Punycode and lowercasing come from the parser, so an internationalized name never stores its display form
    const host = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;

    if (host.startsWith("[") || IPV4.test(host)) {
        throw new Error("Enter a hostname rather than an IP address.");
    }

    const labels = host.split(".");
    if (labels.length < 2 || labels.some((label) => !label)) {
        throw new Error(`${trimmed} is not a complete hostname.`);
    }

    return host;
}
