import { TOTP, URI } from "otpauth";

export function parseOtp(bytes: Uint8Array): TOTP {
    let parsed: ReturnType<typeof URI.parse> | undefined;
    try {
        parsed = URI.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (
            !(parsed instanceof TOTP) ||
            ![6, 8].includes(parsed.digits) ||
            !Number.isInteger(parsed.period) ||
            parsed.period < 1 ||
            parsed.period > 300 ||
            !["SHA1", "SHA256", "SHA512"].includes(parsed.algorithm) ||
            !parsed.secret.bytes.length
        ) {
            throw new Error("Unsupported authenticator configuration.");
        }
        return parsed;
    } catch {
        parsed?.secret.bytes.fill(0);
        throw new Error("This secret does not contain a supported TOTP account.");
    } finally {
        bytes.fill(0);
    }
}

export function otpSnapshot(otp: TOTP, timestamp: number) {
    return {
        code: otp.generate({ timestamp }),
        remaining: otp.period - (Math.floor(timestamp / 1000) % otp.period),
    };
}
