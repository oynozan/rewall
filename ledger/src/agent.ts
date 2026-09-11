/*
 * Agent side, run on a host with no USB port and no device
 * Reads its key ring membership out of Rewall, then encrypts and decrypts with nothing attached
 */

import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { mnemonicToAccount } from "viem/accounts";
import { Rewall, identityFromAccount, wipe } from "@rewall/sdk";
import { withoutDevice, NobleKeyPair, Permissions, Curve } from "./lkrp.ts";

const RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER: Address = "0x4a1817d13e9cf196f471725176355c1234b63c70";

const OWNER = process.env.LEDGER_OWNER_NAME || "rewall-test-1.eth";
const AGENT = process.env.LEDGER_AGENT_NAME || "rewall-test-2.eth";
const LABEL = process.env.LEDGER_SECRET_LABEL || "ledger-ring";

async function agentClient() {
    const mnemonic = process.env.REWALL_TEST_MNEMONIC;
    if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set");

    // Derived here for the demo, in production the host holds only the seed, see mcp/README.md
    const identity = await identityFromAccount(mnemonicToAccount(mnemonic, { addressIndex: 1 }));

    return new Rewall({
        publicClient: createPublicClient({ chain: sepolia, transport: http(RPC, { batch: true }) }),
        name: AGENT,
        universalResolver: UNIVERSAL_RESOLVER,
        identity,
    });
}

async function main() {
    console.log(`${AGENT} picking up its key ring membership, no device attached\n`);

    const rewall = await agentClient();
    const secretName = `${LABEL}.rewall.${OWNER}`;

    const sealed = await rewall.get(secretName);
    let trustchainId: string;
    let privateKey: string;
    try {
        ({ trustchainId, privateKey } = JSON.parse(new TextDecoder().decode(sealed)));
    } finally {
        await wipe(sealed);
    }
    console.log("read", secretName, "from chain");
    console.log("trustchain", trustchainId);

    const member = NobleKeyPair.from(Buffer.from(privateKey.replace(/^0x/, ""), "hex"), Curve.K256);
    console.log("member", member.getPublicKeyToHex(), "\n");

    // A known trustchain is all authenticate needs, so no session and no transport are involved
    const lkrp = withoutDevice();
    const output = await new Promise<any>((resolve, reject) => {
        lkrp.authenticate({
            keyPair: member,
            clientName: AGENT,
            permissions: Permissions[process.env.LEDGER_PERMISSIONS || "OWNER"],
            trustchainId,
        }).observable.subscribe({
            next: (state: any) => {
                if (state.status === "pending") console.log("  step:", state.intermediateValue?.step);
                if (state.status === "completed") resolve(state.output);
                if (state.status === "error") reject(state.error);
            },
            error: reject,
        });
    });

    console.log("\nauthenticated to the key ring with no device");

    const plaintext = new TextEncoder().encode("a credential only the ring can open");
    const box = await lkrp.encryptData(output.encryptionKey, plaintext);
    const back = await lkrp.decryptData(output.encryptionKey, box);

    console.log("sealed  ", Buffer.from(box).toString("hex").slice(0, 48), "...");
    console.log(
        "round trip",
        new TextDecoder().decode(back) === "a credential only the ring can open" ? "ok" : "failed",
    );
}

main().then(
    () => process.exit(0),
    (error) => {
        console.error(error?.message ?? error);
        process.exit(1);
    },
);
