import "server-only";
import { encodeFunctionData, keccak256, namehash, parseAbi, toBytes, toHex, type Address } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import { fromBase64, RECORD } from "@rewall/sdk";
import { updateAccount, type Account, type Provisioned } from "./mongo";
import {
    ALL_ROLES,
    ROOT_RESOURCE,
    ETH_REGISTRAR,
    ETH_REGISTRY,
    MOCK_USDC,
    publicClient,
    RESOLVER_IMPL,
    sendAll,
    sponsor,
    USER_REGISTRY_IMPL,
    VERIFIABLE_FACTORY,
    ZERO_ADDRESS,
    type WriteRequest,
} from "./server-chain";

const NAMESPACE_LABEL = "rewall";
const DURATION = BigInt(31536000);
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as const;

// Admin variant of a role is the role shifted by 128, so granting both makes the holder able to delegate it
const ADMIN_SHIFT = BigInt(128);
const ROLE_SET_SUBREGISTRY = BigInt(1) << BigInt(20);
const ROLE_SET_RESOLVER = BigInt(1) << BigInt(24);
const NAME_ROLES =
    ROLE_SET_SUBREGISTRY |
    (ROLE_SET_SUBREGISTRY << ADMIN_SHIFT) |
    ROLE_SET_RESOLVER |
    (ROLE_SET_RESOLVER << ADMIN_SHIFT);

const factoryAbi = parseAbi([
    "function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)",
]);
const resolverAbi = parseAbi([
    "function initialize(address admin, uint256 roleBitmap, bytes[] setters)",
    "function setText(bytes32 node, string key, string value)",
]);
const registryAbi = parseAbi([
    "function initialize(address rootAccount, uint256 roleBitmap)",
    "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
    "function getSubregistry(string label) view returns (address)",
    "function getExpiry(uint256 anyId) view returns (uint64)",
    "function grantRootRoles(uint256 roleBitmap, address account) returns (bool)",
    "function revokeRootRoles(uint256 roleBitmap, address account) returns (bool)",
    "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
]);
const registrarAbi = parseAbi([
    "function isAvailable(string label) view returns (bool)",
    "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
    "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
    "function commit(bytes32 commitment)",
    "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256 tokenId)",
    "function MIN_COMMITMENT_AGE() view returns (uint256)",
]);
const erc20Abi = parseAbi([
    "function mint(address to, uint256 amount)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address account) view returns (uint256)",
]);

// ENSIP-15 has to agree too, or the sponsor registers a name the dashboard's own normalize refuses to open
export const labelOk = (label: string) => {
    if (!/^[a-z0-9-]{5,63}$/.test(label) || label.startsWith("-") || label.endsWith("-")) return false;
    try {
        return normalize(`${label}.eth`) === `${label}.eth`;
    } catch {
        return false;
    }
};

// A published key is 32 bytes, and the sponsor pays for whatever is written, so the shape is checked first
export const publicKeyOk = (encoded: string) => {
    try {
        return fromBase64(encoded).length === 32;
    } catch {
        return false;
    }
};

const textAbi = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);

// Read back rather than assumed, since a retried start keeps the key the first phrase wrote at deploy
export async function publishedRecoveryKey(resolver: Address, label: string): Promise<string> {
    return publicClient.readContract({
        address: resolver,
        abi: textAbi,
        functionName: "text",
        args: [namehash(`${label}.eth`), RECORD.recoveryPubkey],
    }) as Promise<string>;
}

/* Proxies */

// One salt is one proxy forever, so it is derived per user and per purpose and never reused
const saltFor = (user: string, purpose: string) =>
    BigInt(keccak256(toBytes(`rewall.${purpose}.${user.toLowerCase()}`)));

// One salt is one proxy forever, so a planned address is saved but never trusted until it holds code
async function deployed(address?: string): Promise<boolean> {
    if (!address) return false;
    const code = await publicClient.getCode({ address: address as Address });
    return Boolean(code) && code !== "0x";
}

// The factory names a proxy before it exists, so the commitment can go out ahead of the deploy
async function planProxy(
    impl: Address,
    salt: bigint,
    initData: `0x${string}`,
): Promise<{ address: Address; request: WriteRequest }> {
    const { account } = sponsor();
    const { request, result } = await publicClient.simulateContract({
        address: VERIFIABLE_FACTORY,
        abi: factoryAbi,
        functionName: "deployProxy",
        args: [impl, salt, initData],
        account,
    });
    return { address: result as Address, request: { ...request, chain: sepolia } as WriteRequest };
}

