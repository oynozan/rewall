/*
 * Derives the identity seed from a wallet key once, so the host can stop holding the wallet key
 * The seed decrypts what was granted to this name and can do nothing else
 * Run it on the machine that owns the wallet, not on the agent host
 */

import { readFileSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { identityFromAccount, toBase64 } from "@rewall/sdk";

const key = process.env.REWALL_AGENT_KEY;
if (!key) throw new Error("REWALL_AGENT_KEY is not set, nothing to derive from");

const identity = await identityFromAccount(privateKeyToAccount(key));
const seed = toBase64(identity.secretKey);

const env = readFileSync(".env", "utf8");
const without = env.replace(/^REWALL_IDENTITY_SEED=.*$\n?/m, "");
writeFileSync(".env", `${without.trimEnd()}\nREWALL_IDENTITY_SEED=${seed}\n`);

// The seed itself is never printed, only where it went and what it is for
console.log(`wrote REWALL_IDENTITY_SEED for ${identity.fingerprint} into .env`);
console.log("remove REWALL_AGENT_KEY from .env now, the server no longer needs it");
