import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { identityFromAccount, type Identity } from "./identity.ts";
import { KeyCommitmentError } from "./crypto.ts";
import { RECORD, SCHEMA_VERSION } from "./records.ts";
import {
    planSecret,
    planGrant,
    planRotate,
    openSecret,
    recoverDek,
    wrapFingerprints,
    NoWrapError,
    MissingBlobError,
    type Grantee,
} from "./secret.ts";

const PLAINTEXT = new TextEncoder().encode("sk-proj-not-a-real-key-0123456789");
const CREATED = 1_760_000_000;
const SECRET = "openai.rewall.alice.eth";

const identityFor = (n: number): Promise<Identity> =>
    identityFromAccount(privateKeyToAccount(`0x${n.toString(16).padStart(64, "0")}`));

const owner = await identityFor(1);
const grantee = await identityFor(2);
const recovery = await identityFor(3);
const stranger = await identityFor(4);
const late = await identityFor(5);

const asGrantee = (i: Identity): Grantee => ({ fingerprint: i.fingerprint, publicKey: i.publicKey });
const toMap = (records: { key: string; value: string }[]) => Object.fromEntries(records.map((r) => [r.key, r.value]));
const open = (records: Record<string, string>, holder: Identity | Identity[]) => openSecret(records, holder, SECRET);

const baseInput = {
    secretName: SECRET,
    type: "apikey",
    plaintext: PLAINTEXT,
    owner: asGrantee(owner),
    recovery: [asGrantee(recovery)],
    createdAt: CREATED,
};

/* Create */

test("a created secret opens for the owner", async () => {
    const records = toMap(await planSecret(baseInput));
    assert.deepEqual(await open(records, owner), PLAINTEXT);
});

test("a created secret opens for the recovery holder", async () => {
    const records = toMap(await planSecret(baseInput));
    assert.deepEqual(await open(records, recovery), PLAINTEXT);
});

test("creation is refused without a recovery grantee", async () => {
    await assert.rejects(() => planSecret({ ...baseInput, recovery: [] }), /at least one recovery grantee/);
});

test("a stranger gets NoWrapError, not a decryption failure", async () => {
    const records = toMap(await planSecret(baseInput));
    await assert.rejects(() => open(records, stranger), NoWrapError);
});

test("NoWrapError names the fingerprint and the secret", async () => {
    const records = toMap(await planSecret(baseInput));
    await assert.rejects(
        () => open(records, stranger),
        (e: NoWrapError) => {
            assert.equal(e.name, "NoWrapError");
            assert.deepEqual(e.fingerprints, [stranger.fingerprint]);
            assert.match(e.message, /openai\.rewall\.alice\.eth/);
            return true;
        },
    );
});

test("a missing blob is distinguishable from a missing wrap", async () => {
    const records = toMap(await planSecret(baseInput));
    delete records[RECORD.blob];
    await assert.rejects(() => open(records, owner), MissingBlobError);
});

test("the record set carries version, type, encryption and created", async () => {
    const records = toMap(await planSecret(baseInput));
    assert.equal(records[RECORD.version], SCHEMA_VERSION);
    assert.equal(records[RECORD.type], "apikey");
    assert.equal(records[RECORD.encryption], "aes-256-gcm");
    assert.equal(records[RECORD.created], String(CREATED));
});

test("allow is written even when empty, so dropping every host actually drops them on chain", async () => {
    const without = toMap(await planSecret(baseInput));
    assert.equal(without[RECORD.allow], "");

    const withHosts = toMap(await planSecret({ ...baseInput, allow: ["api.openai.com", "api.example.com"] }));
    assert.equal(withHosts[RECORD.allow], "api.example.com,api.openai.com");
});

test("an owner who is also the recovery holder still yields one wrap", async () => {
    const records = await planSecret({ ...baseInput, recovery: [asGrantee(owner)] });
    assert.equal(wrapFingerprints(toMap(records)).length, 1);
});

