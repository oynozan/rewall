/*
 * Opens a real Rewall secret from ENS inside the enclave. The records are read on the DON, because
 * chain reads never execute in a TEE, and they are public ciphertext so nothing is disclosed by that.
 * The identity scalar arrives from the Vault DON, the plaintext never leaves, and only a digest of it
 * crosses back. Every primitive libsodium and WebCrypto give the host is reassembled here, since the
 * QuickJS runtime has neither.
 */

import { cre, encodeCallMsg, getNetwork, LATEST_BLOCK_NUMBER, type TeeRuntime } from "@chainlink/cre-sdk";
import { x25519 } from "@noble/curves/ed25519.js";
import { hsalsa, xsalsa20poly1305 } from "@noble/ciphers/salsa.js";
import { gcm } from "@noble/ciphers/aes.js";
import { equalBytes } from "@noble/ciphers/utils.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, decodeFunctionResult, encodeFunctionData, hexToBytes, namehash, parseAbi } from "viem";
import { z } from "zod";

export const configSchema = z.object({
    schedule: z.string(),
    secretId: z.string(),
    secretName: z.string(),
    dnsName: z.string(),
    wrapKey: z.string(),
    expectedDigest: z.string(),
    chainSelectorName: z.string(),
    universalResolver: z.string(),
});
type Config = z.infer<typeof configSchema>;

const NONCE_BYTES = 12;
const COMMITMENT_BYTES = 32;
const PAD_BLOCK = 256;
const COMMITMENT_CONTEXT = "Rewall dek v1";
const SCHEMA_VERSION = "3";
const ENCRYPTION = "aes-256-gcm";

// Salsa's "expand 32-byte k", which libsodium passes as NULL and noble wants spelled out
const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);

const resolverAbi = parseAbi([
    "function text(bytes32 node, string key) view returns (string)",
    "function multicall(bytes[] data) returns (bytes[])",
]);

const universalResolverAbi = parseAbi(["function resolve(bytes name, bytes data) view returns (bytes, address)"]);

const concat = (...parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
};

// Copied rather than aliased, because a Uint32Array view needs a four byte aligned offset
const u32 = (bytes: Uint8Array): Uint32Array => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const out = new Uint32Array(bytes.length / 4);
    for (let i = 0; i < out.length; i++) out[i] = view.getUint32(i * 4, true);
    return out;
};

const fromU32 = (words: Uint32Array): Uint8Array => {
    const out = new Uint8Array(words.length * 4);
    const view = new DataView(out.buffer);
    for (let i = 0; i < words.length; i++) view.setUint32(i * 4, words[i]!, true);
    return out;
};

// Buffer rather than atob, because the runtime exposes the first and not the second
const fromBase64 = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, "base64"));

/*
 * libsodium crypto_box_seal_open. The secretbox key is HSalsa20 over the raw X25519 output with a
 * sixteen byte zero input, not the X25519 output itself, and the nonce is blake2b over the ephemeral
 * public key followed by the recipient's.
 */
