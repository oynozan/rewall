import { namehash, keccak256, toBytes, parseAbi, type Address, type Hash } from "viem";
import { deriveIdentity, fingerprintOf, IDENTITY_TYPED_DATA, type Identity } from "./identity.ts";
import { toBase64, fromBase64, wipe } from "./crypto.ts";
import {
    RECORD,
    resolverAbi,
    encodeSetTextCalls,
    readTexts,
    resolverFor,
    splitNames,
    joinNames,
    SCHEMA_VERSION,
    ENCRYPTION,
    addToIndex,
    GUARDIAN_RECOVERY_PREFIX,
    guardianRecoveryEntry,
    removeFromIndex,
    dnsEncode,
    WRAP_PREFIX,
    type SecretRecords,
} from "./records.ts";
import {
    planSecret,
    planGrant,
    planRotate,
    openSecret,
    wrapFingerprints,
    SecretExistsError,
    type Grantee,
} from "./secret.ts";
import { deriveSubtreeKey, sealSubtreeKey, openSubtreeKey } from "./subtree.ts";
import { createGuardianSet, reshare, recoverWithShares } from "./guardians.ts";
import {
    authorizationPayload,
    authorizationSigner,
    isAuthorizedBy,
    UnauthorizedListError,
    type Authorization,
} from "./authorization.ts";

export type RewallOptions = {
    publicClient: any;
    walletClient: any;
    account: any;
    name: string;
    universalResolver: Address;
};

export type CreateOptions = {
    type?: string;
    grantees?: string[];
    subtreeGrantees?: string[];
    recovery: string[];
    allow?: string[];
    overwrite?: boolean;
};

const NAMESPACE_LABEL = "rewall";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const registryLookupAbi = parseAbi([
    "function findParentRegistry(bytes name) view returns (address)",
    "function getTokenId(uint256 anyId) view returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)",
]);

export class Rewall {
    readonly name: string;
    private readonly publicClient: any;
    private readonly walletClient: any;
    private readonly account: any;
    private readonly universalResolver: Address;
    private cachedIdentity: Identity | null = null;

    constructor(options: RewallOptions) {
        this.name = options.name;
        this.publicClient = options.publicClient;
        this.walletClient = options.walletClient;
        this.account = options.account;
        this.universalResolver = options.universalResolver;
    }

    /* Identity */

    // Cached for the life of the process only, never written to disk, and re-derived on the next run
    async identity(): Promise<Identity> {
        if (!this.cachedIdentity) {
            // Through the wallet client, so an injected wallet works the same as a local key
            const signature = await this.walletClient.signTypedData({
                account: this.account,
                ...IDENTITY_TYPED_DATA,
            });
            this.cachedIdentity = await deriveIdentity(signature);
        }
        return this.cachedIdentity;
    }

    async publishIdentity(): Promise<Hash | null> {
        const identity = await this.identity();
        const encoded = toBase64(identity.publicKey);

        const current = await this.read(this.name, [RECORD.pubkey]);
        if (current[RECORD.pubkey] === encoded) return null;

        return this.write(this.name, [{ key: RECORD.pubkey, value: encoded }]);
    }

    // Every key this caller can decrypt with, its own plus any subtree key sealed to its name
    async heldKeys(): Promise<Identity[]> {
        const identity = await this.identity();
        const held = await this.read(this.name, [RECORD.subtreeKey]);
        const sealed = held[RECORD.subtreeKey];
        if (!sealed) return [identity];

        try {
            return [identity, await openSubtreeKey(sealed, identity)];
        } catch {
            // A subtree key sealed to a previous identity is not an error, it just does not apply
            return [identity];
        }
    }

    /* Lookups */

