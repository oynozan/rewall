// Proves SPEC section 5.2 against Sepolia. The owner loses its wallet and a threshold of guardians
// brings the recovery key back, without any single guardian ever being able to.

import { createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { Rewall, openSecret, readTexts, RECORD, NoWrapError } from "@rewall/sdk";
import {
    NAMESPACE_LABEL,
    UNIVERSAL_RESOLVER,
    GUARDIANS,
    GUARDIAN_THRESHOLD,
    REPLACEMENT_WALLET_INDEX,
} from "./participants.ts";
import { publicClient, byRole, accountFor, identityFor, ensureSecretName } from "./chain.ts";

const LABEL = process.env.REWALL_SECRET_LABEL ?? "vault";
const SECRET = "correct-horse-battery-staple-not-real";

const rpc = process.env.SEPOLIA_RPC_URL!;
const owner = byRole.owner!;
const ownerName = `${owner.label}.eth`;
const secretName = `${LABEL}.${NAMESPACE_LABEL}.${owner.label}.eth`;

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

let passed = 0;
const pass = (m: string) => {
    passed++;
    console.log(`PASS  ${m}`);
};
const fail = (m: string): never => {
    throw new Error(`FAIL  ${m}`);
};

const ownerClient = clientFor(owner.index, ownerName);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

console.log(`owner   ${ownerName}`);
console.log(`secret  ${secretName}`);
console.log(`policy  ${GUARDIAN_THRESHOLD} of ${GUARDIANS.length}\n`);

/* Establish the guardian set */

if (await ensureSecretName(owner.index, owner.label!, LABEL)) console.log(`registered ${secretName}`);

const recovery = await ownerClient.guardians.init(
    GUARDIANS.map((g) => g.name),
    GUARDIAN_THRESHOLD,
);
console.log(`recovery key  ${recovery.fingerprint}  published on ${ownerName}\n`);

const declared = await ownerClient.guardians.of();
if (declared.threshold !== GUARDIAN_THRESHOLD) fail(`threshold read back as ${declared.threshold}`);
if (declared.names.length !== GUARDIANS.length) fail(`guardian list read back as ${declared.names.join(",")}`);
pass(`guardian set published, ${declared.threshold} of ${declared.names.length}`);

/* A secret whose only recovery path is the guardians */

await ownerClient.create(secretName, new TextEncoder().encode(SECRET), {
    type: "generic",
    recovery: [ownerClient.guardians.entry()],
});

if (text(await ownerClient.get(secretName)) !== SECRET) fail("owner cannot read what it created");
pass("owner reads the secret while it still holds its key");

/* The owner loses its wallet */

const replacement = clientFor(REPLACEMENT_WALLET_INDEX, ownerName);
const replacementIdentity = await replacement.identity();

await replacement
    .get(secretName)
    .then(() => fail("the replacement wallet read the secret without recovering"))
    .catch((e) => (e instanceof NoWrapError ? pass("replacement wallet has no wrap of its own") : fail(String(e))));

/* Below the threshold */

const shareFrom = async (guardianIndex: number, guardianName: string) =>
    clientFor(guardianIndex, guardianName).guardians.reshare(ownerName, replacementIdentity.publicKey);

const tooFew = await Promise.all(GUARDIANS.slice(0, GUARDIAN_THRESHOLD - 1).map((g) => shareFrom(g.index, g.name)));
const wrongKey = await replacement.guardians.recover(tooFew);

if (wrongKey.fingerprint === recovery.fingerprint) fail(`${tooFew.length} guardians reconstructed the real key`);
pass(`${tooFew.length} guardians reconstruct a key that is not the recovery key`);

const records = await readTexts(publicClient, UNIVERSAL_RESOLVER, secretName, [
    RECORD.blob,
    RECORD.wrap(recovery.fingerprint),
    RECORD.wrap(wrongKey.fingerprint),
]);

await openSecret(records, wrongKey, secretName)
    .then(() => fail("a below threshold key opened the secret"))
    .catch(() => pass("a below threshold key cannot open the secret"));

/* At the threshold */

const enough = await Promise.all(GUARDIANS.slice(0, GUARDIAN_THRESHOLD).map((g) => shareFrom(g.index, g.name)));
const recovered = await replacement.guardians.recover(enough);

if (recovered.fingerprint !== recovery.fingerprint) fail("the reconstructed key is not the recovery key");
pass(`${GUARDIAN_THRESHOLD} guardians reconstruct exactly the recovery key`);

if (text(await openSecret(records, recovered, secretName)) !== SECRET) fail("the recovery key did not open the secret");
pass("the recovered key opens the secret the lost wallet could not");

/* A different set reaching the threshold works too */

const otherSet = await Promise.all(GUARDIANS.slice(1, 1 + GUARDIAN_THRESHOLD).map((g) => shareFrom(g.index, g.name)));
const again = await replacement.guardians.recover(otherSet);
if (again.fingerprint !== recovery.fingerprint) fail("a different quorum reconstructed a different key");
pass("a different quorum of the same size reconstructs the same key");

console.log(`\n${passed} checks passed against real Sepolia`);