const sealOpen = (sealed: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array => {
    const ephemeral = sealed.subarray(0, 32);
    const shared = x25519.getSharedSecret(secretKey, ephemeral);

    const subkey = new Uint32Array(8);
    hsalsa(SIGMA, u32(shared), u32(new Uint8Array(16)), subkey);

    const nonce = blake2b(concat(ephemeral, publicKey), { dkLen: 24 });
    return xsalsa20poly1305(fromU32(subkey), nonce).decrypt(sealed.subarray(32));
};

const unpad = (padded: Uint8Array): Uint8Array => {
    if (padded.length === 0 || padded.length % PAD_BLOCK !== 0) throw new Error("padding is not a whole block count");

    const length = new DataView(padded.buffer, padded.byteOffset, padded.length).getUint32(0, false);
    if (length + 4 > padded.length) throw new Error("padded length runs past the buffer");

    for (let i = 4 + length; i < padded.length; i++) {
        if (padded[i] !== 0) throw new Error("padding is not zero filled");
    }
    return padded.subarray(4, 4 + length);
};

/*
 * One batched resolve for every record the read needs, on the DON runtime because the EVM client
 * accepts nothing else. Four separate calls would fit the fifteen call budget but not the point.
 */
const readRecords = (runtime: TeeRuntime<Config>, keys: string[]): Record<string, string> => {
    const config = runtime.config;
    const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName });
    if (!network) throw new Error(`${config.chainSelectorName} is not a supported chain`);

    const node = namehash(config.secretName);
    const inner = keys.map((key) => encodeFunctionData({ abi: resolverAbi, functionName: "text", args: [node, key] }));

    const reply = new cre.capabilities.EVMClient(network.chainSelector.selector)
        .callContract(runtime.usingTheDons(), {
            call: encodeCallMsg({
                from: "0x0000000000000000000000000000000000000000",
                to: config.universalResolver as `0x${string}`,
                data: encodeFunctionData({
                    abi: universalResolverAbi,
                    functionName: "resolve",
                    args: [
                        config.dnsName as `0x${string}`,
                        encodeFunctionData({ abi: resolverAbi, functionName: "multicall", args: [inner] }),
                    ],
                }),
            }),
            blockNumber: LATEST_BLOCK_NUMBER,
        })
        .result();

    const [result] = decodeFunctionResult({
        abi: universalResolverAbi,
        functionName: "resolve",
        data: bytesToHex(reply.data),
    });
    const parts = decodeFunctionResult({ abi: resolverAbi, functionName: "multicall", data: result });

    const records: Record<string, string> = {};
    keys.forEach((key, i) => {
        records[key] = decodeFunctionResult({ abi: resolverAbi, functionName: "text", data: parts[i]! }) as string;
    });
    return records;
};

// Deterministic over its inputs, and it never returns or logs the plaintext it recovers
const openSecret = (config: Config, records: Record<string, string>, scalarHex: string): string => {
    if (records["rewall.v"] !== SCHEMA_VERSION) throw new Error(`unexpected schema version ${records["rewall.v"]}`);
    if (records["rewall.enc"] !== ENCRYPTION) throw new Error(`unexpected encryption ${records["rewall.enc"]}`);

    const wrapped = records[config.wrapKey];
    if (!wrapped) throw new Error(`no wrap at ${config.wrapKey}, this enclave is not a grantee`);

    const secretKey = hexToBytes(`0x${scalarHex}` as `0x${string}`);
    const publicKey = x25519.getPublicKey(secretKey);
    const context = hexToBytes(namehash(config.secretName));

    const dek = sealOpen(fromBase64(wrapped), publicKey, secretKey);

    const blob = fromBase64(records["rewall.blob"]!);
    const nonce = blob.subarray(0, NONCE_BYTES);
    const commitment = blob.subarray(NONCE_BYTES, NONCE_BYTES + COMMITMENT_BYTES);
    const ciphertext = blob.subarray(NONCE_BYTES + COMMITMENT_BYTES);

    // Checked before the open, so a blob lifted to another name or another key says which problem it hit
    const expected = sha256(concat(new TextEncoder().encode(COMMITMENT_CONTEXT), context, dek, nonce));
    if (!equalBytes(commitment, expected)) throw new Error("key commitment does not match");

    return bytesToHex(sha256(unpad(gcm(dek, nonce, context).decrypt(ciphertext)))).slice(2);
};

export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
    const config = runtime.config;

    const records = readRecords(runtime, ["rewall.v", "rewall.enc", "rewall.blob", config.wrapKey]);
    const scalarHex = runtime.getSecret({ id: config.secretId }).result().value;
    const digest = openSecret(config, records, scalarHex);

    return `opened=${digest === config.expectedDigest} digest=${digest}`;
};

export function initWorkflow(config: Config) {
    const cron = new cre.capabilities.CronCapability();

    return [
        cre.handlerInTee(cron.trigger({ schedule: config.schedule }), onCronTrigger, [
            { tee: "nitro", regions: ["us-west-2"] },
        ]),
    ];
}