    // A recovery entry is either a name that publishes its own key, or a guardian set on some owner's name
    async resolveRecovery(entry: string): Promise<Grantee> {
        if (!entry.startsWith(GUARDIAN_RECOVERY_PREFIX)) return this.publicKeyOf(entry);

        const ownerName = entry.slice(GUARDIAN_RECOVERY_PREFIX.length);
        const records = await this.read(ownerName, [RECORD.recoveryPubkey]);
        const encoded = records[RECORD.recoveryPubkey];
        if (!encoded) throw new Error(`${ownerName} has published no ${RECORD.recoveryPubkey}`);

        const publicKey = fromBase64(encoded);
        return { name: entry, publicKey, fingerprint: fingerprintOf(publicKey) };
    }

    async publicKeyOf(name: string): Promise<Grantee> {
        const records = await this.read(name, [RECORD.pubkey]);
        const encoded = records[RECORD.pubkey];
        if (!encoded) throw new Error(`${name} has published no ${RECORD.pubkey}`);

        const publicKey = fromBase64(encoded);
        return { name, publicKey, fingerprint: fingerprintOf(publicKey) };
    }

    async subtreeKeyOf(name: string): Promise<Grantee> {
        const records = await this.read(name, [RECORD.subtreePubkey]);
        const encoded = records[RECORD.subtreePubkey];
        if (!encoded) throw new Error(`${name} has published no ${RECORD.subtreePubkey}`);

        const publicKey = fromBase64(encoded);
        return { name, publicKey, subtree: true, fingerprint: fingerprintOf(publicKey) };
    }

    /* Secrets */

    async create(secretName: string, plaintext: Uint8Array, options: CreateOptions): Promise<Hash> {
        const owner = await this.selfAsGrantee();
        const recovery = await Promise.all(options.recovery.map((n) => this.resolveRecovery(n)));
        const grantees = [
            ...(await Promise.all((options.grantees ?? []).map((n) => this.publicKeyOf(n)))),
            ...(await Promise.all((options.subtreeGrantees ?? []).map((n) => this.subtreeKeyOf(n)))),
        ];

        const existing = await this.read(secretName, [RECORD.holders, RECORD.blob]);
        if (existing[RECORD.blob] && !options.overwrite) throw new SecretExistsError(secretName);

        const records = await planSecret({
            secretName,
            type: options.type ?? "generic",
            plaintext,
            owner,
            recovery,
            grantees,
            createdAt: Math.floor(Date.now() / 1000),
            allow: options.allow,
        });

        // A stale wrap from a previous secret here turns a clean denial into a decryption failure
        const kept = new Set(
            records.filter((r) => r.key.startsWith(WRAP_PREFIX)).map((r) => r.key.slice(WRAP_PREFIX.length)),
        );
        const cleared = splitNames(existing[RECORD.holders])
            .filter((fingerprint) => !kept.has(fingerprint))
            .map((fingerprint) => ({ key: RECORD.wrap(fingerprint), value: "" }));

        const named = (list: Grantee[]) => list.map((g) => g.name).filter((n): n is string => Boolean(n));
        const authorization = await this.signAuthorization({
            secretName,
            counter: 1,
            owner: this.name,
            grantees: named(grantees.filter((g) => !g.subtree)),
            subtrees: named(grantees.filter((g) => g.subtree)),
            recovery: named(recovery),
        });

        const hash = await this.write(secretName, [...records, ...cleared, ...authorization]);
        await this.indexAdd(secretName);
        return hash;
    }

    async get(secretName: string): Promise<Uint8Array> {
        const keys = await this.heldKeys();

        try {
            const wanted = [
                RECORD.blob,
                RECORD.version,
                RECORD.encryption,
                ...keys.map((k) => RECORD.wrap(k.fingerprint)),
            ];
            const records = await this.read(secretName, wanted);
            this.assertReadable(secretName, records);

            return await openSecret(records, keys, secretName);
        } finally {
            await this.disposeDerived(keys);
        }
    }

    // The identity is cached for the process, but a subtree key unsealed for one call should not outlive it
    private async disposeDerived(keys: Identity[]): Promise<void> {
        const own = await this.identity();
        const derived = keys.filter((k) => k !== own).map((k) => k.secretKey);
        if (derived.length) await wipe(...derived);
    }

