// Writes the sponsor key straight into the web env file so it never reaches a shell argument or a log line

import { mnemonicToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SPONSOR_INDEX = 4;
const ENV_PATH = new URL("../web/.env.local", import.meta.url);

const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set, run pnpm run wallets first");
if (!existsSync(ENV_PATH)) throw new Error("web/.env.local does not exist, copy web/.env.template to it first");

const account = mnemonicToAccount(mnemonic, { addressIndex: SPONSOR_INDEX });
const key = `0x${Buffer.from(account.getHdKey().privateKey!).toString("hex")}`;

const env = readFileSync(ENV_PATH, "utf8");
if (/^REWALL_SPONSOR_KEY=.+$/m.test(env)) {
    console.log(`sponsor ${account.address} already set in web/.env.local, leaving it alone`);
    process.exit(0);
}

const next = /^REWALL_SPONSOR_KEY=\s*$/m.test(env)
    ? env.replace(/^REWALL_SPONSOR_KEY=\s*$/m, `REWALL_SPONSOR_KEY=${key}`)
    : `${env.trimEnd()}\nREWALL_SPONSOR_KEY=${key}\n`;

writeFileSync(ENV_PATH, next);
console.log(`sponsor ${account.address} written to web/.env.local`);
