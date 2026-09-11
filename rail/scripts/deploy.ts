/*
 * Deploys the rail's contracts through Foundry. The deployer key is derived from the mnemonic and
 * reaches forge only through the child process environment, so it never appears in argv, shell
 * history or output. The ticket signer is a separate index that never needs gas, since it only
 * signs withdraw tickets off chain.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { toHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { DEPLOYER_INDEX, TICKET_SIGNER_INDEX, rpcUrl } from "../src/config.ts";

const mnemonic = process.env.REWALL_TEST_MNEMONIC;
if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set, copy .env.example to .env first");

const deployer = mnemonicToAccount(mnemonic, { addressIndex: DEPLOYER_INDEX });
const signer = mnemonicToAccount(mnemonic, { addressIndex: TICKET_SIGNER_INDEX });

const privateKey = deployer.getHdKey().privateKey;
if (!privateKey) throw new Error("mnemonic produced no private key");

// An npm package of the same name can shadow Foundry on PATH, which fails with a confusing message
const installed = join(homedir(), ".foundry", "bin", process.platform === "win32" ? "forge.exe" : "forge");
const forge = process.env.FORGE_BIN ?? (existsSync(installed) ? installed : "forge");

console.log(`deploying as ${deployer.address}`);
console.log(`ticket signer ${signer.address}`);
console.log(`forge ${forge}`);

// --slow sends one transaction at a time, since broadcasting them together races the account's nonce
const result = spawnSync(
    `"${forge}"`,
    ["script", "contracts/script/Deploy.s.sol:Deploy", "--rpc-url", rpcUrl(), "--broadcast", "--slow", "--via-ir"],
    {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, PRIVATE_KEY: toHex(privateKey), TICKET_SIGNER: signer.address },
        stdio: "inherit",
        shell: true,
    },
);

process.exit(result.status ?? 1);
