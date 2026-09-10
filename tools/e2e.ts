// Drives the whole Rewall surface against real Sepolia. Every assertion below is a chain round trip.

import { createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { Rewall, NoWrapError } from "@rewall/sdk";
import { NAMESPACE_LABEL, SUBTREE_MEMBERS, SUBTREE_PARENT_ROLE, UNIVERSAL_RESOLVER } from "./participants.ts";
import { publicClient, byRole, accountFor, ensureSecretName } from "./chain.ts";

const LABEL = process.env.REWALL_SECRET_LABEL ?? "stripe";
const SECRET = "sk_live_not_a_real_stripe_key_7c1d";
const ROTATED = "sk_live_rotated_value_a99f";

const rpc = process.env.SEPOLIA_RPC_URL!;
const owner = byRole.owner!;
const grantee = byRole.grantee!;
const recovery = byRole.recovery!;

const clientFor = (index: number, name: string) => {
    const account = accountFor(index);
    return new Rewall({
        publicClient,
        walletClient: createWalletClient({ account, chain: sepolia, transport: http(rpc) }),
        account,
        name,
        universalResolver: UNIVERSAL_RESOLVER,
    });
};

const ownerClient = clientFor(owner.index, `${owner.label}.eth`);
const granteeClient = clientFor(grantee.index, `${grantee.label}.eth`);
const recoveryClient = clientFor(recovery.index, `${recovery.label}.eth`);
const strangerClient = clientFor(byRole.stranger!.index, `${grantee.label}.eth`);
const memberClient = clientFor(SUBTREE_MEMBERS[0]!.index, `${SUBTREE_MEMBERS[0]!.label}.${grantee.label}.eth`);

const secretName = `${LABEL}.${NAMESPACE_LABEL}.${owner.label}.eth`;
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

let passed = 0;
const pass = (message: string) => {
    passed++;
    console.log(`PASS  ${message}`);
};
const fail = (message: string): never => {
    throw new Error(`FAIL  ${message}`);
};

console.log(`secret  ${secretName}\n`);

/* Setup */

if (await ensureSecretName(owner.index, owner.label!, LABEL)) console.log(`registered ${secretName}`);
for (const client of [ownerClient, granteeClient, recoveryClient]) {
    if (await client.publishIdentity()) console.log(`published identity for ${client.name}`);
}

/* Create */

await ownerClient.create(secretName, new TextEncoder().encode(SECRET), {
    type: "apikey",
    grantees: [`${grantee.label}.eth`],
    recovery: [`${recovery.label}.eth`],
    allow: ["api.stripe.com"],
});
console.log("");

if (text(await ownerClient.get(secretName)) !== SECRET) fail("owner cannot read what it created");
pass("owner reads its own secret");

if (text(await granteeClient.get(secretName)) !== SECRET) fail("grantee cannot read");
pass("grantee reads the secret");

if (text(await recoveryClient.get(secretName)) !== SECRET) fail("recovery holder cannot read");
pass("recovery holder reads the secret");

await strangerClient
    .get(secretName)
    .then(() => fail("stranger read the secret"))
    .catch((e) => (e instanceof NoWrapError ? pass("stranger refused with NoWrapError") : fail(String(e))));

/* List */

const listed = await ownerClient.list();
if (!listed.includes(LABEL)) fail(`list did not include ${LABEL}, got ${listed.join(",") || "nothing"}`);
pass(`list returned ${listed.join(", ")}`);

/* Subtree grant */

const parentName = `${byRole[SUBTREE_PARENT_ROLE]!.label}.eth`;
await ownerClient.grant(secretName, parentName, { subtree: true });

if (text(await memberClient.get(secretName)) !== SECRET) fail("subtree member cannot read");
pass(`subtree member ${memberClient.name} reads through the subtree key`);

/* Revoke the individual grantee, the subtree grant is separate */

await ownerClient.revoke(secretName, `${grantee.label}.eth`);

await granteeClient
    .get(secretName)
    .then(() => fail("revoked grantee still reads"))
    .catch((e) => (e instanceof NoWrapError ? pass("revoked grantee refused") : fail(String(e))));

if (text(await ownerClient.get(secretName)) !== SECRET) fail("owner lost access after revoke");
if (text(await recoveryClient.get(secretName)) !== SECRET) fail("recovery lost access after revoke");
pass("owner and recovery survive the revoke");

if (text(await memberClient.get(secretName)) !== SECRET) fail("subtree member lost access after an unrelated revoke");
pass("the subtree grant survives revoking an individual");

/* Rotate the value */

await ownerClient.rotate(secretName, new TextEncoder().encode(ROTATED));

if (text(await ownerClient.get(secretName)) !== ROTATED) fail("owner did not see the rotated value");
if (text(await memberClient.get(secretName)) !== ROTATED) fail("subtree member did not see the rotated value");
pass("rotation changed the value for everyone still granted");

/* Rotate the subtree key, which is how a member is removed */

const parentClient = clientFor(grantee.index, parentName);
await parentClient.subtree.rotate();
const version = await parentClient.subtree.version();

await memberClient
    .get(secretName)
    .then(() => fail("member still reads after the subtree key rotated"))
    .catch(() => pass(`member locked out after subtree rotated to version ${version}`));

/* Re-grant to the new subtree key and redistribute */

await ownerClient.grant(secretName, parentName, { subtree: true });
await parentClient.subtree.distribute([memberClient.name]);

if (text(await memberClient.get(secretName)) !== ROTATED) fail("member did not regain access after redistribution");
pass("member regains access after the parent redistributes");

// The removed member. A bare re-grant would leave the old subtree wrap alive on an unchanged data key,
// which is exactly how a removed member kept reading before the re-grant path was made to rotate.
const removed = clientFor(SUBTREE_MEMBERS[1]!.index, `${SUBTREE_MEMBERS[1]!.label}.${grantee.label}.eth`);
await removed
    .get(secretName)
    .then(() => fail(`${removed.name} was removed from the subtree but still reads`))
    .catch(() => pass(`removed member ${removed.name} stays locked out after the re-grant`));

/* Restore the starting state so the script can run again */

await ownerClient.grant(secretName, `${grantee.label}.eth`);
if (text(await granteeClient.get(secretName)) !== ROTATED) fail("re-granting the individual did not work");
pass("individual grant restored");

await ownerClient.rotate(secretName, new TextEncoder().encode(SECRET));
console.log(`\n${passed} checks passed against real Sepolia`);