test("a secret lifted onto another name refuses to open, even for a real holder", async () => {
    const records = toMap(await planSecret(baseInput));

    // A write delegate can copy every record across, so the blob itself has to refuse the new name
    await assert.rejects(() => openSecret(records, owner, "stripe.rewall.alice.eth"), KeyCommitmentError);
});

test("the blob length does not follow the plaintext length", async () => {
    const short = toMap(await planSecret({ ...baseInput, plaintext: new TextEncoder().encode("a") }));
    const long = toMap(await planSecret({ ...baseInput, plaintext: new TextEncoder().encode("x".repeat(200)) }));

    assert.equal(short[RECORD.blob]!.length, long[RECORD.blob]!.length);
});

test("two encryptions of the same plaintext differ", async () => {
    const a = toMap(await planSecret(baseInput));
    const b = toMap(await planSecret(baseInput));
    assert.notEqual(a[RECORD.blob], b[RECORD.blob]);
});

/* Grant */

test("a grant lets a new holder open the same secret", async () => {
    const records = toMap(await planSecret(baseInput));
    assert.rejects(() => open(records, late));

    const added = toMap(await planGrant(records, owner, asGrantee(late)));
    assert.deepEqual(await open({ ...records, ...added }, late), PLAINTEXT);
});

test("granting does not change the ciphertext, only adds a wrap", async () => {
    const records = toMap(await planSecret(baseInput));
    const added = await planGrant(records, owner, asGrantee(late));

    assert.equal(added.length, 1);
    assert.equal(added[0]!.key, RECORD.wrap(late.fingerprint));
});

test("a party who cannot read cannot grant", async () => {
    const records = toMap(await planSecret(baseInput));
    await assert.rejects(() => planGrant(records, stranger, asGrantee(late)), NoWrapError);
});

/* Rotate and revoke */

test("rotation re-encrypts, so the old ciphertext is replaced", async () => {
    const first = toMap(await planSecret({ ...baseInput, grantees: [asGrantee(grantee)] }));
    const { records } = await planRotate({
        ...baseInput,
        grantees: [asGrantee(grantee)],
        previousFingerprints: wrapFingerprints(first),
    });

    assert.notEqual(toMap(records)[RECORD.blob], first[RECORD.blob]);
});

test("everyone kept can still open a rotated secret", async () => {
    const first = toMap(await planSecret({ ...baseInput, grantees: [asGrantee(grantee)] }));
    const { records } = await planRotate({
        ...baseInput,
        grantees: [asGrantee(grantee)],
        previousFingerprints: wrapFingerprints(first),
    });

    const rotated = toMap(records);
    for (const holder of [owner, recovery, grantee]) {
        assert.deepEqual(await open(rotated, holder), PLAINTEXT);
    }
});

test("revoking clears the wrap and locks that holder out", async () => {
    const first = toMap(await planSecret({ ...baseInput, grantees: [asGrantee(grantee)] }));
    assert.deepEqual(await open(first, grantee), PLAINTEXT);

    const { records, cleared } = await planRotate({
        ...baseInput,
        previousFingerprints: wrapFingerprints(first),
    });

    assert.deepEqual(cleared, [grantee.fingerprint]);

    const after = { ...first, ...toMap(records) };
    assert.equal(after[RECORD.wrap(grantee.fingerprint)], "");
    await assert.rejects(() => open(after, grantee), NoWrapError);
    assert.deepEqual(await open(after, owner), PLAINTEXT);
});

test("a revoked holder cannot open the new blob even with the old wrap kept", async () => {
    const first = toMap(await planSecret({ ...baseInput, grantees: [asGrantee(grantee)] }));
    const { records } = await planRotate({ ...baseInput, previousFingerprints: wrapFingerprints(first) });

    // Simulates a revoked party who cached their old wrap record and replays it against the new ciphertext
    const replayed = {
        ...toMap(records),
        [RECORD.wrap(grantee.fingerprint)]: first[RECORD.wrap(grantee.fingerprint)]!,
    };
    await assert.rejects(() => open(replayed, grantee));
});

