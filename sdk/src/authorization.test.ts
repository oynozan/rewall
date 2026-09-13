import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import {
    assertApproved,
    assertCanonical,
    authorizationPayload,
    authorizationSigner,
    isAuthorizedBy,
    isLegacyAuthorizedBy,
    KeyChangedError,
    legacyAuthorizationPayload,
    unacceptedChanges,
    UnauthorizedListError,
    type Authorization,
} from "./authorization.ts";
import { joinApprovals, joinNames, RECORD, splitApprovals, splitNames, type Approval } from "./records.ts";

const owner = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const delegate = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000002");

const fp = (seed: string) => seed.repeat(16).slice(0, 16);

const approvals: Approval[] = [
    { role: "owner", name: "alice.eth", fingerprint: fp("a") },
    { role: "grantee", name: "bob.eth", fingerprint: fp("b") },
    { role: "recovery", name: "vault.alice.eth", fingerprint: fp("c") },
];

const base: Authorization = {
    secretName: "openai.rewall.alice.eth",
    counter: 1,
    owner: "alice.eth",
    grantees: ["bob.eth"],
    subtrees: [],
    recovery: ["vault.alice.eth"],
    approvals,
};

const sign = (account: typeof owner, auth: Authorization) =>
    account.signMessage({ message: authorizationPayload(auth) });

test("the payload is canonical regardless of list order", () => {
    const a = authorizationPayload({ ...base, grantees: ["b.eth", "a.eth"] });
    const b = authorizationPayload({ ...base, grantees: ["a.eth", "b.eth"] });
    assert.equal(a, b);
});

test("the owner's own signature verifies", async () => {
    assert.ok(await isAuthorizedBy(base, await sign(owner, base), owner.address));
});

test("a delegate's signature over the same list does not verify as the owner", async () => {
    assert.ok(!(await isAuthorizedBy(base, await sign(delegate, base), owner.address)));
});

test("adding a grantee after signing invalidates the signature", async () => {
    const signature = await sign(owner, base);

    // The attack is a write delegate appending themselves to rewall.grantees then waiting for a rotation
    const tampered = { ...base, grantees: [...base.grantees, "mallory.eth"] };
    assert.ok(!(await isAuthorizedBy(tampered, signature, owner.address)));
});

test("changing any covered field invalidates the signature", async () => {
    const signature = await sign(owner, base);

    for (const tampered of [
        { ...base, subtrees: ["mallory.eth"] },
        { ...base, recovery: ["mallory.eth"] },
        { ...base, owner: "mallory.eth" },
        { ...base, secretName: "stripe.rewall.alice.eth" },
        { ...base, counter: 2 },
    ]) {
        assert.ok(!(await isAuthorizedBy(tampered, signature, owner.address)), JSON.stringify(tampered));
    }
});

test("a malformed or empty signature is rejected rather than throwing", async () => {
    for (const bad of ["", "0x", "not-a-signature", `0x${"11".repeat(64)}`]) {
        assert.equal(await authorizationSigner(base, bad), null);
        assert.ok(!(await isAuthorizedBy(base, bad, owner.address)));
    }
});

test("a signature lifted from another secret does not authorize this one", async () => {
    const other = { ...base, secretName: "stripe.rewall.alice.eth" };
    assert.ok(!(await isAuthorizedBy(base, await sign(owner, other), owner.address)));
});

test("the approved keys are covered by the signature", async () => {
    const signature = await sign(owner, base);

    // The attack is whoever controls bob.eth republishing rewall.pubkey so the next rotation seals to them
    const swapped = approvals.map((a) => (a.role === "grantee" ? { ...a, fingerprint: fp("f") } : a));
    assert.ok(!(await isAuthorizedBy({ ...base, approvals: swapped }, signature, owner.address)));

    const dropped = approvals.filter((a) => a.role !== "grantee");
    assert.ok(!(await isAuthorizedBy({ ...base, approvals: dropped }, signature, owner.address)));
});

test("the approvals line is canonical regardless of order", () => {
    const a = authorizationPayload({ ...base, approvals: [...approvals].reverse() });
    assert.equal(a, authorizationPayload(base));
});

