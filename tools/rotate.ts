import { Rewall, openSecret, wrapFingerprints, RECORD, ROTATE_KEYS, NoWrapError } from "@rewall/sdk";
import { UNIVERSAL_RESOLVER } from "./participants.ts";
import { publicClient, byRole, walletFor, identityOf, secretNameFor, readRecords } from "./chain.ts";

const SECRET_LABEL = process.env.REWALL_SECRET_LABEL ?? "openai";
const PLAINTEXT = "sk-proj-this-is-not-a-real-key-9f3a2b";

const owner = byRole.owner!;
const grantee = byRole.grantee!;
const granteeName = `${grantee.label}.eth`;
const name = secretNameFor(SECRET_LABEL, owner.label!);

const ownerIdentity = await identityOf("owner");
const granteeIdentity = await identityOf("grantee");
const recoveryIdentity = await identityOf("recovery");

const wraps = [ownerIdentity, granteeIdentity, recoveryIdentity].map((i) => RECORD.wrap(i.fingerprint));
const read = () => readRecords(name, [...new Set([...ROTATE_KEYS, ...wraps])]);

const { account, client } = walletFor(owner.index);
const rewall = new Rewall({
    publicClient,
    walletClient: client,
    account,
    name: `${owner.label}.eth`,
    universalResolver: UNIVERSAL_RESOLVER,
});

const gasOf = async (hash: `0x${string}`) => (await publicClient.waitForTransactionReceipt({ hash })).gasUsed;

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

const revokeHash = await rewall.revoke(name, granteeName);
console.log(`revoked  ${granteeName}  gas ${await gasOf(revokeHash)}`);
console.log(`         https://sepolia.etherscan.io/tx/${revokeHash}\n`);

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

// A rotation that dropped the name from the signed list is the only reason the wrap above stays dead
const dropped = !after[RECORD.authKeys]?.includes(granteeIdentity.fingerprint);
if (!dropped) throw new Error("FAIL the revoked holder is still an approved key");
console.log(`PASS  the revoked holder left the approved keys at counter ${after[RECORD.authCounter]}`);

/* Restore, so the script can run again */

const grantHash = await rewall.grant(name, granteeName);
const final = await read();
await openSecret(final, granteeIdentity, name);
console.log(`\nPASS  re-granted, the grantee reads again  gas ${await gasOf(grantHash)}`);
