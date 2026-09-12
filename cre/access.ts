/*
 * Revokes or re-grants the enclave, so the simulator can be run either side of it. Revoking is a full
 * rotation, which is what makes the enclave's wrap dead rather than merely unlisted.
 */

import { Rewall, RECORD, splitApprovals } from "@rewall/sdk";
import { UNIVERSAL_RESOLVER } from "../tools/participants.ts";
import { publicClient, byRole, walletFor, readRecords, secretNameFor } from "../tools/chain.ts";

const ENCLAVE = "enclave.rewall-test-2.eth";
const LABEL = "enclave-spike";

const action = process.argv[2];
if (action !== "revoke" && action !== "grant") throw new Error("pass revoke or grant");

const owner = byRole.owner!;
const { account, client } = walletFor(owner.index);

const rewall = new Rewall({
    publicClient,
    walletClient: client,
    account,
    name: `${owner.label}.eth`,
    universalResolver: UNIVERSAL_RESOLVER,
});

const secretName = secretNameFor(LABEL, owner.label!);
const enclaveKey = await rewall.publicKeyOf(ENCLAVE);
const wrapKey = RECORD.wrap(enclaveKey.fingerprint);

if (action === "revoke") {
    await rewall.revoke(secretName, ENCLAVE);
    console.log(`revoked     ${ENCLAVE} from ${secretName}`);
} else {
    await rewall.grant(secretName, ENCLAVE);
    console.log(`granted     ${ENCLAVE} on ${secretName}`);
}

const after = await readRecords(secretName, [wrapKey, RECORD.grantees, RECORD.authKeys, RECORD.authCounter]);

console.log(`wrap        ${after[wrapKey] ? `${after[wrapKey].length} base64 chars` : "cleared"}`);
console.log(`grantees    ${after[RECORD.grantees] || "(none)"}`);
console.log(`counter     ${after[RECORD.authCounter]}`);

for (const approval of splitApprovals(after[RECORD.authKeys])) {
    console.log(`approved    ${approval.role} ${approval.name} ${approval.fingerprint}`);
}