test("a rotation resolving the approved keys passes", () => {
    assert.doesNotThrow(() => assertApproved(base.secretName, approvals, approvals));
});

test("a rotation resolving a swapped key is refused", () => {
    const resolved = approvals.map((a) => (a.name === "bob.eth" ? { ...a, fingerprint: fp("f") } : a));

    assert.throws(() => assertApproved(base.secretName, approvals, resolved), {
        name: "KeyChangedError",
        subject: "bob.eth",
        approved: fp("b"),
        resolved: fp("f"),
    });
});

test("a party absent from the approvals is refused rather than waved through", () => {
    const resolved: Approval[] = [...approvals, { role: "grantee", name: "mallory.eth", fingerprint: fp("d") }];

    assert.throws(
        () => assertApproved(base.secretName, approvals, resolved),
        (error: KeyChangedError) => {
            assert.equal(error.name, "KeyChangedError");
            assert.equal(error.subject, "mallory.eth");
            assert.equal(error.approved, null);
            return true;
        },
    );
});

test("one name holding a direct grant and a subtree grant is checked per role", () => {
    const owned: Approval = { role: "owner", name: "alice.eth", fingerprint: fp("a") };
    const both: Approval[] = [
        owned,
        { role: "grantee", name: "team.eth", fingerprint: fp("1") },
        { role: "subtree", name: "team.eth", fingerprint: fp("2") },
    ];

    assert.doesNotThrow(() => assertApproved(base.secretName, both, both));

    // The subtree key standing in for the direct key would hand a whole subtree what one name was granted
    const crossed: Approval[] = [
        owned,
        { role: "grantee", name: "team.eth", fingerprint: fp("2") },
        { role: "subtree", name: "team.eth", fingerprint: fp("1") },
    ];
    assert.throws(() => assertApproved(base.secretName, both, crossed), { name: "KeyChangedError" });
});

test("an empty approval set refuses everything instead of allowing everything", () => {
    assert.throws(() => assertApproved(base.secretName, [], approvals), { name: "KeyChangedError" });
});

/* The whole check a rotation performs, over the record values a read returns */

const recordsFor = async (account: typeof owner, auth: Authorization) => ({
    [RECORD.owner]: auth.owner,
    [RECORD.grantees]: joinNames(auth.grantees),
    [RECORD.subtrees]: joinNames(auth.subtrees),
    [RECORD.recovery]: joinNames(auth.recovery),
    [RECORD.authCounter]: String(auth.counter),
    [RECORD.authKeys]: joinApprovals(auth.approvals),
    [RECORD.authSig]: await sign(account, auth),
});

const verify = async (records: Record<string, string>, resolved: Approval[]) => {
    const auth: Authorization = {
        secretName: base.secretName,
        counter: Number(records[RECORD.authCounter] || 0),
        owner: records[RECORD.owner] || "",
        grantees: splitNames(records[RECORD.grantees]),
        subtrees: splitNames(records[RECORD.subtrees]),
        recovery: splitNames(records[RECORD.recovery]),
        approvals: splitApprovals(records[RECORD.authKeys]),
    };

    if (!(await isAuthorizedBy(auth, records[RECORD.authSig]!, owner.address))) {
        throw new UnauthorizedListError(base.secretName, null, owner.address);
    }
    assertApproved(base.secretName, auth.approvals, resolved);
};

test("an untouched record set verifies and lets the rotation through", async () => {
    const records = await recordsFor(owner, base);
    await assert.doesNotReject(() => verify(records, approvals));
});

test("a grantee whose name republished a different pubkey stops the rotation", async () => {
    const records = await recordsFor(owner, base);

    // Whoever controls bob.eth swaps rewall.pubkey, so the next rotation would seal the fresh key to them
    const hijacked = approvals.map((a) => (a.name === "bob.eth" ? { ...a, fingerprint: fp("9") } : a));
    await assert.rejects(() => verify(records, hijacked), { name: "KeyChangedError", subject: "bob.eth" });
});

test("a delegate appending a name to the grantees record is caught by the signature", async () => {
    const records = await recordsFor(owner, base);
    records[RECORD.grantees] = joinNames([...base.grantees, "mallory.eth"]);

    await assert.rejects(() => verify(records, approvals), UnauthorizedListError);
});

