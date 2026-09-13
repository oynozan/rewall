import { test } from "node:test";
import assert from "node:assert/strict";
import { completeOtpKey, describeOtpUri } from "./2fa.ts";

const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("a URI is handed back untouched, because it already says everything", () => {
    const uri = `otpauth://totp/GitHub:you?secret=${SECRET}&issuer=GitHub`;
    assert.equal(completeOtpKey(uri, "github.com"), uri);
    assert.equal(completeOtpKey(`  ${uri}  `, "github.com"), uri);
});

test("a bare key becomes a URI the parser accepts", () => {
    const completed = completeOtpKey(SECRET, "github.com");
    const account = describeOtpUri(completed);
    assert.equal(account.issuer, "github");
    assert.equal(account.digits, 6);
    assert.equal(account.period, 30);
});

// Sites print the key in groups, and people paste exactly what they see
test("spaces, dashes and lower case in a pasted key are accepted", () => {
    const spaced = "gezd gnbv gy3t qojq gezd gnbv gy3t qojq";
    assert.equal(completeOtpKey(spaced, "github.com"), completeOtpKey(SECRET, "github.com"));
    assert.equal(completeOtpKey(SECRET.replace(/(.{4})/g, "$1-"), "github.com"), completeOtpKey(SECRET, "github.com"));
});

test("the issuer comes from the site, minus the label that only matters for matching", () => {
    assert.match(completeOtpKey(SECRET, "github.com"), /issuer=github(&|$)/);
    assert.match(completeOtpKey(SECRET, "accounts.google.com"), /issuer=accounts\.google(&|$)/);
    assert.match(completeOtpKey(SECRET, "localhost"), /issuer=localhost(&|$)/);
});

// Without a site there is still a key worth storing, so it gets a name rather than an empty issuer
test("a bare key with no site still completes", () => {
    assert.equal(describeOtpUri(completeOtpKey(SECRET, "")).issuer, "authenticator");
});

test("anything that is not base32 is left alone for the parser to refuse", () => {
    for (const value of ["not a key", "1234", "GEZDGNBV", "hello world this is not base32 at all"]) {
        assert.equal(completeOtpKey(value, "github.com"), value.trim());
    }
});

// Base32 has no vowel it lacks, so prose made only of its letters would otherwise pass as a key
test("a run of base32 letters that is not a key length is left alone", () => {
    for (const length of [8, 20, 30, 40, 64]) {
        const prose = "A".repeat(length);
        assert.equal(completeOtpKey(prose, "github.com"), prose);
    }
    for (const length of [16, 26, 32, 52]) {
        assert.match(completeOtpKey("A".repeat(length), "github.com"), /^otpauth:\/\/totp\//);
    }
});