test("rotation can change the plaintext", async () => {
    const first = toMap(await planSecret(baseInput));
    const next = new TextEncoder().encode("sk-proj-rotated-value");

    const { records } = await planRotate({
        ...baseInput,
        plaintext: next,
        previousFingerprints: wrapFingerprints(first),
    });
    assert.deepEqual(await open(toMap(records), owner), next);
});

test("rotation still refuses to drop the recovery grantee", async () => {
    await assert.rejects(
        () => planRotate({ ...baseInput, recovery: [], previousFingerprints: [] }),
        /at least one recovery grantee/,
    );
});

test("nothing is cleared when no fingerprint disappears", async () => {
    const first = toMap(await planSecret(baseInput));
    const { cleared } = await planRotate({ ...baseInput, previousFingerprints: wrapFingerprints(first) });
    assert.deepEqual(cleared, []);
});

test("a rotation carries the site through when it is read back", async () => {
    const first = toMap(await planSecret({ ...baseInput, type: "totp", site: "github.com" }));
    assert.equal(first[RECORD.site], "github.com");

    const { records } = await planRotate({
        ...baseInput,
        type: "totp",
        site: first[RECORD.site],
        previousFingerprints: wrapFingerprints(first),
    });
    assert.equal(toMap(records)[RECORD.site], "github.com");
});

test("a rotation that is given no site clears the old one rather than leaving it", async () => {
    const { records } = await planRotate({ ...baseInput, previousFingerprints: [] });
    assert.equal(toMap(records)[RECORD.site], "");
});

/* Helpers */

test("wrapFingerprints ignores cleared wraps and unrelated keys", () => {
    const records = {
        [RECORD.blob]: "irrelevant",
        [RECORD.wrap("aaaaaaaaaaaaaaaa")]: "present",
        [RECORD.wrap("bbbbbbbbbbbbbbbb")]: "",
        [RECORD.version]: "1",
    };
    assert.deepEqual(wrapFingerprints(records), ["aaaaaaaaaaaaaaaa"]);
});

/* Grantee lists, which are what makes a rotation possible at all */

test("the names of everyone granted are recorded, split by kind", async () => {
    const subtree: Grantee = {
        name: "team.eth",
        fingerprint: "cccccccccccccccc",
        publicKey: late.publicKey,
        subtree: true,
    };
    const records = toMap(
        await planSecret({
            ...baseInput,
            owner: { ...asGrantee(owner), name: "alice.eth" },
            recovery: [{ ...asGrantee(recovery), name: "vault.alice.eth" }],
            grantees: [{ ...asGrantee(grantee), name: "bob.eth" }, subtree],
        }),
    );

    assert.equal(records[RECORD.grantees], "bob.eth");
    assert.equal(records[RECORD.subtrees], "team.eth");
    assert.equal(records[RECORD.recovery], "vault.alice.eth");
});

test("the lists are written even when empty, so a rotation can clear them", async () => {
    const records = toMap(await planSecret(baseInput));
    assert.equal(records[RECORD.grantees], "");
    assert.equal(records[RECORD.subtrees], "");
});

test("names are deduplicated and sorted so the record is stable", async () => {
    const records = toMap(
        await planSecret({
            ...baseInput,
            grantees: [
                { ...asGrantee(grantee), name: "zed.eth" },
                { ...asGrantee(late), name: "alice.eth" },
                { ...asGrantee(grantee), name: "zed.eth" },
            ],
        }),
    );
    assert.equal(records[RECORD.grantees], "alice.eth,zed.eth");
});

test("a grantee with no name still gets a wrap but adds nothing to the list", async () => {
    const records = toMap(await planSecret({ ...baseInput, grantees: [asGrantee(late)] }));
    assert.ok(records[RECORD.wrap(late.fingerprint)]);
    assert.equal(records[RECORD.grantees], "");
});

test("recoverDek returns a 32 byte key for a holder", async () => {
    const records = toMap(await planSecret(baseInput));
    const dek = await recoverDek(records, owner);
    assert.equal(dek.length, 32);
});
