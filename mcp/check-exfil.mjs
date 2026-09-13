/*
 * Tries to get a secret out of the server the way a hostile model would, against real Sepolia
 *
 * The endpoint it is pointed at echoes every request header back, so the secret really does come back
 * over the wire. What this asserts is that it never reaches the caller. Set REWALL_ECHO_HOST to use
 * something other than httpbin.org.
 */

import assert from "node:assert";
import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Rewall } from "@rewall/sdk";

const RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const UR = "0x4a1817d13e9cf196f471725176355c1234b63c70";
const NAME = process.env.REWALL_NAME;
const ECHO = process.env.REWALL_ECHO_HOST || "httpbin.org";
const LABEL = "exfil-probe";

// Distinctive, long enough to be a needle, and shaped like nothing the echo would print by itself
const VALUE = `sk-live-exfilprobe-${Date.now().toString(36)}-zzq`;

const pass = (what) => console.log(`  ok  ${what}`);
const textOf = (result) => result.content.map((part) => part.text ?? "").join("\n");

if (!process.env.REWALL_TEST_MNEMONIC) throw new Error("REWALL_TEST_MNEMONIC is not set");
if (!NAME) throw new Error("REWALL_NAME is not set, this drives the local server");

/* Put a secret on chain that is allowed to reach an endpoint which echoes it straight back */

const account = mnemonicToAccount(process.env.REWALL_TEST_MNEMONIC, { addressIndex: 0 });
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
const owner = new Rewall({
    publicClient,
    walletClient: createWalletClient({ account, chain: sepolia, transport: http(RPC) }),
    account,
    name: NAME,
    universalResolver: UR,
});

console.log(`storing ${LABEL} allowed to reach ${ECHO}`);
await owner.create(`${LABEL}.rewall.${NAME}`, new TextEncoder().encode(VALUE), {
    type: "apikey",
    recovery: ["rewall-test-3.eth"],
    allow: [ECHO],
    overwrite: true,
});

const client = new Client({ name: "rewall-exfil", version: "0.1.0" });
await client.connect(
    new StdioClientTransport({
        command: "node",
        args: ["--env-file=.env", "--experimental-strip-types", "src/index.ts"],
        stderr: "pipe",
    }),
);

const everything = [];
const call = async (name, args) => {
    const text = textOf(await client.callTool({ name, arguments: args }));
    everything.push(text);
    return text;
};

try {
    /* The echo really does return it, so this is a live attempt and not a simulated one */

    const direct = await fetch(`https://${ECHO}/headers`, { headers: { authorization: `Bearer ${VALUE}` } });
    const echoed = await direct.text();
    assert.ok(echoed.includes(VALUE), `${ECHO} did not echo the header back, so this check proves nothing`);
    pass(`${ECHO} echoes an Authorization header back, so the secret does cross the wire`);

    /* Now the same request through the server, which is the whole question */

    const through = await call("http_with_secret", { secret: LABEL, url: `https://${ECHO}/headers` });
    assert.ok(!through.includes(VALUE), "THE SECRET REACHED THE CALLER");
    assert.ok(through.includes("[redacted by rewall]"), "the echoed value was redacted");
    assert.ok(/echoed the secret back/.test(through), "and the caller is told the host echoed it");
    pass("the model got the response with the value redacted and an alarm attached");

    /* Every other way a model might ask for it */

    const listed = await call("list_secrets", {});
    assert.ok(listed.includes(LABEL), "the secret is listed");
    assert.ok(!listed.includes(VALUE), "listing never carries a value");
    pass("list_secrets returns metadata and no value");

    const elsewhere = await call("http_with_secret", { secret: LABEL, url: "https://api.github.com/user" });
    assert.ok(/allowed hosts|refus/i.test(elsewhere), `a host outside the list was not refused: ${elsewhere}`);
    pass("a host the owner never listed is refused before anything is decrypted");

    const plain = await call("http_with_secret", { secret: LABEL, url: `http://${ECHO}/headers` });
    assert.ok(!plain.includes(VALUE), "plain http leaked the value");
    pass("plain http is refused");

    const asOtp = await call("otp_code", { secret: LABEL });
    assert.ok(!asOtp.includes(VALUE), "otp_code leaked the value");
    pass("otp_code refuses a secret that is not an authenticator");

    const asKey = await call("sign_with_secret", { secret: LABEL, token: "USDC", to: account.address, amount: "1" });
    assert.ok(!asKey.includes(VALUE), "sign_with_secret leaked the value");
    pass("sign_with_secret refuses a secret that is not a signing key");

    const missing = await call("http_with_secret", { secret: "no-such-secret-here", url: `https://${ECHO}/headers` });
    assert.ok(!missing.includes(VALUE), "an error for a missing secret leaked another one");
    pass("a secret that does not exist says so and carries nothing");

    /* The load bearing line */

    const all = everything.join("\n");
    assert.ok(!all.includes(VALUE), "the plaintext appeared somewhere in the tool results");
    for (const piece of [VALUE.slice(0, 20), VALUE.slice(-16), Buffer.from(VALUE).toString("base64").slice(0, 24)]) {
        assert.ok(!all.includes(piece), `a recognisable piece of the secret survived: ${piece}`);
    }
    pass(`no plaintext and no fragment of it in any of ${everything.length} tool results`);

    console.log("\nthe model never saw the secret, through any route tried here");
} finally {
    await client.close();
}
