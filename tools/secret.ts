import { Rewall, openSecret, wrapFingerprints, RECORD, ROTATE_KEYS, SCHEMA_VERSION, NoWrapError } from "@rewall/sdk";
import { UNIVERSAL_RESOLVER } from "./participants.ts";
import { publicClient, byRole, walletFor, identityOf, secretNameFor, readRecords } from "./chain.ts";

const SECRET_LABEL = process.env.REWALL_SECRET_LABEL ?? "openai";
const PLAINTEXT = "sk-proj-this-is-not-a-real-key-9f3a2b";

const owner = byRole.owner!;
const grantee = byRole.grantee!;
const recovery = byRole.recovery!;
const name = secretNameFor(SECRET_LABEL, owner.label!);
console.log(`secret   ${name}`);

const ownerIdentity = await identityOf("owner");
const granteeIdentity = await identityOf("grantee");
const recoveryIdentity = await identityOf("recovery");

console.log(
    `holders  owner=${ownerIdentity.fingerprint}  grantee=${granteeIdentity.fingerprint}  recovery=${recoveryIdentity.fingerprint}\n`,
);

/* Create, which signs the lists and writes the records and the index in one transaction, with no registry call */

const { account, client } = walletFor(owner.index);
const rewall = new Rewall({
    publicClient,
    walletClient: client,
    account,
    name: `${owner.label}.eth`,
    universalResolver: UNIVERSAL_RESOLVER,
});

const hash = await rewall.create(name, new TextEncoder().encode(PLAINTEXT), {
    type: "apikey",
    grantees: [`${grantee.label}.eth`],
    recovery: [`${recovery.label}.eth`],
    allow: ["api.openai.com"],
    overwrite: true,
});

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`created  gas ${receipt.gasUsed}`);
console.log(`tx https://sepolia.etherscan.io/tx/${receipt.transactionHash}\n`);

/* Positive control first, so a broken read path cannot pass as a denial */

const wraps = [ownerIdentity, granteeIdentity, recoveryIdentity].map((i) => RECORD.wrap(i.fingerprint));
const onchain = await readRecords(name, [...new Set([...ROTATE_KEYS, ...wraps])]);

if (onchain[RECORD.version] !== SCHEMA_VERSION) throw new Error(`FAIL bad schema version ${onchain[RECORD.version]}`);

const opened = new TextDecoder().decode(await openSecret(onchain, granteeIdentity, name));
if (opened !== PLAINTEXT) throw new Error("FAIL the grantee decrypted the wrong value");
console.log(`PASS  grantee ${granteeIdentity.fingerprint} read and decrypted the secret`);

const recovered = new TextDecoder().decode(await openSecret(onchain, recoveryIdentity, name));
if (recovered !== PLAINTEXT) throw new Error("FAIL the recovery holder decrypted the wrong value");
console.log(`PASS  recovery ${recoveryIdentity.fingerprint} read and decrypted the secret`);

// The signed list is what a rotation trusts, so a create that skipped it would only fail much later
if (!onchain[RECORD.authKeys]) throw new Error("FAIL the create wrote no approved keys");
if (!onchain[RECORD.authSig]) throw new Error("FAIL the create wrote no signature");
console.log(`PASS  lists signed at counter ${onchain[RECORD.authCounter]}, keys bound for every holder`);

/* Deny */

const strangerIdentity = await identityOf("stranger");
const present = wrapFingerprints(onchain);

try {
    await openSecret(onchain, strangerIdentity, name);
    throw new Error("FAIL the stranger opened the secret");
} catch (error) {
    if (!(error instanceof NoWrapError)) throw error;
    console.log(
        `PASS  stranger ${strangerIdentity.fingerprint} refused with ${error.name}, ${present.length} wraps present`,
    );
}
