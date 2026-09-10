// A write delegate appends itself to rewall.grantees and waits for the owner to rotate

import { createWalletClient, http, namehash } from "viem";
import { sepolia } from "viem/chains";
import { Rewall, dnsEncode, resolverAbi, resolverFor, readTexts, splitNames, RECORD } from "@rewall/sdk";
import { NAMESPACE_LABEL, UNIVERSAL_RESOLVER } from "./participants.ts";
import { publicClient, byRole, accountFor, walletFor, ensureSecretName } from "./chain.ts";

const LABEL = process.env.REWALL_SECRET_LABEL ?? "escalation";
const SECRET = "sk-live-the-real-credential";

const rpc = process.env.SEPOLIA_RPC_URL!;
const owner = byRole.owner!;
const delegate = byRole.grantee!;
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

const ownerClient = clientFor(owner.index, `${owner.label}.eth`);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

console.log(`secret    ${secretName}`);
console.log(`delegate  ${accountFor(delegate.index).address}\n`);

/* A secret the delegate is not a grantee of */

if (await ensureSecretName(owner.index, owner.label!, LABEL)) console.log(`registered ${secretName}`);

await ownerClient.create(secretName, new TextEncoder().encode(SECRET), {
    type: "apikey",
    recovery: [`${byRole.recovery!.label}.eth`],
    overwrite: true,
});

const delegateClient = clientFor(delegate.index, `${delegate.label}.eth`);
await delegateClient
    .get(secretName)
    .then(() => fail("the delegate can already read"))
    .catch(() => pass("delegate cannot read the secret, it holds no wrap"));

/* The owner delegates write on exactly the record that drives a rotation */

const resolver = await resolverFor(publicClient, UNIVERSAL_RESOLVER, secretName);
const { account: ownerAccount, client: ownerWallet } = walletFor(owner.index);

const grantHash = await ownerWallet.writeContract({
    address: resolver!,
    abi: resolverAbi,
    functionName: "authorizeTextRoles",
    args: [dnsEncode(secretName), RECORD.grantees, accountFor(delegate.index).address, true],
    account: ownerAccount,
    chain: sepolia,
});
await publicClient.waitForTransactionReceipt({ hash: grantHash });
console.log(`owner delegated write on ${RECORD.grantees} to the delegate\n`);

/* The delegate appends itself, which the chain permits */

const { account: delegateAccount, client: delegateWallet } = walletFor(delegate.index);
const before = await readTexts(publicClient, UNIVERSAL_RESOLVER, secretName, [RECORD.grantees]);
const tampered = [...splitNames(before[RECORD.grantees]), `${delegate.label}.eth`].join(",");

const tamperHash = await delegateWallet.writeContract({
    address: resolver!,
    abi: resolverAbi,
    functionName: "setText",
    args: [namehash(secretName), RECORD.grantees, tampered],
    account: delegateAccount,
    chain: sepolia,
});
const tamperReceipt = await publicClient.waitForTransactionReceipt({ hash: tamperHash });
if (tamperReceipt.status !== "success") fail("the delegate could not write, the delegation did not apply");

const after = await readTexts(publicClient, UNIVERSAL_RESOLVER, secretName, [RECORD.grantees]);
if (!splitNames(after[RECORD.grantees]).includes(`${delegate.label}.eth`)) fail("the tamper did not land");
pass(`delegate wrote itself into ${RECORD.grantees} on chain, which the resolver allows`);

/* The owner rotates. This is where the escalation used to pay off. */

await ownerClient
    .rotate(secretName)
    .then(() => fail("the rotation accepted a grantee list the owner never signed"))
    .catch((e) =>
        e.name === "UnauthorizedListError"
            ? pass(`the owner's rotation refused the tampered list with ${e.name}`)
            : fail(`rotation failed for the wrong reason, ${e.message}`),
    );

await delegateClient
    .get(secretName)
    .then(() => fail("the delegate gained read access"))
    .catch(() => pass("delegate still cannot read after attempting the escalation"));

/* The owner repairs by re-signing the list it actually wants */

await ownerClient.reauthorize(secretName, { grantees: [] });
await ownerClient.rotate(secretName);

if (text(await ownerClient.get(secretName)) !== SECRET) fail("the owner lost access while repairing");
pass("owner repaired the list, rotated, and still reads");

await delegateClient
    .get(secretName)
    .then(() => fail("the delegate read after the repair"))
    .catch(() => pass("delegate is shut out after the repair"));

/* Leave the delegation off so a re-run starts clean */

const revokeHash = await ownerWallet.writeContract({
    address: resolver!,
    abi: resolverAbi,
    functionName: "authorizeTextRoles",
    args: [dnsEncode(secretName), RECORD.grantees, accountFor(delegate.index).address, false],
    account: ownerAccount,
    chain: sepolia,
});
await publicClient.waitForTransactionReceipt({ hash: revokeHash });

console.log(`\n${passed} checks passed against real Sepolia`);
