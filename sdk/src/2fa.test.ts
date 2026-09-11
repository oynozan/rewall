import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOtp, describeOtpUri, otpSnapshot } from "./2fa.ts";

// RFC 6238 Appendix B, the ASCII seed 12345678901234567890 in base32 with the 8 digit SHA1 vector
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const URI = `otpauth://totp/RFC%206238:Test?secret=${SECRET}&issuer=RFC%206238&digits=8&period=30`;

const bytes = (text: string) => new TextEncoder().encode(text);
const allZero = (buffer: Uint8Array) => buffer.every((byte) => byte === 0);

/* Parsing */

test("parseOtp reads the standard otpauth URI", () => {
    const otp = parseOtp(bytes(URI));
    assert.equal(otp.digits, 8);
    assert.equal(otp.period, 30);
    assert.equal(otp.algorithm, "SHA1");
    assert.equal(otp.issuer, "RFC 6238");
    otp.secret.bytes.fill(0);
});

test("parseOtp wipes the plaintext it was handed, on success and on failure", () => {
    const good = bytes(URI);
    parseOtp(good).secret.bytes.fill(0);
    assert.ok(allZero(good), "a parsed seed was left in the caller's buffer");

    const bad = bytes("not a uri");
    assert.throws(() => parseOtp(bad));
    assert.ok(allZero(bad), "a rejected seed was left in the caller's buffer");
});

test("parseOtp refuses anything that is not a usable TOTP account", () => {
    assert.throws(() => parseOtp(bytes(`otpauth://hotp/Example?secret=${SECRET}&counter=1`)));
    assert.throws(() => parseOtp(bytes(`otpauth://totp/Example?secret=${SECRET}&period=0`)));
    assert.throws(() => parseOtp(bytes(`otpauth://totp/Example?secret=${SECRET}&digits=7`)));
    assert.throws(() => parseOtp(bytes(`otpauth://totp/Example?secret=${SECRET}&algorithm=MD5`)));
    assert.throws(() => parseOtp(new Uint8Array([0xff, 0xfe, 0xfd])));
});

/* Describing */

test("describeOtpUri returns display fields and no key material", () => {
    const account = describeOtpUri(URI);
    assert.deepEqual(account, { issuer: "RFC 6238", label: "Test", digits: 8, period: 30, algorithm: "SHA1" });
    assert.ok(!("secret" in account));
});

test("describeOtpUri refuses the same inputs parseOtp refuses", () => {
    assert.throws(() => describeOtpUri("not a uri"));
    assert.throws(() => describeOtpUri(`otpauth://hotp/Example?secret=${SECRET}&counter=1`));
});

/* Codes */

test("otpSnapshot reproduces the RFC 6238 vector", () => {
    const otp = parseOtp(bytes(URI));
    assert.equal(otpSnapshot(otp, 59_000).code, "94287082");
    assert.equal(otpSnapshot(otp, 1_111_111_109_000).code, "07081804");
    otp.secret.bytes.fill(0);
});

test("otpSnapshot counts down to the end of the current step", () => {
    const otp = parseOtp(bytes(URI));
    assert.equal(otpSnapshot(otp, 59_000).remaining, 1);
    assert.equal(otpSnapshot(otp, 30_000).remaining, 30);
    assert.equal(otpSnapshot(otp, 45_000).remaining, 15);
    otp.secret.bytes.fill(0);
});
