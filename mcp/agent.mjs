/*
 * Mints an agent identity under a vault you own and writes the MCP client config that uses it
 *
 * The point is that this key is not your wallet identity. A wallet identity reads every secret ever
 * shared with you and can never be revoked, so it must never leave your machine. An agent identity is
 * a fresh scalar with a name of its own, it reads only what you grant that name, and taking it back is
 * a rotation of those secrets. That is the credential a hosted MCP server is safe to be handed.
 *
 * Run it on the machine that holds your wallet, never on the agent host.
 */

import { chmodSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { RECORD, Rewall, identityFromSeed, readTexts, toBase64 } from "@rewall/sdk";

const RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER = "0x4a1817d13e9cf196f471725176355c1234b63c70";
const URL_ = process.env.REWALL_MCP_URL || "https://mcp.rewall.me/mcp";

const args = process.argv.slice(2).filter((arg) => arg !== "--replace");
const replace = process.argv.includes("--replace");
const [vault, label = "agent"] = args;

if (!vault) {
    console.error("usage: pnpm run agent <your-vault.eth> [agent-label] [--replace]");
    console.error("needs REWALL_OWNER_KEY or REWALL_OWNER_MNEMONIC in .env, the wallet that owns the vault");
    process.exit(1);
}
if (!/^[a-z0-9-]{1,63}$/.test(label)) throw new Error("an agent label is lowercase letters, digits and hyphens");

// A seed written into this config would cross the network in the clear on anything but https
const target = new URL(URL_);
if (target.protocol !== "https:" && !["127.0.0.1", "::1", "localhost"].includes(target.hostname)) {
    throw new Error(`${URL_} is not https, so a seed sent to it would cross the network in the clear`);
}

const key = process.env.REWALL_OWNER_KEY;
const phrase = process.env.REWALL_OWNER_MNEMONIC;
if (!key && !phrase) throw new Error("set REWALL_OWNER_KEY or REWALL_OWNER_MNEMONIC, the wallet that owns the vault");
const account = key ? privateKeyToAccount(key) : mnemonicToAccount(phrase, { addressIndex: 0 });

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC) });

const agentName = `${label}.${vault}`;

// Overwriting a published key strands every secret already granted to this name, silently
const existing = await readTexts(publicClient, UNIVERSAL_RESOLVER, agentName, [RECORD.pubkey]);
if (existing[RECORD.pubkey] && !replace) {
    console.error(`${agentName} already publishes a key, so an agent is already using it.`);
    console.error("Pick another label, or pass --replace to cut the current one off deliberately.");
    process.exit(1);
}

// A fresh scalar, so nothing about this key is derived from the wallet that is about to publish it
const identity = await identityFromSeed(crypto.getRandomValues(new Uint8Array(32)));

const config = {
    mcpServers: {
        rewall: {
            type: "http",
            url: URL_,
            headers: { "X-Rewall-Vault": vault, "X-Rewall-Seed": toBase64(identity.secretKey) },
        },
    },
};

// Saved before the key is published, so a failed write cannot leave a name whose seed nobody holds
const file = new URL(`agent-${label}.mcp.json`, import.meta.url);
writeFileSync(file, `${JSON.stringify({ agent: agentName, fingerprint: identity.fingerprint, ...config }, null, 4)}\n`);
chmodSync(file, 0o600);

// The wallet only sends the transaction, the identity written is the agent's own
const agent = new Rewall({
    publicClient,
    walletClient,
    account,
    name: agentName,
    universalResolver: UNIVERSAL_RESOLVER,
    identity,
});

const hash = await agent.publishIdentity();
console.log(`published ${agentName} as ${identity.fingerprint}`);
if (hash) console.log(`https://sepolia.etherscan.io/tx/${hash}`);

console.log(`\nwrote ${file.pathname.split("/").pop()}, which carries the seed. Treat it like what it opens.`);
console.log(`Copy it into your MCP client, then grant this agent what it needs:\n`);
console.log(`  await rewall.grant("<secret>.rewall.${vault}", "${agentName}")\n`);
console.log("Revoking that name stops future reads. It does not unsee what the agent already read, and");
console.log("the old value stays in chain history, so rotate the credential at its provider as well.");
