import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { deriveIdentity, IDENTITY_MESSAGE, type Identity } from "./identity.ts";
import { createGuardianSet, reshare, recoverWithShares } from "./guardians.ts";
import { planSecret, openSecret, NoWrapError, type Grantee } from "./secret.ts";

const PLAINTEXT = new TextEncoder().encode("sk-proj-guarded-value");

const identityFor = async (n: number): Promise<Identity> => {
    const account = privateKeyToAccount(`0x${n.toString(16).padStart(64, "0")}`);
    return deriveIdentity(await account.signMessage({ message: IDENTITY_MESSAGE }));
};

const owner = await identityFor(1);
const newOwner = await identityFor(2);
const outsider = await identityFor(3);
const guardianIdentities = await Promise.all([4, 5, 6, 7, 8].map(identityFor));

const asGrantee = (i: Identity, name: string): Grantee => ({
    name,
    fingerprint: i.fingerprint,
    publicKey: i.publicKey,
});
const guardians = guardianIdentities.map((g, i) => asGrantee(g, `g${i}.alice.eth`));
const toMap = (records: { key: string; value: string }[]) => Object.fromEntries(records.map((r) => [r.key, r.value]));

/* Setup */

test("a guardian set produces one sealed share per guardian", async () => {
    const set = await createGuardianSet(guardians, 3);
    assert.equal(set.shares.length, guardians.length);
    assert.equal(set.threshold, 3);
    assert.equal(set.recoveryPublicKey.length, 32);
    assert.match(set.recoveryFingerprint, /^[0-9a-f]{16}$/);
});

test("each share is sealed to its own guardian and no other", async () => {
    const set = await createGuardianSet(guardians, 3);

    for (const [i, share] of set.shares.entries()) {
        assert.equal(share.guardianFingerprint, guardianIdentities[i]!.fingerprint);
        await assert.rejects(() => reshare(share.sealed, outsider, newOwner.publicKey));
    }
});

test("a threshold below two is refused, one guardian must never recover alone", async () => {
    await assert.rejects(() => createGuardianSet(guardians, 1), /threshold below 2/);
});

test("a threshold above the guardian count is refused", async () => {
    await assert.rejects(() => createGuardianSet(guardians, 6), /cannot exceed/);
});

test("fewer than two guardians is refused", async () => {
    await assert.rejects(() => createGuardianSet(guardians.slice(0, 1), 2), /at least 2 guardians/);
});

test("a duplicated guardian is refused", async () => {
    await assert.rejects(() => createGuardianSet([guardians[0]!, guardians[0]!], 2), /appears twice/);
});

test("two runs produce different recovery keys", async () => {
    const a = await createGuardianSet(guardians, 3);
    const b = await createGuardianSet(guardians, 3);
    assert.notEqual(a.recoveryFingerprint, b.recoveryFingerprint);
});

/* Recovery */

const resharedBy = async (set: Awaited<ReturnType<typeof createGuardianSet>>, indexes: number[]) =>
    Promise.all(indexes.map((i) => reshare(set.shares[i]!.sealed, guardianIdentities[i]!, newOwner.publicKey)));

test("the threshold reconstructs exactly the original recovery key", async () => {
    const set = await createGuardianSet(guardians, 3);
    const recovered = await recoverWithShares(await resharedBy(set, [0, 2, 4]), newOwner);

    assert.deepEqual(recovered.publicKey, set.recoveryPublicKey);
    assert.equal(recovered.fingerprint, set.recoveryFingerprint);
});

test("any combination reaching the threshold works", async () => {
    const set = await createGuardianSet(guardians, 3);
    for (const combo of [
        [0, 1, 2],
        [1, 3, 4],
        [0, 2, 3],
    ]) {
        const recovered = await recoverWithShares(await resharedBy(set, combo), newOwner);
        assert.equal(recovered.fingerprint, set.recoveryFingerprint);
    }
});

test("more than the threshold still works", async () => {
    const set = await createGuardianSet(guardians, 3);
    const recovered = await recoverWithShares(await resharedBy(set, [0, 1, 2, 3, 4]), newOwner);
    assert.equal(recovered.fingerprint, set.recoveryFingerprint);
});

test("below the threshold reconstructs a key that does not work", async () => {
    const set = await createGuardianSet(guardians, 3);

    // Shamir reconstruction is unauthenticated, so too few shares yield a wrong key rather than an error
    const recovered = await recoverWithShares(await resharedBy(set, [0, 1]), newOwner);
    assert.notEqual(recovered.fingerprint, set.recoveryFingerprint);
});

test("a single re-shared piece is refused outright", async () => {
    const set = await createGuardianSet(guardians, 3);
    const pieces = await resharedBy(set, [0]);
    await assert.rejects(() => recoverWithShares(pieces, newOwner), /at least 2/);
});

test("someone other than the new owner cannot use the re-shared pieces", async () => {
    const set = await createGuardianSet(guardians, 3);
    const pieces = await resharedBy(set, [0, 1, 2]);
    await assert.rejects(() => recoverWithShares(pieces, outsider));
});

/* End to end against a real secret */

test("guardians recover a secret after the owner loses their key", async () => {
    const set = await createGuardianSet(guardians, 3);

    const records = toMap(
        await planSecret({
            type: "apikey",
            plaintext: PLAINTEXT,
            owner: asGrantee(owner, "alice.eth"),
            recovery: [
                {
                    name: "guardians",
                    fingerprint: set.recoveryFingerprint,
                    publicKey: set.recoveryPublicKey,
                },
            ],
            createdAt: 1_760_000_000,
        }),
    );

    // The new wallet has no wrap of its own, which is exactly the situation recovery exists for
    await assert.rejects(() => openSecret(records, newOwner), NoWrapError);

    const recoveryKey = await recoverWithShares(await resharedBy(set, [1, 2, 3]), newOwner);
    assert.deepEqual(await openSecret(records, recoveryKey), PLAINTEXT);
});

test("two guardians short of the threshold cannot open the secret", async () => {
    const set = await createGuardianSet(guardians, 4);

    const records = toMap(
        await planSecret({
            type: "apikey",
            plaintext: PLAINTEXT,
            owner: asGrantee(owner, "alice.eth"),
            recovery: [{ name: "guardians", fingerprint: set.recoveryFingerprint, publicKey: set.recoveryPublicKey }],
            createdAt: 1_760_000_000,
        }),
    );

    const wrong = await recoverWithShares(await resharedBy(set, [0, 1]), newOwner);
    await assert.rejects(() => openSecret(records, wrong), NoWrapError);
});