/* Phase one, everything that can happen before the commitment matures */

export async function startProvision(input: {
    address: Address;
    label: string;
    publicKey: string;
    recoveryPublicKey: string;
    existing?: Provisioned;
}): Promise<Provisioned> {
    const state: Provisioned = { ...input.existing };
    try {
        return await beginSetup(input, state);
    } catch (failure) {
        // Carried out with the error, so a run that dies half way is resumed rather than started over
        throw Object.assign(failure as Error, { provisioned: state });
    }
}

async function beginSetup(
    input: { address: Address; label: string; publicKey: string; recoveryPublicKey: string },
    state: Provisioned,
): Promise<Provisioned> {
    const { address, label, publicKey, recoveryPublicKey } = input;

    const available = await publicClient.readContract({
        address: ETH_REGISTRAR,
        abi: registrarAbi,
        functionName: "isAvailable",
        args: [label],
    });
    if (!available && !state.committedAt) throw new Error(`${label}.eth is already taken.`);

    const { account } = sponsor();
    const deploys: WriteRequest[] = [];
    // Checked against the chain rather than the ledger, since a failed run can leave either one ahead
    const [hasResolver, hasRegistry, hasNamespace] = await Promise.all([
        deployed(state.resolver),
        deployed(state.registry),
        deployed(state.namespaceRegistry),
    ]);

    // Written during initialize, where role checks are skipped, so the user never sends a setText of their own
    if (!hasResolver) {
        const node = namehash(`${label}.eth`);
        const setters = [
            encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [node, RECORD.pubkey, publicKey] }),
            encodeFunctionData({
                abi: resolverAbi,
                functionName: "setText",
                args: [node, RECORD.recoveryPubkey, recoveryPublicKey],
            }),
        ];
        const initData = encodeFunctionData({
            abi: resolverAbi,
            functionName: "initialize",
            args: [address, ALL_ROLES, setters],
        });
        const planned = await planProxy(RESOLVER_IMPL, saltFor(address, "resolver.v1"), initData);
        state.resolver = planned.address;
        deploys.push(planned.request);
    }

    // The project holds this one only long enough to register the rewall label, then hands it over
    if (!hasRegistry) {
        const initData = encodeFunctionData({
            abi: registryAbi,
            functionName: "initialize",
            args: [account.address, ALL_ROLES],
        });
        const planned = await planProxy(USER_REGISTRY_IMPL, saltFor(address, "registry.v1"), initData);
        state.registry = planned.address;
        deploys.push(planned.request);
    }

    if (!hasNamespace) {
        const initData = encodeFunctionData({
            abi: registryAbi,
            functionName: "initialize",
            args: [address, ALL_ROLES],
        });
        const planned = await planProxy(USER_REGISTRY_IMPL, saltFor(address, "namespace.v1"), initData);
        state.namespaceRegistry = planned.address;
        deploys.push(planned.request);
    }

    // A resumed setup already holds its commitment, so only the deploys it never landed are left
    if (state.committedAt) {
        await sendAll(deploys);
        return state;
    }

    // Read together, because none of the three answers depends on another
    const [price, balance, allowance] = await Promise.all([
        publicClient
            .readContract({
                address: ETH_REGISTRAR,
                abi: registrarAbi,
                functionName: "getRegisterPrice",
                args: [label, DURATION, MOCK_USDC],
            })
            .then(([base, premium]) => base + premium),
        publicClient.readContract({
            address: MOCK_USDC,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [account.address],
        }),
        publicClient.readContract({
            address: MOCK_USDC,
            abi: erc20Abi,
            functionName: "allowance",
            args: [account.address, ETH_REGISTRAR],
        }),
    ]);

    const funding: WriteRequest[] = [];
    if (balance < price) {
        funding.push({
            address: MOCK_USDC,
            abi: erc20Abi,
            functionName: "mint",
            args: [account.address, price - balance],
            account,
            chain: sepolia,
        } as WriteRequest);
    }

    // Allowance from a fresh address is zero and register does safeTransferFrom, so this is not optional
    if (allowance < price) {
        funding.push({
            address: MOCK_USDC,
            abi: erc20Abi,
            functionName: "approve",
            args: [ETH_REGISTRAR, price],
            account,
            chain: sepolia,
        } as WriteRequest);
    }

    // The resolver and registry go into the commitment so registration wires them in one call
    const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const commitment = await publicClient.readContract({
        address: ETH_REGISTRAR,
        abi: registrarAbi,
        functionName: "makeCommitment",
        args: [label, address, secret, state.registry as Address, state.resolver as Address, DURATION, ZERO_BYTES32],
    });

    // The commitment takes the lowest nonce, so its clock starts while the proxies behind it are still landing
    const receipts = await sendAll([
        {
            address: ETH_REGISTRAR,
            abi: registrarAbi,
            functionName: "commit",
            args: [commitment],
            account,
            chain: sepolia,
        } as WriteRequest,
        ...funding,
        ...deploys,
    ]);

    state.commitSecret = secret;
    // The registrar measures maturity against the block, so the block is what the wait has to be counted from
    const block = await publicClient.getBlock({ blockNumber: receipts[0]!.blockNumber });
    state.committedAt = Number(block.timestamp);
    return state;
}

