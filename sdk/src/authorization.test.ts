import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { authorizationPayload, authorizationSigner, isAuthorizedBy, type Authorization } from "./authorization.ts";

const owner = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const delegate = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000002");

const base: Authorization = {
    secretName: "openai.rewall.alice.eth",
    counter: 1,
    owner: "alice.eth",
    grantees: ["bob.eth"],
    subtrees: [],
    recovery: ["vault.alice.eth"],
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
