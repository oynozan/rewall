import "server-only";
import { encodeFunctionData, keccak256, namehash, parseAbi, toBytes, toHex, type Address } from "viem";
import { sepolia } from "viem/chains";
import { RECORD } from "@rewall/sdk";
import { updateAccount, type Account, type Provisioned } from "./mongo";
import {
    ALL_ROLES,
    ROOT_RESOURCE,
    ETH_REGISTRAR,
    ETH_REGISTRY,
    MOCK_USDC,
    publicClient,
    RESOLVER_IMPL,
    send,
    serialized,
    sponsor,
    USER_REGISTRY_IMPL,
    VERIFIABLE_FACTORY,
    ZERO_ADDRESS,
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

export const labelOk = (label: string) =>
    /^[a-z0-9-]{5,63}$/.test(label) && !label.startsWith("-") && !label.endsWith("-");

/* Proxies */

// One salt is one proxy forever, so it is derived per user and per purpose and never reused
const saltFor = (user: string, purpose: string) =>
    BigInt(keccak256(toBytes(`rewall.${purpose}.${user.toLowerCase()}`)));

async function deployProxy(impl: Address, salt: bigint, initData: `0x${string}`): Promise<Address> {
    const { account } = sponsor();
    const { request, result } = await publicClient.simulateContract({
        address: VERIFIABLE_FACTORY,
        abi: factoryAbi,
        functionName: "deployProxy",
        args: [impl, salt, initData],
        account,
    });
    await serialized(() => send({ ...request, chain: sepolia }));
    return result as Address;
}

/* Phase one, everything that can happen before the commitment matures */

export async function startProvision(input: {
    address: Address;
    label: string;
    publicKey: string;
    recoveryPublicKey: string;
    existing?: Provisioned;
}): Promise<Provisioned> {
    const { address, label, publicKey, recoveryPublicKey } = input;
    const state: Provisioned = { ...input.existing };

    const available = await publicClient.readContract({
        address: ETH_REGISTRAR,
        abi: registrarAbi,
        functionName: "isAvailable",
        args: [label],
    });
    if (!available && !state.committedAt) throw new Error(`${label}.eth is already taken.`);

    // Written during initialize, where role checks are skipped, so the user never sends a setText of their own
    if (!state.resolver) {
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
        state.resolver = await deployProxy(RESOLVER_IMPL, saltFor(address, "resolver.v1"), initData);
    }

    // The project holds this one only long enough to register the rewall label, then hands it over
    if (!state.registry) {
        const { account } = sponsor();
        const initData = encodeFunctionData({
            abi: registryAbi,
            functionName: "initialize",
            args: [account.address, ALL_ROLES],
        });
        state.registry = await deployProxy(USER_REGISTRY_IMPL, saltFor(address, "registry.v1"), initData);
    }

    if (!state.namespaceRegistry) {
        const initData = encodeFunctionData({
            abi: registryAbi,
            functionName: "initialize",
            args: [address, ALL_ROLES],
        });
        state.namespaceRegistry = await deployProxy(USER_REGISTRY_IMPL, saltFor(address, "namespace.v1"), initData);
    }

    if (state.committedAt) return state;

    const { account } = sponsor();
    const [base, premium] = await publicClient.readContract({
        address: ETH_REGISTRAR,
        abi: registrarAbi,
        functionName: "getRegisterPrice",
        args: [label, DURATION, MOCK_USDC],
    });
    const price = base + premium;

    const balance = await publicClient.readContract({
        address: MOCK_USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
    });
    if (balance < price) {
        await serialized(() =>
            send({
                address: MOCK_USDC,
                abi: erc20Abi,
                functionName: "mint",
                args: [account.address, price - balance],
                account,
                chain: sepolia,
            }),
        );
    }

    // Allowance from a fresh address is zero and register does safeTransferFrom, so this is not optional
    const allowance = await publicClient.readContract({
        address: MOCK_USDC,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, ETH_REGISTRAR],
    });
    if (allowance < price) {
        await serialized(() =>
            send({
                address: MOCK_USDC,
                abi: erc20Abi,
                functionName: "approve",
                args: [ETH_REGISTRAR, price],
                account,
                chain: sepolia,
            }),
        );
    }

    // The resolver and registry go into the commitment so registration wires them in one call
    const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const commitment = await publicClient.readContract({
        address: ETH_REGISTRAR,
        abi: registrarAbi,
        functionName: "makeCommitment",
        args: [label, address, secret, state.registry as Address, state.resolver as Address, DURATION, ZERO_BYTES32],
    });
    await serialized(() =>
        send({
            address: ETH_REGISTRAR,
            abi: registrarAbi,
            functionName: "commit",
            args: [commitment],
            account,
            chain: sepolia,
        }),
    );

    state.commitSecret = secret;
    state.committedAt = Math.floor(Date.now() / 1000);
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

    if (!state.registeredAt) {
        // Every field has to match the commitment or this reverts without saying which one differed
        await serialized(() =>
            send({
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
            }),
        );
        state.registeredAt = Math.floor(Date.now() / 1000);
    }

    const namespace = await publicClient.readContract({
        address: state.registry as Address,
        abi: registryAbi,
        functionName: "getSubregistry",
        args: [NAMESPACE_LABEL],
    });
    if (namespace === ZERO_ADDRESS) {
        const expiry = await publicClient.readContract({
            address: ETH_REGISTRY,
            abi: registryAbi,
            functionName: "getExpiry",
            args: [BigInt(keccak256(toBytes(label)))],
        });
        await serialized(() =>
            send({
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
            }),
        );
    }

    // Handing over is the whole point, so it is re-checked on every resume rather than assumed done
    const userHolds = await publicClient.readContract({
        address: state.registry as Address,
        abi: registryAbi,
        functionName: "hasRoles",
        args: [ROOT_RESOURCE, ALL_ROLES, address],
    });
    if (!userHolds) {
        await serialized(() =>
            send({
                address: state.registry as Address,
                abi: registryAbi,
                functionName: "grantRootRoles",
                args: [ALL_ROLES, address],
                account,
                chain: sepolia,
            }),
        );
    }

    const projectHolds = await publicClient.readContract({
        address: state.registry as Address,
        abi: registryAbi,
        functionName: "hasRoles",
        args: [ROOT_RESOURCE, ALL_ROLES, account.address],
    });
    if (projectHolds) {
        await serialized(() =>
            send({
                address: state.registry as Address,
                abi: registryAbi,
                functionName: "revokeRootRoles",
                args: [ALL_ROLES, account.address],
                account,
                chain: sepolia,
            }),
        );
    }

    state.handedOverAt = Math.floor(Date.now() / 1000);
    return state;
}

export async function saveProvision(address: string, state: Provisioned, extra: Partial<Account> = {}): Promise<void> {
    await updateAccount(address, { provisioned: state, ...extra });
}
