/*
 * The owner stores a secret and grants it to the enclave like any other participant, then writes the
 * workflow config that points at it. Nothing here is enclave specific, which is the whole claim.
 */

import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Rewall, RECORD, dnsEncode, splitNames, splitApprovals } from "@rewall/sdk";
import { UNIVERSAL_RESOLVER } from "../tools/participants.ts";
import { publicClient, byRole, walletFor, readRecords, secretNameFor } from "../tools/chain.ts";

const ENCLAVE = "enclave.rewall-test-2.eth";
const LABEL = "enclave-spike";
// Deliberately not shaped like a vendor key, so a secret scanner pointed at this repo stays quiet
const PLAINTEXT = "enclave-spike-demo-value-never-a-credential";

const owner = byRole.owner!;
const recovery = byRole.recovery!;
const { account, client } = walletFor(owner.index);

const rewall = new Rewall({
    publicClient,
    walletClient: client,
    account,
    name: `${owner.label}.eth`,
    universalResolver: UNIVERSAL_RESOLVER,
});

const secretName = secretNameFor(LABEL, owner.label!);
console.log(`secret      ${secretName}`);

await rewall.create(secretName, new TextEncoder().encode(PLAINTEXT), {
    type: "apikey",
    grantees: [ENCLAVE],
    recovery: [`${recovery.label}.eth`],
    allow: ["api.openai.com"],
    overwrite: true,
});
console.log(`created     granted to ${ENCLAVE}`);

/* Read back what actually landed, because the workflow reads the same records off the same chain */

const enclaveKey = await rewall.publicKeyOf(ENCLAVE);
const wrapKey = RECORD.wrap(enclaveKey.fingerprint);
const records = await readRecords(secretName, [
    RECORD.version,
    RECORD.encryption,
    RECORD.blob,
    RECORD.holders,
    RECORD.grantees,
    RECORD.authKeys,
    wrapKey,
]);

if (!records[wrapKey]) throw new Error(`${secretName} carries no wrap for ${enclaveKey.fingerprint}`);

console.log(`wrap        ${wrapKey}  ${records[wrapKey].length} base64 chars`);
console.log(`holders     ${splitNames(records[RECORD.holders]).join(", ")}`);
console.log(`grantees    ${splitNames(records[RECORD.grantees]).join(", ")}`);

for (const approval of splitApprovals(records[RECORD.authKeys])) {
    console.log(`approved    ${approval.role} ${approval.name} ${approval.fingerprint}`);
}

/* The workflow config, pointing at records rather than carrying them */

const config = {
    schedule: "0 */1 * * * *",
    secretId: "ENCLAVE_SCALAR",
    secretName,
    dnsName: dnsEncode(secretName),
    wrapKey,
    expectedDigest: createHash("sha256").update(PLAINTEXT).digest("hex"),
    chainSelectorName: "ethereum-testnet-sepolia",
    universalResolver: UNIVERSAL_RESOLVER,
};

writeFileSync(new URL("./enclave-grantee/config.json", import.meta.url), `${JSON.stringify(config, null, 2)}\n`);
console.log(`\nconfig      written, reads ${secretName} off chain`);
