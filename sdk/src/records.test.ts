import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, hexToBytes, namehash } from "viem";
import {
    buildSecretRecords,
    encodeSetTextCalls,
    dnsEncode,
    resolverAbi,
    RECORD,
    ROTATE_KEYS,
    WRAP_PREFIX,
    SCHEMA_VERSION,
    ENCRYPTION,
} from "./records.ts";

const FP_A = "aaaaaaaaaaaaaaaa";
const FP_B = "bbbbbbbbbbbbbbbb";

const base = {
    type: "apikey",
    blob: "Y2lwaGVydGV4dA==",
    wraps: [{ fingerprint: FP_A, wrapped: "d3JhcHBlZA==" }],
    createdAt: 1_760_000_000,
};

const asMap = (records: { key: string; value: string }[]) => Object.fromEntries(records.map((r) => [r.key, r.value]));

/* Building */

test("a record set carries every mandatory key", () => {
    const map = asMap(buildSecretRecords(base));
    assert.equal(map[RECORD.version], SCHEMA_VERSION);
    assert.equal(map[RECORD.type], "apikey");
    assert.equal(map[RECORD.encryption], ENCRYPTION);
    assert.equal(map[RECORD.blob], base.blob);
    assert.equal(map[RECORD.created], "1760000000");
    assert.equal(map[RECORD.wrap(FP_A)], "d3JhcHBlZA==");
});

test("version comes first, so a reader can reject an unknown schema before parsing", () => {
    assert.equal(buildSecretRecords(base)[0]!.key, RECORD.version);
});

test("a secret with no wraps is refused", () => {
    assert.throws(() => buildSecretRecords({ ...base, wraps: [] }), /at least one wrap/);
});

test("a duplicate fingerprint is refused", () => {
    const wraps = [
        { fingerprint: FP_A, wrapped: "b25l" },
        { fingerprint: FP_A, wrapped: "dHdv" },
    ];
    assert.throws(() => buildSecretRecords({ ...base, wraps }), /duplicate wrap/);
});

test("an uppercase fingerprint is refused, because text keys compare as raw bytes", () => {
    const wraps = [{ fingerprint: FP_A.toUpperCase(), wrapped: "b25l" }];
    assert.throws(() => buildSecretRecords({ ...base, wraps }), /16 lowercase hex/);
});

test("a fingerprint of the wrong length or charset is refused", () => {
    for (const bad of ["aaaa", "a".repeat(17), "g".repeat(16), "", "aaaaaaaa-aaaaaaa"]) {
        assert.throws(
            () => buildSecretRecords({ ...base, wraps: [{ fingerprint: bad, wrapped: "x" }] }),
            /fingerprint/,
        );
    }
});

test("allow joins hosts with commas and is omitted when empty, so it survives a rotation but cannot be cleared", () => {
    assert.equal(asMap(buildSecretRecords({ ...base, allow: [] }))[RECORD.allow], undefined);
    assert.equal(asMap(buildSecretRecords({ ...base, allow: ["a.com"] }))[RECORD.allow], "a.com");
    assert.equal(asMap(buildSecretRecords({ ...base, allow: ["a.com", "b.com"] }))[RECORD.allow], "a.com,b.com");
});

test("site is always written, including empty, so overwriting a secret clears a stale hostname", () => {
    assert.equal(asMap(buildSecretRecords(base))[RECORD.site], "");
    assert.equal(asMap(buildSecretRecords({ ...base, site: "github.com" }))[RECORD.site], "github.com");
});

// Regenerated from the clock on every write, so a rotation deliberately does not carry it across
const REGENERATED = new Set<string>([RECORD.created]);

test("every record a create writes is read back before a rotation", () => {
    const written = buildSecretRecords({ ...base, site: "github.com", allow: ["a.com"] })
        .map((r) => r.key)
        .filter((key) => !key.startsWith(WRAP_PREFIX) && !REGENERATED.has(key));

    for (const key of written) {
        assert.ok(ROTATE_KEYS.includes(key), `${key} is written on create but never read back for a rotation`);
    }
});

test("every wrap becomes its own record", () => {
    const wraps = [
        { fingerprint: FP_A, wrapped: "b25l" },
        { fingerprint: FP_B, wrapped: "dHdv" },
    ];
    const map = asMap(buildSecretRecords({ ...base, wraps }));
    assert.equal(map[RECORD.wrap(FP_A)], "b25l");
    assert.equal(map[RECORD.wrap(FP_B)], "dHdv");
});

test("wrap keys are prefixed so a reader can spot them without a schema", () => {
    assert.equal(RECORD.wrap(FP_A), `rewall.key.${FP_A}`);
});

/* Encoding */

test("each record becomes one setText call against the right node", () => {
    const node = namehash("openai.rewall.alice.eth");
    const records = buildSecretRecords(base);
    const calls = encodeSetTextCalls(node, records);

    assert.equal(calls.length, records.length);

    const decoded = calls.map((data) => decodeFunctionData({ abi: resolverAbi, data }));
    for (const [i, call] of decoded.entries()) {
        assert.equal(call.functionName, "setText");
        assert.equal(call.args![0], node);
        assert.equal(call.args![1], records[i]!.key);
        assert.equal(call.args![2], records[i]!.value);
    }
});

test("an empty value encodes fine, which is how a wrap is cleared", () => {
    const node = namehash("openai.rewall.alice.eth");
    const [call] = encodeSetTextCalls(node, [{ key: RECORD.wrap(FP_A), value: "" }]);
    const decoded = decodeFunctionData({ abi: resolverAbi, data: call! });
    assert.equal(decoded.args![2], "");
});

/* DNS encoding */

test("dnsEncode writes length prefixed labels ending in a root byte", () => {
    const bytes = hexToBytes(dnsEncode("openai.rewall.alice.eth"));
    const decoder = new TextDecoder();

    let offset = 0;
    const labels: string[] = [];
    while (bytes[offset] !== 0) {
        const length = bytes[offset]!;
        labels.push(decoder.decode(bytes.subarray(offset + 1, offset + 1 + length)));
        offset += length + 1;
    }

    assert.deepEqual(labels, ["openai", "rewall", "alice", "eth"]);
    assert.equal(bytes[offset], 0);
    assert.equal(offset + 1, bytes.length);
});

test("dnsEncode of a two label name is shorter than a three label one", () => {
    assert.ok(hexToBytes(dnsEncode("alice.eth")).length < hexToBytes(dnsEncode("rewall.alice.eth")).length);
});
