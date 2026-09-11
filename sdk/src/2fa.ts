import { TOTP, URI } from "otpauth";

export type { TOTP } from "otpauth";
export { normalizeSite } from "./site.ts";

const ALGORITHMS = ["SHA1", "SHA256", "SHA512"];

/* Parsing */

function usable(parsed: ReturnType<typeof URI.parse>): parsed is TOTP {
    return (
        parsed instanceof TOTP &&
        [6, 8].includes(parsed.digits) &&
        Number.isInteger(parsed.period) &&
        parsed.period >= 1 &&
        parsed.period <= 300 &&
        ALGORITHMS.includes(parsed.algorithm) &&
        parsed.secret.bytes.length > 0
    );
}

// Wipes before throwing, because URI.parse has already built a real seed by the time validation runs
function parseUri(text: string): TOTP {
    const parsed = URI.parse(text);
    if (usable(parsed)) return parsed;

    parsed.secret.bytes.fill(0);
    throw new Error("Unsupported authenticator configuration.");
}

// Consumes the plaintext it is handed, so the caller never keeps a second copy of a seed
export function parseOtp(bytes: Uint8Array): TOTP {
    try {
        return parseUri(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
        throw new Error("This secret does not contain a supported TOTP account.");
    } finally {
        bytes.fill(0);
    }
}

export type OtpAccount = { issuer: string; label: string; digits: number; period: number; algorithm: string };

// Returns only what a form displays and wipes the seed it parsed, so validating on every keystroke leaks nothing
export function describeOtpUri(text: string): OtpAccount {
    let parsed: TOTP | undefined;
    try {
        parsed = parseUri(text);
        return {
            issuer: parsed.issuer,
            label: parsed.label,
            digits: parsed.digits,
            period: parsed.period,
            algorithm: parsed.algorithm,
        };
    } catch {
        throw new Error("This is not a supported authenticator setup key.");
    } finally {
        parsed?.secret.bytes.fill(0);
    }
}

/* Codes */

export function otpSnapshot(otp: TOTP, timestamp: number) {
    return {
        code: otp.generate({ timestamp }),
        remaining: otp.period - (Math.floor(timestamp / 1000) % otp.period),
    };
}
