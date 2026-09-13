import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSecretRecords, clearSecretRecords, RECORD, ROTATE_KEYS } from "./records.ts";

const WRAPS = [
    { fingerprint: "0123456789abcdef", wrapped: "AAA" },
    { fingerprint: "fedcba9876543210", wrapped: "BBB" },
];

const built = () =>
    buildSecretRecords({
        type: "totp",
        blob: "blob",
        wraps: WRAPS,
        createdAt: 1,
        site: "github.com",
        owner: "alice.eth",
        grantees: ["bob.eth"],
        recovery: ["vault.eth"],
    });

// The one that matters, since a key left behind is a record still readable by name
test("everything a secret writes is cleared, wraps included", () => {
    const written = built().map((record) => record.key);
    const cleared = new Set(clearSecretRecords(WRAPS.map((wrap) => wrap.fingerprint)).map((record) => record.key));

    const missed = written.filter((key) => !cleared.has(key));
    assert.deepEqual(missed, [], `these stay behind after a forget ${missed.join(", ")}`);
});

test("the signed authorization goes too, so a later create starts clean", () => {
    const cleared = new Set(clearSecretRecords([]).map((record) => record.key));
    for (const key of [RECORD.authCounter, RECORD.authSig, RECORD.authKeys]) {
        assert.ok(cleared.has(key), `${key} survives a forget`);
    }
});

// Whatever a rotation carries is part of the secret, so it has to be part of what removing it clears
test("every key a rotation carries is cleared as well", () => {
    const cleared = new Set(clearSecretRecords([]).map((record) => record.key));
    const missed = ROTATE_KEYS.filter((key) => !cleared.has(key));
    assert.deepEqual(missed, [], `a rotation carries these and a forget leaves them ${missed.join(", ")}`);
});

test("every value written is empty, because a record is cleared by writing nothing to it", () => {
    for (const record of clearSecretRecords(WRAPS.map((wrap) => wrap.fingerprint))) {
        assert.equal(record.value, "", `${record.key} was not cleared`);
    }
});

test("a secret nobody else holds still clears its own wrap", () => {
    const keys = clearSecretRecords(["0123456789abcdef"]).map((record) => record.key);
    assert.ok(keys.includes(RECORD.wrap("0123456789abcdef")));
});