test("a delegate repointing the approved keys record is caught by the signature", async () => {
    const records = await recordsFor(owner, base);
    const repointed = approvals.map((a) => (a.name === "bob.eth" ? { ...a, fingerprint: fp("9") } : a));
    records[RECORD.authKeys] = joinApprovals(repointed);

    await assert.rejects(() => verify(records, repointed), UnauthorizedListError);
});

test("an owner swapped for a name the attacker controls is caught by the signature", async () => {
    const records = await recordsFor(owner, base);
    records[RECORD.owner] = "mallory.eth";

    await assert.rejects(() => verify(records, approvals), UnauthorizedListError);
});

test("stripping the approved keys record breaks the signature rather than reopening the hole", async () => {
    const records = await recordsFor(owner, base);
    records[RECORD.authKeys] = "";

    await assert.rejects(() => verify(records, approvals), UnauthorizedListError);
});

test("a list signed before key binding cannot verify, so it is refused rather than trusted", async () => {
    const legacy = [
        "Rewall authorization v1",
        `name=${base.secretName}`,
        `n=${base.counter}`,
        `owner=${base.owner}`,
        `grantees=${joinNames(base.grantees)}`,
        `subtrees=${joinNames(base.subtrees)}`,
        `recovery=${joinNames(base.recovery)}`,
    ].join("\n");

    const records = await recordsFor(owner, base);
    records[RECORD.authSig] = await owner.signMessage({ message: legacy });
    records[RECORD.authKeys] = "";

    await assert.rejects(() => verify(records, approvals), UnauthorizedListError);
});

/* Re-approval, which is the only way a changed key ever becomes an approved one */

const bound: Approval[] = [
    { role: "owner", name: "alice.eth", fingerprint: fp("a") },
    { role: "grantee", name: "bob.eth", fingerprint: fp("b") },
];

const drifted: Approval[] = [
    { role: "owner", name: "alice.eth", fingerprint: fp("a") },
    { role: "grantee", name: "bob.eth", fingerprint: fp("9") },
];

test("re-approving an unchanged set asks the owner for nothing", () => {
    assert.deepEqual(unacceptedChanges(bound, bound, []), []);
});

test("re-approving a changed key without naming it is refused", () => {
    const changes = unacceptedChanges(bound, drifted, []);

    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.name, "bob.eth");
    assert.equal(changes[0]!.approved, fp("b"));
    assert.equal(changes[0]!.resolved, fp("9"));
});

test("naming the exact new key is what lets a re-approval through", () => {
    const accept: Approval[] = [{ role: "grantee", name: "bob.eth", fingerprint: fp("9") }];
    assert.deepEqual(unacceptedChanges(bound, drifted, accept), []);
});

test("accepting a different key than the one published does not wave the real one through", () => {
    const accept: Approval[] = [{ role: "grantee", name: "bob.eth", fingerprint: fp("7") }];
    assert.equal(unacceptedChanges(bound, drifted, accept).length, 1);
});

test("accepting a name in the wrong role does not wave it through", () => {
    const accept: Approval[] = [{ role: "subtree", name: "bob.eth", fingerprint: fp("9") }];
    assert.equal(unacceptedChanges(bound, drifted, accept).length, 1);
});

test("a name with no previous binding is approved by being named on the list", () => {
    const added: Approval[] = [...bound, { role: "grantee", name: "carol.eth", fingerprint: fp("5") }];
    assert.deepEqual(unacceptedChanges(bound, added, []), []);
});

test("every drifted name is reported at once, not one per attempt", () => {
    const many: Approval[] = [
        { role: "owner", name: "alice.eth", fingerprint: fp("a") },
        { role: "grantee", name: "bob.eth", fingerprint: fp("9") },
        { role: "recovery", name: "vault.alice.eth", fingerprint: fp("8") },
    ];
    const prior: Approval[] = [
        { role: "owner", name: "alice.eth", fingerprint: fp("a") },
        { role: "grantee", name: "bob.eth", fingerprint: fp("b") },
        { role: "recovery", name: "vault.alice.eth", fingerprint: fp("c") },
    ];

    assert.equal(unacceptedChanges(prior, many, []).length, 2);
    assert.throws(
        () => assertApproved(base.secretName, prior, many),
        (error: KeyChangedError) => {
            assert.equal(error.changes.length, 2);
            return true;
        },
    );
});

