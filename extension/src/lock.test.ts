import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapIdentity, unwrapIdentity } from "./lock.ts";

// Not a real identity, just 32 bytes of the right shape
const KEY = new Uint8Array(32).map((_, index) => index * 7 + 1);

test("a wrapped key comes back exactly", async () => {
    const paired = await wrapIdentity("rewall-test-1.eth", KEY, "correct horse battery staple");
    const opened = await unwrapIdentity(paired, "correct horse battery staple");
    assert.deepEqual(opened, KEY);
    assert.equal(paired.name, "rewall-test-1.eth");
});

// The whole point of the passphrase, so this is the case that must not degrade into a partial read
test("a wrong passphrase throws rather than returning anything", async () => {
    const paired = await wrapIdentity("rewall-test-1.eth", KEY, "correct horse battery staple");
    await assert.rejects(() => unwrapIdentity(paired, "correct horse battery stapl"));
    await assert.rejects(() => unwrapIdentity(paired, ""));
});

test("tampering with the wrapped bytes is refused, not decrypted into something else", async () => {
    const paired = await wrapIdentity("rewall-test-1.eth", KEY, "passphrase");
    const bytes = Uint8Array.from(atob(paired.wrapped), (character) => character.charCodeAt(0));
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tampered = { ...paired, wrapped: btoa(String.fromCharCode(...bytes)) };
    await assert.rejects(() => unwrapIdentity(tampered, "passphrase"));
});

// Reusing a salt across pairings would make two identical keys wrap to identical ciphertext
test("two wraps of the same key share neither salt nor output", async () => {
    const first = await wrapIdentity("a.eth", KEY, "passphrase");
    const second = await wrapIdentity("a.eth", KEY, "passphrase");
    assert.notEqual(first.salt, second.salt);
    assert.notEqual(first.iv, second.iv);
    assert.notEqual(first.wrapped, second.wrapped);
});

test("the stored form is plain base64, so nothing downstream has to guess an alphabet", async () => {
    const paired = await wrapIdentity("a.eth", KEY, "passphrase");
    for (const value of [paired.wrapped, paired.salt, paired.iv]) {
        assert.match(value, /^[A-Za-z0-9+/]+={0,2}$/);
    }
});
