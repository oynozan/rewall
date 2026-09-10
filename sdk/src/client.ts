import { namehash, type Address, type Hash } from "viem";
import { deriveIdentity, fingerprintOf, IDENTITY_MESSAGE, type Identity } from "./identity.ts";
import { toBase64, fromBase64, wipe } from "./crypto.ts";
import {
    RECORD,
    resolverAbi,
    encodeSetTextCalls,
    readTexts,
    resolverFor,
    splitNames,
    joinNames,
    addToIndex,
    GUARDIAN_RECOVERY_PREFIX,
    guardianRecoveryEntry,
    removeFromIndex,
    type SecretRecords,
} from "./records.ts";
import { planSecret, planGrant, planRotate, openSecret, wrapFingerprints, type Grantee } from "./secret.ts";
import { deriveSubtreeKey, sealSubtreeKey, openSubtreeKey } from "./subtree.ts";
import { createGuardianSet, reshare, recoverWithShares } from "./guardians.ts";

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
};

const NAMESPACE_LABEL = "rewall";

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
            const signature = await this.account.signMessage({ message: IDENTITY_MESSAGE });
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

        const records = await planSecret({
            type: options.type ?? "generic",
            plaintext,
            owner,
            recovery,
            grantees,
            createdAt: Math.floor(Date.now() / 1000),
            allow: options.allow,
        });

        const hash = await this.write(secretName, records);
        await this.indexAdd(secretName);
        return hash;
    }

    async get(secretName: string): Promise<Uint8Array> {
        const keys = await this.heldKeys();

        try {
            const wanted = [RECORD.blob, RECORD.version, ...keys.map((k) => RECORD.wrap(k.fingerprint))];
            const records = await this.read(secretName, wanted);

            const version = records[RECORD.version];
            if (version && version !== "1") throw new Error(`${secretName} uses schema version ${version}, expected 1`);

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
        const grantee = options?.subtree ? await this.subtreeKeyOf(granteeName) : await this.publicKeyOf(granteeName);
        const current = await this.readForRotate(secretName);

        // A grant only adds a wrap, so the ciphertext and everyone else's wraps are untouched
        const listKey = grantee.subtree ? RECORD.subtrees : RECORD.grantees;
        const updated = addToIndex(current[listKey], granteeName);

        const keys = await this.heldKeys();
        const wrapped = await planGrant(current, keys, grantee);

        return this.write(secretName, [...wrapped, { key: listKey, value: updated }]);
    }

    // The subtree flag matters because one name can hold both an individual grant and a subtree grant,
    // and revoking the person should not silently revoke everyone under them
    async revoke(secretName: string, granteeName: string, options?: { subtree?: boolean }): Promise<Hash> {
        const current = await this.readForRotate(secretName);

        const listKey = options?.subtree ? RECORD.subtrees : RECORD.grantees;
        const before = splitNames(current[listKey]);
        const after = before.filter((n) => n !== granteeName);

        if (before.length === after.length) {
            const kind = options?.subtree ? "subtree grantee" : "grantee";
            throw new Error(`${granteeName} is not a ${kind} of ${secretName}`);
        }

        return this.rotateTo(secretName, current, {
            grantees: options?.subtree ? splitNames(current[RECORD.grantees]) : after,
            subtrees: options?.subtree ? after : splitNames(current[RECORD.subtrees]),
        });
    }

    async rotate(secretName: string, plaintext?: Uint8Array): Promise<Hash> {
        const current = await this.readForRotate(secretName);
        return this.rotateTo(secretName, current, {
            grantees: splitNames(current[RECORD.grantees]),
            subtrees: splitNames(current[RECORD.subtrees]),
            plaintext,
        });
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
        recover: async (resealed: string[]): Promise<Identity> => recoverWithShares(resealed, await this.identity()),
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

    private async readForRotate(secretName: string): Promise<Record<string, string>> {
        const keys = await this.heldKeys();
        return this.read(secretName, [
            RECORD.blob,
            RECORD.version,
            RECORD.type,
            RECORD.allow,
            RECORD.grantees,
            RECORD.subtrees,
            RECORD.recovery,
            ...keys.map((k) => RECORD.wrap(k.fingerprint)),
        ]);
    }

    private async rotateTo(
        secretName: string,
        current: Record<string, string>,
        next: { grantees: string[]; subtrees: string[]; plaintext?: Uint8Array },
    ): Promise<Hash> {
        const keys = await this.heldKeys();
        const plaintext = next.plaintext ?? (await openSecret(current, keys, secretName));

        const owner = await this.selfAsGrantee();
        const recovery = await Promise.all(splitNames(current[RECORD.recovery]).map((n) => this.resolveRecovery(n)));
        const grantees = [
            ...(await Promise.all(next.grantees.map((n) => this.publicKeyOf(n)))),
            ...(await Promise.all(next.subtrees.map((n) => this.subtreeKeyOf(n)))),
        ];

        // Resolved from the recorded name lists, not from the records in hand, because a caller only ever
        // reads the wraps for keys it holds and so cannot see whose wrap needs clearing
        const previous = await this.fingerprintsOf(
            splitNames(current[RECORD.grantees]),
            splitNames(current[RECORD.subtrees]),
            splitNames(current[RECORD.recovery]),
        );

        const { records } = await planRotate({
            type: current[RECORD.type] ?? "generic",
            plaintext,
            owner,
            recovery,
            grantees,
            previousFingerprints: [owner.fingerprint, ...previous, ...wrapFingerprints(current)],
            createdAt: Math.floor(Date.now() / 1000),
            allow: splitNames(current[RECORD.allow]),
        });

        return this.write(secretName, records);
    }

    // A name whose key has since changed resolves to its current fingerprint, so a stale wrap can survive
    // a rotation. Harmless, because the data key it holds is already dead, but it does leave a dead record.
    private async fingerprintsOf(grantees: string[], subtrees: string[], recovery: string[]): Promise<string[]> {
        const settled = await Promise.allSettled([
            ...grantees.map((n) => this.publicKeyOf(n)),
            ...recovery.map((n) => this.resolveRecovery(n)),
            ...subtrees.map((n) => this.subtreeKeyOf(n)),
        ]);
        return settled.filter((r) => r.status === "fulfilled").map((r) => r.value.fingerprint);
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
