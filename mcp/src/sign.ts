/*
 * Bounded signing for sign_with_secret
 * The model supplies parameters, this file supplies the structure, which is the whole safety design
 * There is deliberately no path that signs a hash, a free form message, or caller supplied typed data
 * because identity.ts derives the X25519 key from a signature over IDENTITY_TYPED_DATA, so a signing
 * oracle over chosen payloads hands over every secret ever shared with that wallet, permanently
 */

import { readFileSync } from "node:fs";
import { encodeFunctionData, getAddress, isAddress, parseAbi, type Address, type Hex } from "viem";

export class SignRefused extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SignRefused";
    }
}

const ERC20 = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

export type SignPolicy = {
    chainId: number;
    tokens: string[];
    recipients: string[];
    maxAmount: string;
};

type PolicyFile = Record<string, SignPolicy>;

let cached: PolicyFile | null = null;

// Absent policy is not permission to sign anything, so a missing file denies every secret
function policies(path: string): PolicyFile {
    if (cached) return cached;
    try {
        cached = JSON.parse(readFileSync(path, "utf8")) as PolicyFile;
    } catch {
        cached = {};
    }
    return cached;
}

export function policyFor(label: string, path = "policy.json"): SignPolicy {
    const found = policies(path)[label];
    if (!found) {
        throw new SignRefused(
            `${label} has no signing policy, add one to policy.json naming the chain, tokens, recipients and a cap`,
        );
    }
    return found;
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/* Payload building */

export type TransferRequest = { token: string; to: string; amount: string };
export type BuiltTransfer = { token: Address; to: Address; amount: bigint; data: Hex; chainId: number };

// Every field is checked against the policy before any key is touched
export function buildTransfer(request: TransferRequest, policy: SignPolicy): BuiltTransfer {
    if (!isAddress(request.token)) throw new SignRefused(`${request.token} is not an address`);
    if (!isAddress(request.to)) throw new SignRefused(`${request.to} is not an address`);

    const token = getAddress(request.token);
    const to = getAddress(request.to);

    if (!policy.tokens.some((allowed) => sameAddress(allowed, token))) {
        throw new SignRefused(`${token} is not a token this secret may move, allowed are ${policy.tokens.join(", ")}`);
    }
    if (!policy.recipients.some((allowed) => sameAddress(allowed, to))) {
        throw new SignRefused(`${to} is not an allowed recipient, allowed are ${policy.recipients.join(", ")}`);
    }

    let amount: bigint;
    try {
        amount = BigInt(request.amount);
    } catch {
        throw new SignRefused(`${request.amount} is not a whole number of base units`);
    }
    if (amount <= BigInt(0)) throw new SignRefused("amount must be positive");

    const cap = BigInt(policy.maxAmount);
    if (amount > cap) throw new SignRefused(`${amount} is over this secret's cap of ${cap} base units`);

    // Calldata is built here rather than accepted, so the model cannot smuggle approve or permit through
    const data = encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, amount] });
    return { token, to, amount, data, chainId: policy.chainId };
}

/* Check */

// node --experimental-strip-types src/sign.ts
if (process.argv[1]?.endsWith("sign.ts")) {
    const { strictEqual, throws, ok } = await import("node:assert");
    const policy: SignPolicy = {
        chainId: 11155111,
        tokens: ["0x768f42455a2d082e23ceef7d51e5787c82d67a39"],
        recipients: ["0x1d494e7FdB3a6b4161400B7143EA97a68314C040"],
        maxAmount: "1000000",
    };
    const good = { token: policy.tokens[0]!, to: policy.recipients[0]!, amount: "250000" };
    const refused = (request: TransferRequest, why: string) =>
        throws(() => buildTransfer(request, policy), SignRefused, why);

    const built = buildTransfer(good, policy);
    strictEqual(built.amount, BigInt(250000));
    ok(built.data.startsWith("0xa9059cbb"), "calldata is an erc20 transfer");
    // Checksummed on the way out, so a lowercase input cannot be compared against a mixed case policy
    strictEqual(built.to, getAddress(policy.recipients[0]!));

    refused({ ...good, to: "0x000000000000000000000000000000000000dEaD" }, "recipient off the list");
    refused({ ...good, token: "0x5472c5725a00b7ba11f0794a79d08ade6f4683bd" }, "token off the list");
    refused({ ...good, amount: "1000001" }, "over the cap");
    refused({ ...good, amount: "0" }, "zero");
    refused({ ...good, amount: "-1" }, "negative");
    refused({ ...good, amount: "1.5" }, "not base units");
    refused({ ...good, to: "not-an-address" }, "malformed recipient");

    // A lowercase policy entry still matches a checksummed request and the other way round
    ok(buildTransfer({ ...good, to: policy.recipients[0]!.toLowerCase() }, policy));

    throws(() => policyFor("nothing-configured", "does-not-exist.json"), SignRefused, "missing policy denies");

    console.log("sign.ts ok");
}