    async grant(secretName: string, granteeName: string, options?: { subtree?: boolean }): Promise<Hash> {
        const current = await this.readForRotate(secretName);
        await this.assertAuthorized(secretName, current);
        const listKey = options?.subtree ? RECORD.subtrees : RECORD.grantees;

        // A bare re-grant would leave the old key's wrap live on an unchanged data key
        if (splitNames(current[listKey]).includes(granteeName)) {
            return this.rotateTo(secretName, current, {
                grantees: splitNames(current[RECORD.grantees]),
                subtrees: splitNames(current[RECORD.subtrees]),
            });
        }

        const grantee = options?.subtree ? await this.subtreeKeyOf(granteeName) : await this.publicKeyOf(granteeName);
        const keys = await this.heldKeys();
        const wrapped = await planGrant(current, keys, grantee);

        const nextList = splitNames(addToIndex(current[listKey], granteeName));
        const auth = this.authorizationOf(secretName, current);
        const signed = await this.signAuthorization({
            ...auth,
            counter: auth.counter + 1,
            grantees: options?.subtree ? auth.grantees : nextList,
            subtrees: options?.subtree ? nextList : auth.subtrees,
        });

        return this.write(secretName, [
            ...wrapped,
            { key: listKey, value: joinNames(nextList) },
            { key: RECORD.holders, value: addToIndex(current[RECORD.holders], grantee.fingerprint) },
            ...signed,
        ]);
    }

    // One name can hold an individual grant, a subtree grant and a recovery entry, each on a different key
    async revoke(
        secretName: string,
        granteeName: string,
        options?: { subtree?: boolean; recovery?: boolean },
    ): Promise<Hash> {
        if (options?.subtree && options?.recovery) throw new Error("revoke is subtree or recovery, never both");

        const current = await this.readForRotate(secretName);
        const lists = {
            grantees: splitNames(current[RECORD.grantees]),
            subtrees: splitNames(current[RECORD.subtrees]),
            recovery: splitNames(current[RECORD.recovery]),
        };

        const field = options?.recovery ? "recovery" : options?.subtree ? "subtrees" : "grantees";
        const after = lists[field].filter((n) => n !== granteeName);

        if (after.length === lists[field].length) {
            throw new Error(`${granteeName} is not in ${field} on ${secretName}`);
        }

        // planSecret refuses a secret only its owner can open, so say it here rather than deep inside a rotation
        if (field === "recovery" && after.length === 0) {
            throw new Error(`${granteeName} is the last recovery entry on ${secretName}, add another before revoking`);
        }

        // A recovery entry uses the same key as an individual grant, so dropping the grant leaves it reading
        if (field === "grantees" && lists.recovery.includes(granteeName)) {
            throw new Error(
                `${granteeName} is also a recovery entry on ${secretName} and would keep reading, revoke that first with { recovery: true }`,
            );
        }

        return this.rotateTo(secretName, current, { ...lists, [field]: after });
    }

    async rotate(secretName: string, plaintext?: Uint8Array): Promise<Hash> {
        const current = await this.readForRotate(secretName);
        return this.rotateTo(secretName, current, {
            grantees: splitNames(current[RECORD.grantees]),
            subtrees: splitNames(current[RECORD.subtrees]),
            plaintext,
        });
    }

    // Only the owner signature verifies, so this deliberately does not verify before writing
    async reauthorize(
        secretName: string,
        lists?: { grantees?: string[]; subtrees?: string[]; recovery?: string[] },
    ): Promise<Hash> {
        const current = await this.readForRotate(secretName);
        const auth = this.authorizationOf(secretName, current);

        const next: Authorization = {
            secretName,
            counter: auth.counter + 1,
            owner: current[RECORD.owner] || this.name,
            grantees: lists?.grantees ?? auth.grantees,
            subtrees: lists?.subtrees ?? auth.subtrees,
            recovery: lists?.recovery ?? auth.recovery,
        };

        return this.write(secretName, [
            { key: RECORD.grantees, value: joinNames(next.grantees) },
            { key: RECORD.subtrees, value: joinNames(next.subtrees) },
            { key: RECORD.recovery, value: joinNames(next.recovery) },
            ...(await this.signAuthorization(next)),
        ]);
    }