test("a resolved set with no owner is refused rather than passing an empty loop", () => {
    assert.throws(() => assertApproved(base.secretName, approvals, []), /resolved no owner key/);
    const ownerless = approvals.filter((a) => a.role !== "owner");
    assert.throws(() => assertApproved(base.secretName, approvals, ownerless), /resolved no owner key/);
});

test("a key accepted for one rotation is what lets a bumped subtree version re-grant", () => {
    const prior: Approval[] = [
        { role: "owner", name: "alice.eth", fingerprint: fp("a") },
        { role: "subtree", name: "team.eth", fingerprint: fp("1") },
    ];
    const resolved: Approval[] = [
        { role: "owner", name: "alice.eth", fingerprint: fp("a") },
        { role: "subtree", name: "team.eth", fingerprint: fp("2") },
    ];

    assert.throws(() => assertApproved(base.secretName, prior, resolved), { name: "KeyChangedError" });

    const accept: Approval[] = [{ role: "subtree", name: "team.eth", fingerprint: fp("2") }];
    assert.doesNotThrow(() => assertApproved(base.secretName, [...prior, ...accept], resolved));
});

/* Canonical form, so nothing rides along under a signature that does not cover it */

const canonical = {
    [RECORD.grantees]: joinNames(base.grantees),
    [RECORD.subtrees]: joinNames(base.subtrees),
    [RECORD.recovery]: joinNames(base.recovery),
    [RECORD.authKeys]: joinApprovals(approvals),
};

test("an untouched record set is canonical", () => {
    assert.doesNotThrow(() => assertCanonical(base.secretName, canonical));
});

test("junk appended to the approved keys record is refused, not silently dropped", () => {
    const tampered = { ...canonical, [RECORD.authKeys]: `${canonical[RECORD.authKeys]},junk:not-a-role:ffff` };

    assert.throws(() => assertCanonical(base.secretName, tampered), {
        name: "NonCanonicalRecordError",
        key: RECORD.authKeys,
    });
});

test("whitespace and reordering in a list record are refused", () => {
    for (const value of [` ${canonical[RECORD.authKeys]}`, `${canonical[RECORD.authKeys]},`]) {
        assert.throws(() => assertCanonical(base.secretName, { ...canonical, [RECORD.authKeys]: value }), {
            name: "NonCanonicalRecordError",
        });
    }

    assert.throws(() => assertCanonical(base.secretName, { ...canonical, [RECORD.grantees]: "b.eth,a.eth" }), {
        name: "NonCanonicalRecordError",
        key: RECORD.grantees,
    });
});

test("a duplicated name in a list record is refused", () => {
    const tampered = { ...canonical, [RECORD.grantees]: "bob.eth,bob.eth" };
    assert.throws(() => assertCanonical(base.secretName, tampered), { name: "NonCanonicalRecordError" });
});

/* Telling a genuine migration apart from a stripped record */

test("a list signed under the old payload is recognised as legacy, not as a forgery", async () => {
    const signature = await owner.signMessage({ message: legacyAuthorizationPayload(base) });

    assert.ok(!(await isAuthorizedBy(base, signature, owner.address)));
    assert.ok(await isLegacyAuthorizedBy(base, signature, owner.address));
});

test("a current signature is not mistaken for a legacy one", async () => {
    const signature = await sign(owner, base);
    assert.ok(!(await isLegacyAuthorizedBy(base, signature, owner.address)));
});

test("a delegate stripping the keys record cannot pose as a legacy secret", async () => {
    const signature = await sign(owner, base);
    const stripped = { ...base, approvals: [] };

    // Neither payload verifies, so the owner is told it was tampered with rather than told to re-sign
    assert.ok(!(await isAuthorizedBy(stripped, signature, owner.address)));
    assert.ok(!(await isLegacyAuthorizedBy(stripped, signature, owner.address)));
});
