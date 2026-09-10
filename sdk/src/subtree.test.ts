import { test } from "node:test";
import assert from "node:assert/strict";
import sodium from "libsodium-wrappers";
import { privateKeyToAccount } from "viem/accounts";
import { deriveIdentity, IDENTITY_MESSAGE, type Identity } from "./identity.ts";
import { deriveSubtreeKey, sealSubtreeKey, openSubtreeKey } from "./subtree.ts";
import { planSecret, openSecret, NoWrapError, type Grantee } from "./secret.ts";

const PLAINTEXT = new TextEncoder().encode("shared-across-the-subtree");

const identityFor = async (n: number): Promise<Identity> => {
    const account = privateKeyToAccount(`0x${n.toString(16).padStart(64, "0")}`);
    return deriveIdentity(await account.signMessage({ message: IDENTITY_MESSAGE }));
};

const parent = await identityFor(1);
const otherParent = await identityFor(2);
const member = await identityFor(3);
const secondMember = await identityFor(4);
const outsider = await identityFor(5);
const recovery = await identityFor(6);

const asGrantee = (i: Identity): Grantee => ({ fingerprint: i.fingerprint, publicKey: i.publicKey });
const toMap = (records: { key: string; value: string }[]) => Object.fromEntries(records.map((r) => [r.key, r.value]));

/* Derivation */

test("the subtree key is deterministic for a parent and version", async () => {
    const a = await deriveSubtreeKey(parent, 0);
    const b = await deriveSubtreeKey(parent, 0);
    assert.deepEqual(a.secretKey, b.secretKey);
    assert.equal(a.fingerprint, b.fingerprint);
});

test("bumping the version gives a different subtree key, which is how rotation works", async () => {
    const v0 = await deriveSubtreeKey(parent, 0);
    const v1 = await deriveSubtreeKey(parent, 1);
    assert.notDeepEqual(v0.secretKey, v1.secretKey);
    assert.notEqual(v0.fingerprint, v1.fingerprint);
});

test("a different parent derives a different subtree key at the same version", async () => {
    const mine = await deriveSubtreeKey(parent, 0);
    const theirs = await deriveSubtreeKey(otherParent, 0);
    assert.notEqual(mine.fingerprint, theirs.fingerprint);
});

test("the subtree public key is scalarmult_base of its secret, same rule as an identity", async () => {
    await sodium.ready;
    const subtree = await deriveSubtreeKey(parent, 0);
    assert.deepEqual(subtree.publicKey, sodium.crypto_scalarmult_base(subtree.secretKey));
});

test("a negative or fractional version is refused", async () => {
    await assert.rejects(() => deriveSubtreeKey(parent, -1), /non-negative integer/);
    await assert.rejects(() => deriveSubtreeKey(parent, 1.5), /non-negative integer/);
});

/* Distribution */

test("a member recovers the exact subtree key the parent sealed", async () => {
    const subtree = await deriveSubtreeKey(parent, 0);
    const sealed = await sealSubtreeKey(subtree, member.publicKey);
    const opened = await openSubtreeKey(sealed, member);

    assert.deepEqual(opened.secretKey, subtree.secretKey);
    assert.deepEqual(opened.publicKey, subtree.publicKey);
    assert.equal(opened.fingerprint, subtree.fingerprint);
});

test("a non-member cannot open a subtree key sealed to someone else", async () => {
    const subtree = await deriveSubtreeKey(parent, 0);
    const sealed = await sealSubtreeKey(subtree, member.publicKey);
    await assert.rejects(() => openSubtreeKey(sealed, outsider));
});

test("the sealed subtree key is base64 on the standard alphabet", async () => {
    const subtree = await deriveSubtreeKey(parent, 0);
    const sealed = await sealSubtreeKey(subtree, member.publicKey);
    assert.match(sealed, /^[A-Za-z0-9+/]+=*$/);
});

/* Reading a secret through the subtree */

test("a member opens a secret granted to the subtree, without its own wrap", async () => {
    const subtree = await deriveSubtreeKey(parent, 0);

    const records = toMap(
        await planSecret({
            type: "apikey",
            plaintext: PLAINTEXT,
            owner: asGrantee(parent),
            recovery: [asGrantee(recovery)],
            grantees: [asGrantee(subtree)],
            createdAt: 1_760_000_000,
        }),
    );

    // The member is not a grantee in its own right, only through the subtree key it was given
    await assert.rejects(() => openSecret(records, member), NoWrapError);

    const held = await openSubtreeKey(await sealSubtreeKey(subtree, member.publicKey), member);
    assert.deepEqual(await openSecret(records, [member, held]), PLAINTEXT);
});

test("every member of a subtree opens the same secret", async () => {
    const subtree = await deriveSubtreeKey(parent, 0);
    const records = toMap(
        await planSecret({
            type: "apikey",
            plaintext: PLAINTEXT,
            owner: asGrantee(parent),
            recovery: [asGrantee(recovery)],
            grantees: [asGrantee(subtree)],
            createdAt: 1_760_000_000,
        }),
    );

    for (const m of [member, secondMember]) {
        const held = await openSubtreeKey(await sealSubtreeKey(subtree, m.publicKey), m);
        assert.deepEqual(await openSecret(records, [m, held]), PLAINTEXT);
    }
});

test("an outsider with no subtree key is refused", async () => {
    const subtree = await deriveSubtreeKey(parent, 0);
    const records = toMap(
        await planSecret({
            type: "apikey",
            plaintext: PLAINTEXT,
            owner: asGrantee(parent),
            recovery: [asGrantee(recovery)],
            grantees: [asGrantee(subtree)],
            createdAt: 1_760_000_000,
        }),
    );
    await assert.rejects(() => openSecret(records, outsider), NoWrapError);
});

test("a removed member's old subtree key does not open a secret granted to the new one", async () => {
    const oldSubtree = await deriveSubtreeKey(parent, 0);
    const newSubtree = await deriveSubtreeKey(parent, 1);

    const heldByRemoved = await openSubtreeKey(await sealSubtreeKey(oldSubtree, member.publicKey), member);

    // The parent rotated to version 1 and re-granted, which is SPEC section 4 step 6
    const records = toMap(
        await planSecret({
            type: "apikey",
            plaintext: PLAINTEXT,
            owner: asGrantee(parent),
            recovery: [asGrantee(recovery)],
            grantees: [asGrantee(newSubtree)],
            createdAt: 1_760_000_000,
        }),
    );

    await assert.rejects(() => openSecret(records, [member, heldByRemoved]), NoWrapError);

    const heldByKept = await openSubtreeKey(await sealSubtreeKey(newSubtree, secondMember.publicKey), secondMember);
    assert.deepEqual(await openSecret(records, [secondMember, heldByKept]), PLAINTEXT);
});

test("NoWrapError lists every fingerprint that was tried", async () => {
    const subtree = await deriveSubtreeKey(parent, 0);
    const records = toMap(
        await planSecret({
            type: "apikey",
            plaintext: PLAINTEXT,
            owner: asGrantee(parent),
            recovery: [asGrantee(recovery)],
            createdAt: 1_760_000_000,
        }),
    );

    await assert.rejects(
        () => openSecret(records, [outsider, subtree]),
        (e: NoWrapError) => {
            assert.deepEqual(e.fingerprints, [outsider.fingerprint, subtree.fingerprint]);
            return true;
        },
    );
});
