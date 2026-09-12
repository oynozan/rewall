import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSite } from "./site.ts";

const rejects = (input: string) => assert.throws(() => normalizeSite(input), Error, `${input} should be refused`);

/* Accepted shapes */

test("a bare hostname keeps its subdomains and lowercases", () => {
    assert.equal(normalizeSite("accounts.example.com"), "accounts.example.com");
    assert.equal(normalizeSite("Accounts.Example.COM"), "accounts.example.com");
    assert.equal(normalizeSite("  github.com  "), "github.com");
});

test("a full URL reduces to its hostname", () => {
    assert.equal(normalizeSite("https://github.com/login?next=/a#b"), "github.com");
    assert.equal(normalizeSite("http://example.com"), "example.com");
});

test("www is neither added nor stripped, so the two are different sites", () => {
    assert.equal(normalizeSite("www.github.com"), "www.github.com");
    assert.equal(normalizeSite("github.com"), "github.com");
    assert.notEqual(normalizeSite("www.github.com"), normalizeSite("github.com"));
});

test("one trailing dot is removed", () => {
    assert.equal(normalizeSite("example.com."), "example.com");
});

/* Punycode */

test("an internationalized name stores punycode rather than its display form", () => {
    assert.equal(normalizeSite("bücher.de"), "xn--bcher-kva.de");
    assert.equal(normalizeSite("XN--BCHER-KVA.de"), "xn--bcher-kva.de");
});

// The whole point of the field, a lookalike must not compare equal to the name it imitates
test("a homograph does not collapse onto the name it imitates", () => {
    assert.equal(normalizeSite("раypal.com"), "xn--ypal-43d9g.com");
    assert.notEqual(normalizeSite("раypal.com"), normalizeSite("paypal.com"));
});

/* Refusals, each one a string the parser would otherwise reinterpret */

test("whitespace and backslashes are refused rather than deleted", () => {
    rejects(`https://exa${String.fromCharCode(9)}mple.com`);
    rejects(`https://exam${String.fromCharCode(10)}ple.com`);
    rejects(`github.com${String.fromCharCode(92)}.evil.com`);
});

test("a port is refused even in the forms that normalize away", () => {
    rejects("example.com:8080");
    rejects("https://example.com:8080");
    rejects("https://example.com:443");
    rejects("http://example.com:80");
    rejects("https://github.com:");
});

test("user info is refused rather than resolved to the host after the at sign", () => {
    assert.equal(new URL("https://evil.com@github.com").hostname, "github.com");
    rejects("https://evil.com@github.com");
    rejects("https://user:pass@github.com");
});

test("a scheme other than http is refused", () => {
    rejects("otpauth://totp/Example");
    rejects("ftp://example.com");
});

test("an IP address is refused in every notation the parser accepts", () => {
    assert.equal(new URL("https://0x7f.1").hostname, "127.0.0.1");
    rejects("0x7f.1");
    rejects("1.2.3.4");
    rejects("https://127.0.0.1");
    rejects("[::1]");
    rejects("https://[::1]");
});

test("an empty or single label is refused", () => {
    rejects("");
    rejects("   ");
    rejects(".example.com");
    rejects("a..b.com");
    rejects("example.com..");
    rejects("github");
    rejects("localhost");
});

/* Messages, which a form renders straight into the page */

test("no message echoes the input, so a pasted override cannot rewrite what the form displays", () => {
    const hostile = ["\u202egnv.example.com", "\u0000evil.com", "a".repeat(300) + ".com", "not a hostname"];
    for (const input of hostile) {
        let message = "";
        try {
            normalizeSite(input);
        } catch (failure) {
            message = (failure as Error).message;
        }
        assert.ok(message, `${JSON.stringify(input)} was accepted`);
        assert.ok(!message.includes(input), `the message repeated ${JSON.stringify(input)} back`);
    }
});

test("an IP literal is named as one rather than blamed for its colons", () => {
    assert.throws(() => normalizeSite("[::1]"), /IP address/);
    assert.throws(() => normalizeSite("https://[::1]"), /IP address/);
    assert.throws(() => normalizeSite("1.2.3.4"), /IP address/);
});

/* Length, because a name past these cannot be reached in a browser */

test("an over long name or label is refused", () => {
    rejects(`${"a".repeat(64)}.com`);
    rejects(`${Array.from({ length: 30 }, () => "a".repeat(9)).join(".")}.com`);
    assert.equal(normalizeSite(`${"a".repeat(63)}.com`), `${"a".repeat(63)}.com`);
});

/* Only the authority is policed, since the rest is a path the parser drops */

test("a space in the path is not a reason to refuse the hostname", () => {
    assert.equal(normalizeSite("https://example.com/a b"), "example.com");
    assert.equal(normalizeSite("https://example.com/login?next=a b#c"), "example.com");
});

test("a control character in the authority is refused like any other invisible", () => {
    rejects(`example${String.fromCharCode(0)}.com`);
    rejects(`exam${String.fromCharCode(31)}ple.com`);
});
