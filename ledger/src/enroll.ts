/*
 * Owner side, run on the machine that has the device
 * Mints a key ring member for one agent, has the device approve it, then hands the member to Rewall
 * to deliver, so the credential reaches the agent sealed to its ENS name rather than copied to a box
 */

import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { mnemonicToAccount } from "viem/accounts";
import { Rewall } from "@rewall/sdk";
import { withDevice, run, NobleKeyPair, Permissions, Curve } from "./lkrp.ts";

const RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const UNIVERSAL_RESOLVER: Address = "0x4a1817d13e9cf196f471725176355c1234b63c70";

const OWNER = process.env.LEDGER_OWNER_NAME || "rewall-test-1.eth";
const AGENT = process.env.LEDGER_AGENT_NAME || "rewall-test-2.eth";
const RECOVERY = process.env.LEDGER_RECOVERY_NAME || "rewall-test-3.eth";
const LABEL = process.env.LEDGER_SECRET_LABEL || "ledger-ring";

function ownerClient() {
    const mnemonic = process.env.REWALL_TEST_MNEMONIC;
    if (!mnemonic) throw new Error("REWALL_TEST_MNEMONIC is not set");
    const account = mnemonicToAccount(mnemonic, { addressIndex: 0 });

    return new Rewall({
        publicClient: createPublicClient({ chain: sepolia, transport: http(RPC, { batch: true }) }),
        walletClient: createWalletClient({ account, chain: sepolia, transport: http(RPC) }),
        account,
        name: OWNER,
        universalResolver: UNIVERSAL_RESOLVER,
    });
}

async function main() {
    console.log(`enrolling ${AGENT} into ${OWNER}'s key ring\n`);

    // One member per agent rather than a shared credential, so removing this one cuts off only it
    const member = await NobleKeyPair.generate(Curve.K256);
    console.log("minted member key", member.getPublicKeyToHex());

    const { dmk, lkrp, sessionId } = await withDevice();
    console.log("device connected, waiting for approval\n");

    // Encrypt and write its own join block, but not derive sub streams and not own the ring
    const PERMISSIONS = Permissions[process.env.LEDGER_PERMISSIONS || "OWNER"];

    // Least privilege that still lets the member join and read the stream key
    const authenticated = await run<{ trustchainId: string }>(
        lkrp.authenticate({
            keyPair: member,
            clientName: AGENT,
            permissions: PERMISSIONS,
            sessionId,
        }),
        (screen) => console.log(`  approved on device: "${screen}"`),
    );

    const trustchainId = authenticated.trustchainId;
    console.log("\ntrustchain", trustchainId);
    await dmk.disconnect({ sessionId });

    // The member travels as a Rewall secret, sealed to the agent's published key, revocable on chain
    const rewall = ownerClient();
    const payload = new TextEncoder().encode(JSON.stringify({ trustchainId, privateKey: member.id }));

    const secretName = `${LABEL}.rewall.${OWNER}`;
    const hash = await rewall.create(secretName, payload, {
        type: "privkey",
        grantees: [AGENT],
        recovery: [RECOVERY],
        overwrite: true,
    });

    console.log(`\nsealed to ${AGENT} as ${secretName}`);
    console.log("tx", hash);
    console.log("\nthe agent needs no device and no copied file, only the name it already owns");
}

main().then(
    () => process.exit(0),
    (error) => {
        console.error(error?.message ?? error);
        process.exit(1);
    },
);