    async list(namespaceName?: string): Promise<string[]> {
        const target = namespaceName ?? `${NAMESPACE_LABEL}.${this.name}`;
        const records = await this.read(target, [RECORD.index]);
        return splitNames(records[RECORD.index]);
    }

    /* Subtree */

    readonly subtree = {
        init: async (): Promise<Hash> => {
            const version = await this.subtreeVersion();
            const key = await deriveSubtreeKey(await this.identity(), version);
            return this.write(this.name, [
                { key: RECORD.subtreePubkey, value: toBase64(key.publicKey) },
                { key: RECORD.subtreeVersion, value: String(version) },
            ]);
        },

        distribute: async (memberNames: string[]): Promise<Hash[]> => {
            const key = await deriveSubtreeKey(await this.identity(), await this.subtreeVersion());
            const hashes: Hash[] = [];

            for (const member of memberNames) {
                const { publicKey } = await this.publicKeyOf(member);
                hashes.push(
                    await this.write(member, [{ key: RECORD.subtreeKey, value: await sealSubtreeKey(key, publicKey) }]),
                );
            }
            return hashes;
        },

        // Bumping the version invalidates every distributed copy, which is how a member is removed
        rotate: async (): Promise<Hash> => {
            const next = (await this.subtreeVersion()) + 1;
            const key = await deriveSubtreeKey(await this.identity(), next);
            return this.write(this.name, [
                { key: RECORD.subtreePubkey, value: toBase64(key.publicKey) },
                { key: RECORD.subtreeVersion, value: String(next) },
            ]);
        },

        version: () => this.subtreeVersion(),
    };

    /* Guardians */

    readonly guardians = {
        // The recovery private key is destroyed inside createGuardianSet, only the shares survive
        init: async (guardianNames: string[], threshold: number): Promise<Grantee> => {
            const guardians = await Promise.all(guardianNames.map((n) => this.publicKeyOf(n)));
            const set = await createGuardianSet(guardians, threshold);

            await this.write(this.name, [
                { key: RECORD.recoveryPubkey, value: toBase64(set.recoveryPublicKey) },
                { key: RECORD.recoveryThreshold, value: String(set.threshold) },
                { key: RECORD.guardians, value: joinNames(guardianNames) },
                ...set.shares.map((s) => ({ key: RECORD.guardian(s.guardianFingerprint), value: s.sealed })),
            ]);

            return {
                name: guardianRecoveryEntry(this.name),
                publicKey: set.recoveryPublicKey,
                fingerprint: set.recoveryFingerprint,
            };
        },

        // What to pass as a recovery entry when creating a secret
        entry: (): string => guardianRecoveryEntry(this.name),

        of: async (ownerName?: string): Promise<{ names: string[]; threshold: number }> => {
            const target = ownerName ?? this.name;
            const records = await this.read(target, [RECORD.guardians, RECORD.recoveryThreshold]);
            return {
                names: splitNames(records[RECORD.guardians]),
                threshold: Number(records[RECORD.recoveryThreshold] || 0),
            };
        },

        // Run by a guardian, who re-seals their own share to whatever key the owner is moving to
        reshare: async (ownerName: string, newOwnerPublicKey: Uint8Array): Promise<string> => {
            const identity = await this.identity();
            const key = RECORD.guardian(identity.fingerprint);

            const records = await this.read(ownerName, [key]);
            const sealed = records[key];
            if (!sealed) throw new Error(`${ownerName} holds no share sealed to ${this.name}`);

            return reshare(sealed, identity, newOwnerPublicKey);
        },

        // Run by the new owner once enough guardians have re-shared
        recover: async (resealed: string[], ownerName?: string): Promise<Identity> => {
            const target = ownerName ?? this.name;
            const published = await this.read(target, [RECORD.recoveryPubkey, RECORD.recoveryThreshold]);
            const encoded = published[RECORD.recoveryPubkey];
            if (!encoded) throw new Error(`${target} has published no ${RECORD.recoveryPubkey}`);

            return recoverWithShares(resealed, await this.identity(), {
                publicKey: fromBase64(encoded),
                threshold: Number(published[RECORD.recoveryThreshold] || 0),
            });
        },
    };

