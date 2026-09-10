import { planRotate, openSecret, wrapFingerprints, RECORD, NoWrapError } from "@rewall/sdk";
import { byRole, identityOf, publishedPublicKey, secretNameFor, readRecords, writeRecords } from "./chain.ts";

const SECRET_LABEL = process.env.REWALL_SECRET_LABEL ?? "openai";
const PLAINTEXT = "sk-proj-this-is-not-a-real-key-9f3a2b";

const owner = byRole.owner!;
const name = secretNameFor(SECRET_LABEL, owner.label!);

const ownerIdentity = await identityOf("owner");
const granteeIdentity = await identityOf("grantee");
const recoveryIdentity = await identityOf("recovery");

const holders = {
    owner: { fingerprint: ownerIdentity.fingerprint, publicKey: await publishedPublicKey("owner") },
    grantee: { fingerprint: granteeIdentity.fingerprint, publicKey: await publishedPublicKey("grantee") },
    recovery: { fingerprint: recoveryIdentity.fingerprint, publicKey: await publishedPublicKey("recovery") },
};

const allKeys = [
    RECORD.blob,
    RECORD.version,
    RECORD.type,
    RECORD.created,
    RECORD.allow,
    ...Object.values(holders).map((h) => RECORD.wrap(h.fingerprint)),
];

const read = () => readRecords(name, allKeys);

console.log(`secret   ${name}\n`);

/* Before */

const before = await read();
if (!before[RECORD.blob]) throw new Error(`${name} has no blob, run pnpm run secret first`);

const cachedGranteeWrap = before[RECORD.wrap(granteeIdentity.fingerprint)];
if (!cachedGranteeWrap) throw new Error("the grantee is not currently a holder, run pnpm run secret first");

await openSecret(before, granteeIdentity, name);
console.log(
    `before   grantee ${granteeIdentity.fingerprint} can read, wraps present ${wrapFingerprints(before).length}`,
);

/* Revoke, which is a rotate that drops one holder */

const revoked = await planRotate({
    type: "apikey",
    plaintext: new TextEncoder().encode(PLAINTEXT),
    owner: holders.owner,
    recovery: [holders.recovery],
    previousFingerprints: wrapFingerprints(before),
    createdAt: Math.floor(Date.now() / 1000),
    allow: ["api.openai.com"],
});

const revokeReceipt = await writeRecords(owner.index, name, revoked.records);
console.log(`revoked  cleared ${revoked.cleared.join(", ")}  gas ${revokeReceipt.gasUsed}`);
console.log(`         https://sepolia.etherscan.io/tx/${revokeReceipt.transactionHash}\n`);

/* After the revoke */

const after = await read();

if (after[RECORD.blob] === before[RECORD.blob]) throw new Error("FAIL the ciphertext did not change");
console.log(`PASS  the ciphertext was replaced, so the old blob is dead`);

const stillOwner = new TextDecoder().decode(await openSecret(after, ownerIdentity, name));
if (stillOwner !== PLAINTEXT) throw new Error("FAIL the owner lost access");
const stillRecovery = new TextDecoder().decode(await openSecret(after, recoveryIdentity, name));
if (stillRecovery !== PLAINTEXT) throw new Error("FAIL the recovery holder lost access");
console.log(`PASS  owner and recovery still read after the rotation`);

try {
    await openSecret(after, granteeIdentity, name);
    throw new Error("FAIL the revoked holder still reads the secret");
} catch (error) {
    if (!(error instanceof NoWrapError)) throw error;
    console.log(`PASS  revoked holder refused with ${error.name}`);
}

// The revoked party kept their old wrap, which is the realistic attack rather than reading the cleared record
const replayed = { ...after, [RECORD.wrap(granteeIdentity.fingerprint)]: cachedGranteeWrap };
try {
    await openSecret(replayed, granteeIdentity, name);
    throw new Error("FAIL a cached wrap opened the new ciphertext");
} catch (error) {
    if (error instanceof Error && error.message.startsWith("FAIL")) throw error;
    console.log(`PASS  the revoked holder's cached wrap does not open the new ciphertext`);
}

/* Restore, so the script can run again */

const restored = await planRotate({
    type: "apikey",
    plaintext: new TextEncoder().encode(PLAINTEXT),
    owner: holders.owner,
    recovery: [holders.recovery],
    grantees: [holders.grantee],
    previousFingerprints: wrapFingerprints(after),
    createdAt: Math.floor(Date.now() / 1000),
    allow: ["api.openai.com"],
});

const restoreReceipt = await writeRecords(owner.index, name, restored.records);
const final = await read();
await openSecret(final, granteeIdentity, name);
console.log(`\nPASS  re-granted, the grantee reads again  gas ${restoreReceipt.gasUsed}`);
