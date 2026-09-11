// Stores a real authenticator account on Sepolia and proves the code it yields matches the seed that went in

import { createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { Rewall, RECORD, normalizeSite } from "@rewall/sdk";
import { describeOtpUri, parseOtp, otpSnapshot } from "@rewall/sdk/2fa";
import { NAMESPACE_LABEL, UNIVERSAL_RESOLVER } from "./participants.ts";
import { publicClient, byRole, accountFor, ensureSecretName, readRecords } from "./chain.ts";

const uri = process.env.REWALL_TOTP_URI;
const site = process.env.REWALL_TOTP_SITE;

if (!uri) throw new Error("REWALL_TOTP_URI is not set, paste the otpauth:// setup key from a real account");
if (!site) throw new Error("REWALL_TOTP_SITE is not set, give the hostname where the code gets typed");

// Validated before anything touches the chain, and this reads no key material out of the URI
const account = describeOtpUri(uri);
const hostname = normalizeSite(site);

const rpc = process.env.SEPOLIA_RPC_URL!;
const owner = byRole.owner!;
const recovery = byRole.recovery!;

const clientFor = (index: number, name: string) => {
    const client = accountFor(index);
    return new Rewall({
        publicClient,
        walletClient: createWalletClient({ account: client, chain: sepolia, transport: http(rpc) }),
        account: client,
        name,
        universalResolver: UNIVERSAL_RESOLVER,
    });
};

const ownerClient = clientFor(owner.index, `${owner.label}.eth`);
const recoveryClient = clientFor(recovery.index, `${recovery.label}.eth`);

const label = (process.env.REWALL_SECRET_LABEL ?? account.issuer ?? "authenticator")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

const secretName = `${label}.${NAMESPACE_LABEL}.${owner.label}.eth`;
const bytes = () => new TextEncoder().encode(uri);
const text = (value: Uint8Array) => new TextDecoder().decode(value);

let passed = 0;
const pass = (message: string) => {
    passed++;
    console.log(`PASS  ${message}`);
};
const fail = (message: string): never => {
    throw new Error(`FAIL  ${message}`);
};

console.log(`secret  ${secretName}`);
console.log(`account ${account.issuer} ${account.digits} digits every ${account.period}s`);
console.log(`site    ${hostname}\n`);

/* Setup */

if (await ensureSecretName(owner.index, owner.label!, label)) console.log(`registered ${secretName}`);
for (const client of [ownerClient, recoveryClient]) {
    if (await client.publishIdentity()) console.log(`published identity for ${client.name}`);
}

/* Create */

const hash = await ownerClient.create(secretName, bytes(), {
    type: "totp",
    site: hostname,
    recovery: [`${recovery.label}.eth`],
    overwrite: true,
});
console.log(`stored  https://sepolia.etherscan.io/tx/${hash}\n`);

/* The records the extension reads before it fills anything */

const records = await readRecords(secretName, [RECORD.version, RECORD.type, RECORD.site]);
if (records[RECORD.type] !== "totp") fail(`rewall.type reads ${records[RECORD.type]}, expected totp`);
pass("rewall.type marks it an authenticator account");

if (records[RECORD.site] !== hostname) fail(`rewall.site reads ${records[RECORD.site]}, expected ${hostname}`);
pass(`rewall.site reads back as ${hostname}`);

/* The seed survives the round trip */

const opened = await ownerClient.get(secretName);
if (text(opened) !== uri) fail("the owner decrypted something other than the setup key that went in");
pass("the owner decrypts the setup key unchanged");

const recovered = await recoveryClient.get(secretName);
if (text(recovered) !== uri) fail("the recovery holder decrypted something other than the setup key");
pass("the recovery holder decrypts it too");

/* The code the extension would fill */

// Two independent paths from the same seed, one through the chain and one straight from the setup key
const at = Date.now();
const fromChain = otpSnapshot(parseOtp(opened), at);
const fromSource = otpSnapshot(parseOtp(bytes()), at);

if (fromChain.code !== fromSource.code) fail("the stored seed produces a different code than the setup key");
pass(`a code generated from chain matches the setup key, ${fromChain.remaining}s left in this step`);

if (fromChain.code.length !== account.digits) fail(`the code is ${fromChain.code.length} digits, expected ${account.digits}`);
pass(`the code is ${account.digits} digits, as the account declares`);

console.log(`\n${passed} checks passed against real Sepolia`);
console.log(`open the dashboard at /dashboard/2fa to see it, and type the code into ${hostname} to prove it`);