    /* Internals */

    private async selfAsGrantee(): Promise<Grantee> {
        const identity = await this.identity();
        return { name: this.name, publicKey: identity.publicKey, fingerprint: identity.fingerprint };
    }

    private async subtreeVersion(): Promise<number> {
        const records = await this.read(this.name, [RECORD.subtreeVersion]);
        const raw = records[RECORD.subtreeVersion];
        return raw ? Number(raw) : 0;
    }

    // A client that cannot parse a blob refuses it rather than misreading it or overwriting it
    private assertReadable(secretName: string, records: Record<string, string>): void {
        const version = records[RECORD.version];
        if (version && version !== SCHEMA_VERSION) {
            throw new Error(`${secretName} uses schema version ${version}, expected ${SCHEMA_VERSION}`);
        }

        const encryption = records[RECORD.encryption];
        if (encryption && encryption !== ENCRYPTION) {
            throw new Error(`${secretName} is encrypted with ${encryption}, expected ${ENCRYPTION}`);
        }
    }

    private async readForRotate(secretName: string): Promise<Record<string, string>> {
        const keys = await this.heldKeys();
        return this.read(secretName, [
            RECORD.blob,
            RECORD.version,
            RECORD.encryption,
            RECORD.type,
            RECORD.allow,
            RECORD.owner,
            RECORD.grantees,
            RECORD.subtrees,
            RECORD.recovery,
            RECORD.holders,
            RECORD.authCounter,
            RECORD.authSig,
            ...keys.map((k) => RECORD.wrap(k.fingerprint)),
        ]);
    }

    private async rotateTo(
        secretName: string,
        current: Record<string, string>,
        next: { grantees: string[]; subtrees: string[]; recovery?: string[]; plaintext?: Uint8Array },
    ): Promise<Hash> {
        // Refuses a list the owner never signed, which is what stops a write delegate steering a rotation
        await this.assertAuthorized(secretName, current);

        // The same gate get() applies, or an older client silently overwrites a newer record set
        this.assertReadable(secretName, current);

        const keys = await this.heldKeys();
        const plaintext = next.plaintext ?? (await openSecret(current, keys, secretName));

        // The recorded owner, not whoever is calling, or a rotation by a delegate would drop the owner
        const ownerName = current[RECORD.owner] || this.name;
        const owner = ownerName === this.name ? await this.selfAsGrantee() : await this.publicKeyOf(ownerName);

        // Strict. A name that no longer resolves must stop the rotation, not vanish from the keep set
        const recoveryNames = next.recovery ?? splitNames(current[RECORD.recovery]);
        const recovery = await Promise.all(recoveryNames.map((n) => this.resolveRecovery(n)));
        const grantees = [
            ...(await Promise.all(next.grantees.map((n) => this.publicKeyOf(n)))),
            ...(await Promise.all(next.subtrees.map((n) => this.subtreeKeyOf(n)))),
        ];

        // A name whose key changed resolves to a new fingerprint, so re-deriving leaves the old wrap live
        const previous = [...splitNames(current[RECORD.holders]), ...wrapFingerprints(current)];

        const { records } = await planRotate({
            secretName,
            type: current[RECORD.type] || "generic",
            plaintext,
            owner,
            recovery,
            grantees,
            previousFingerprints: previous,
            createdAt: Math.floor(Date.now() / 1000),
            allow: splitNames(current[RECORD.allow]),
        });

        const auth = this.authorizationOf(secretName, current);
        const signed = await this.signAuthorization({
            secretName,
            counter: auth.counter + 1,
            owner: ownerName,
            grantees: next.grantees,
            subtrees: next.subtrees,
            recovery: recoveryNames,
        });

        return this.write(secretName, [...records, ...signed]);
    }

