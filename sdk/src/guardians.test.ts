import { test } from "node:test";
import assert from "node:assert/strict";
import sodium from "libsodium-wrappers";
import { privateKeyToAccount } from "viem/accounts";
import { deriveIdentity, IDENTITY_MESSAGE, type Identity } from "./identity.ts";
import {
    createGuardianSet,
    reshare,
    recoverWithShares,
    ForgedShareError,
    RecoveryFailedError,
    type GuardianSet,
} from "./guardians.ts";
import { seal, toBase64 } from "./crypto.ts";
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

const expectOf = (set: GuardianSet) => ({ publicKey: set.recoveryPublicKey, threshold: set.threshold });
const resharedBy = async (set: GuardianSet, indexes: number[]) =>
    Promise.all(indexes.map((i) => reshare(set.shares[i]!.sealed, guardianIdentities[i]!, newOwner.publicKey)));

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

test("a guardian whose published key is the wrong length is refused before any key is generated", async () => {
    const malformed: Grantee = { name: "bad.eth", fingerprint: "0".repeat(16), publicKey: new Uint8Array(31) };
    await assert.rejects(() => createGuardianSet([...guardians.slice(0, 3), malformed], 3), /31 byte key/);
});

test("two runs produce different recovery keys", async () => {
    const a = await createGuardianSet(guardians, 3);
    const b = await createGuardianSet(guardians, 3);
    assert.notEqual(a.recoveryFingerprint, b.recoveryFingerprint);
});

/* Recovery */

test("the threshold reconstructs exactly the original recovery key", async () => {
    const set = await createGuardianSet(guardians, 3);
    const recovered = await recoverWithShares(await resharedBy(set, [0, 2, 4]), newOwner, expectOf(set));

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
        const recovered = await recoverWithShares(await resharedBy(set, combo), newOwner, expectOf(set));
        assert.equal(recovered.fingerprint, set.recoveryFingerprint);
    }
});

test("more than the threshold still works, the honest subset is found", async () => {
    const set = await createGuardianSet(guardians, 3);
    const recovered = await recoverWithShares(await resharedBy(set, [0, 1, 2, 3, 4]), newOwner, expectOf(set));
    assert.equal(recovered.fingerprint, set.recoveryFingerprint);
});

test("below the threshold is refused outright, not silently wrong", async () => {
    const set = await createGuardianSet(guardians, 3);
    const pieces = await resharedBy(set, [0, 1]);
    await assert.rejects(() => recoverWithShares(pieces, newOwner, expectOf(set)), /needs 3 pieces/);
});

test("someone other than the new owner cannot use the re-shared pieces", async () => {
    const set = await createGuardianSet(guardians, 3);
    const pieces = await resharedBy(set, [0, 1, 2]);
    await assert.rejects(() => recoverWithShares(pieces, outsider, expectOf(set)));
});

/* Forged shares, the attack the audited library does not defend against */

test("a share with x coordinate zero is refused", async () => {
    const set = await createGuardianSet(guardians, 3);

    // x zero makes every honest share vanish from the interpolation, handing the result to the forger
    const forged = new Uint8Array(33).fill(0x41);
    forged[32] = 0;
    const sealedForgery = toBase64(await seal(forged, newOwner.publicKey));

    const pieces = [...(await resharedBy(set, [0, 1, 2])), sealedForgery];
    await assert.rejects(() => recoverWithShares(pieces, newOwner, expectOf(set)), ForgedShareError);
});

test("a forged share cannot dictate the reconstructed key", async () => {
    const set = await createGuardianSet(guardians, 3);

    const chosen = new Uint8Array(32).fill(0x41);
    const forged = new Uint8Array(33);
    forged.set(chosen, 0);
    forged[32] = 0;
    const attackerKey = sodium.crypto_scalarmult_base(chosen);

    const pieces = [...(await resharedBy(set, [0, 1, 2])), toBase64(await seal(forged, newOwner.publicKey))];
    await assert.rejects(async () => {
        const got = await recoverWithShares(pieces, newOwner, expectOf(set));
        assert.notDeepEqual(got.publicKey, attackerKey);
        throw new Error("should not have reached here");
    }, ForgedShareError);
});

test("a corrupted share among honest ones is isolated and recovery still succeeds", async () => {
    const set = await createGuardianSet(guardians, 3);

    // A valid looking share with a real x coordinate but wrong y bytes, which subset search must route around
    const corrupt = new Uint8Array(33).fill(0x7f);
    corrupt[32] = 200;
    const pieces = [...(await resharedBy(set, [0, 1, 2, 3])), toBase64(await seal(corrupt, newOwner.publicKey))];

    const recovered = await recoverWithShares(pieces, newOwner, expectOf(set));
    assert.equal(recovered.fingerprint, set.recoveryFingerprint);
});

test("two pieces sharing an x coordinate are refused", async () => {
    const set = await createGuardianSet(guardians, 3);
    const one = set.shares[0]!.sealed;
    const pieces = [
        await reshare(one, guardianIdentities[0]!, newOwner.publicKey),
        await reshare(one, guardianIdentities[0]!, newOwner.publicKey),
        ...(await resharedBy(set, [1])),
    ];
    await assert.rejects(() => recoverWithShares(pieces, newOwner, expectOf(set)), ForgedShareError);
});

test("pieces from the wrong guardian set fail loudly", async () => {
    const set = await createGuardianSet(guardians, 3);
    const other = await createGuardianSet(guardians, 3);

    const pieces = await resharedBy(other, [0, 1, 2]);
    await assert.rejects(() => recoverWithShares(pieces, newOwner, expectOf(set)), RecoveryFailedError);
});

/* End to end against a real secret */

test("guardians recover a secret after the owner loses their key", async () => {
    const set = await createGuardianSet(guardians, 3);

    const records = toMap(
        await planSecret({
            type: "apikey",
            plaintext: PLAINTEXT,
            owner: asGrantee(owner, "alice.eth"),
            recovery: [{ name: "guardians", fingerprint: set.recoveryFingerprint, publicKey: set.recoveryPublicKey }],
            createdAt: 1_760_000_000,
        }),
    );

    await assert.rejects(() => openSecret(records, newOwner), NoWrapError);

    const recoveryKey = await recoverWithShares(await resharedBy(set, [1, 2, 3]), newOwner, expectOf(set));
    assert.deepEqual(await openSecret(records, recoveryKey), PLAINTEXT);
});