/* Phase two, after MIN_COMMITMENT_AGE has passed on the wall clock */

export async function finishProvision(input: {
    address: Address;
    label: string;
    state: Provisioned;
}): Promise<Provisioned> {
    const { address, label } = input;
    const state: Provisioned = { ...input.state };
    const { account } = sponsor();

    if (!state.resolver || !state.registry || !state.namespaceRegistry || !state.commitSecret || !state.committedAt) {
        throw new Error("This setup was never started.");
    }

    const minAge = await publicClient.readContract({
        address: ETH_REGISTRAR,
        abi: registrarAbi,
        functionName: "MIN_COMMITMENT_AGE",
    });
    const ready = state.committedAt + Number(minAge);
    const now = Math.floor(Date.now() / 1000);
    if (now < ready) throw Object.assign(new Error("The commitment is still maturing."), { retryAfter: ready - now });

    // Read together, and handing over is re-checked on every resume rather than assumed done
    const [namespace, userHolds, projectHolds] = await Promise.all([
        publicClient.readContract({
            address: state.registry as Address,
            abi: registryAbi,
            functionName: "getSubregistry",
            args: [NAMESPACE_LABEL],
        }),
        publicClient.readContract({
            address: state.registry as Address,
            abi: registryAbi,
            functionName: "hasRoles",
            args: [ROOT_RESOURCE, ALL_ROLES, address],
        }),
        publicClient.readContract({
            address: state.registry as Address,
            abi: registryAbi,
            functionName: "hasRoles",
            args: [ROOT_RESOURCE, ALL_ROLES, account.address],
        }),
    ]);

    // The name and the handover touch different contracts, so they ride one wave
    const first: WriteRequest[] = [];
    if (!state.registeredAt) {
        // Every field has to match the commitment or this reverts without saying which one differed
        first.push({
            address: ETH_REGISTRAR,
            abi: registrarAbi,
            functionName: "register",
            args: [
                label,
                address,
                state.commitSecret as `0x${string}`,
                state.registry as Address,
                state.resolver as Address,
                DURATION,
                MOCK_USDC,
                ZERO_BYTES32,
            ],
            account,
            chain: sepolia,
        } as WriteRequest);
    }
    if (!userHolds) {
        first.push({
            address: state.registry as Address,
            abi: registryAbi,
            functionName: "grantRootRoles",
            args: [ALL_ROLES, address],
            account,
            chain: sepolia,
        } as WriteRequest);
    }
    await sendAll(first);
    if (!state.registeredAt) state.registeredAt = Math.floor(Date.now() / 1000);

    // The expiry is only readable once the name exists, so this one waits for the wave above
    if (namespace === ZERO_ADDRESS) {
        const expiry = await publicClient.readContract({
            address: ETH_REGISTRY,
            abi: registryAbi,
            functionName: "getExpiry",
            args: [BigInt(keccak256(toBytes(label)))],
        });
        await sendAll([
            {
                address: state.registry as Address,
                abi: registryAbi,
                functionName: "register",
                args: [
                    NAMESPACE_LABEL,
                    address,
                    state.namespaceRegistry as Address,
                    state.resolver as Address,
                    NAME_ROLES,
                    expiry,
                ],
                account,
                chain: sepolia,
            } as WriteRequest,
        ]);
    }

    // Last of all, because registering the label above needs the root the project is giving up here
    if (projectHolds) {
        await sendAll([
            {
                address: state.registry as Address,
                abi: registryAbi,
                functionName: "revokeRootRoles",
                args: [ALL_ROLES, account.address],
                account,
                chain: sepolia,
            } as WriteRequest,
        ]);
    }

    state.handedOverAt = Math.floor(Date.now() / 1000);
    return state;
}

export async function saveProvision(address: string, state: Provisioned, extra: Partial<Account> = {}): Promise<void> {
    await updateAccount(address, { provisioned: state, ...extra });
}