    private async indexAdd(secretName: string): Promise<void> {
        const parent = secretName.split(".").slice(1).join(".");
        const label = secretName.split(".")[0]!;
        const current = await this.read(parent, [RECORD.index]);
        const updated = addToIndex(current[RECORD.index], label);
        if (updated !== current[RECORD.index]) await this.write(parent, [{ key: RECORD.index, value: updated }]);
    }

    async unindex(secretName: string): Promise<Hash | null> {
        const parent = secretName.split(".").slice(1).join(".");
        const label = secretName.split(".")[0]!;
        const current = await this.read(parent, [RECORD.index]);
        const updated = removeFromIndex(current[RECORD.index], label);
        if (updated === current[RECORD.index]) return null;
        return this.write(parent, [{ key: RECORD.index, value: updated }]);
    }

    /* Authorization, so a rotation cannot be steered by whoever can write the records */

    // A write delegate can rewrite every record on a secret but not who owns it
    private async ownerAddressOf(secretName: string): Promise<Address> {
        const registry = await this.publicClient.readContract({
            address: this.universalResolver,
            abi: registryLookupAbi,
            functionName: "findParentRegistry",
            args: [dnsEncode(secretName)],
        });
        if (!registry || registry === ZERO_ADDRESS) throw new Error(`no registry holds ${secretName}`);

        const label = secretName.split(".")[0]!;
        const tokenId = await this.publicClient.readContract({
            address: registry,
            abi: registryLookupAbi,
            functionName: "getTokenId",
            args: [BigInt(keccak256(toBytes(label)))],
        });
        return this.publicClient.readContract({
            address: registry,
            abi: registryLookupAbi,
            functionName: "ownerOf",
            args: [tokenId],
        }) as Promise<Address>;
    }

    private authorizationOf(secretName: string, records: Record<string, string>): Authorization {
        return {
            secretName,
            counter: Number(records[RECORD.authCounter] || 0),
            owner: records[RECORD.owner] || "",
            grantees: splitNames(records[RECORD.grantees]),
            subtrees: splitNames(records[RECORD.subtrees]),
            recovery: splitNames(records[RECORD.recovery]),
        };
    }

    private async assertAuthorized(secretName: string, records: Record<string, string>): Promise<void> {
        const signature = records[RECORD.authSig];
        if (!signature) {
            throw new Error(`${secretName} carries no ${RECORD.authSig}, refusing to act on an unsigned grantee list`);
        }

        const auth = this.authorizationOf(secretName, records);
        const owner = await this.ownerAddressOf(secretName);

        if (!(await isAuthorizedBy(auth, signature, owner))) {
            throw new UnauthorizedListError(secretName, await authorizationSigner(auth, signature), owner);
        }
    }

    private async signAuthorization(auth: Authorization): Promise<SecretRecords> {
        const signature = await this.walletClient.signMessage({
            account: this.account,
            message: authorizationPayload(auth),
        });
        return [
            { key: RECORD.authCounter, value: String(auth.counter) },
            { key: RECORD.authSig, value: signature },
        ];
    }

    private read(name: string, keys: string[]): Promise<Record<string, string>> {
        return readTexts(this.publicClient, this.universalResolver, name, keys);
    }

    private async write(name: string, records: SecretRecords): Promise<Hash> {
        // Resolved every write, never cached, because the owner can repoint the name at any moment
        const resolver = await resolverFor(this.publicClient, this.universalResolver, name);
        if (!resolver) throw new Error(`no resolver configured for ${name}`);

        const hash = await this.walletClient.writeContract({
            address: resolver,
            abi: resolverAbi,
            functionName: "multicall",
            args: [encodeSetTextCalls(namehash(name), records)],
            account: this.account,
            chain: this.walletClient.chain,
        });

        const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`write reverted on ${name}, ${hash}`);
        return hash;
    }
}
