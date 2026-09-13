import { isAddress, keccak256, namehash, parseAbi, toBytes, type Address, type Hash, type Hex } from "viem";
import { deriveIdentity, fingerprintOf, IDENTITY_TYPED_DATA, type Identity } from "./identity.ts";
import { toBase64, fromBase64, wipe } from "./crypto.ts";
import { normalizeSite } from "./site.ts";
import {
    RECORD,
    ROTATE_KEYS,
    resolverAbi,
    encodeSetTextCalls,
    readTexts,
    resolverFor,
    splitNames,
    joinNames,
    SCHEMA_VERSION,
    ENCRYPTION,
    ownerAddressOf,
    registryLookupAbi,
    addToIndex,
    GUARDIAN_RECOVERY_PREFIX,
    guardianRecoveryEntry,
    clearSecretRecords,
    removeFromIndex,
    dnsEncode,
    WRAP_PREFIX,
    joinApprovals,
    splitApprovals,
    type Approval,
    type ApprovalRole,
    type SecretRecords,
} from "./records.ts";
import {
    planSecret,
    planGrant,
    planRotate,
    openSecret,
    wrapFingerprints,
    SecretExistsError,
    SecretMissingError,
    type Grantee,
} from "./secret.ts";
import { deriveSubtreeKey, sealSubtreeKey, openSubtreeKey } from "./subtree.ts";
import { createGuardianSet, reshare, recoverWithShares } from "./guardians.ts";
import {
    assertApproved,
    assertCanonical,
    authorizationPayload,
    KeyChangedError,
    authorizationSigner,
    isAuthorizedBy,
    isLegacyAuthorizedBy,
    LegacyAuthorizationError,
    unacceptedChanges,
    UnauthorizedListError,
    type Authorization,
} from "./authorization.ts";

export class ReadOnlyError extends Error {
    constructor(operation: string) {
        super(`${operation} needs a walletClient and an account, this Rewall was built for reading only`);
        this.name = "ReadOnlyError";
    }
}

export type RewallOptions = {
    publicClient: any;
    walletClient?: any;
    account?: any;
    name: string;
    universalResolver: Address;
    // Never wiped by the SDK, so a caller holding a key for a whole session keeps it until the caller drops it
    identity?: Identity;
};

export type CreateOptions = {
    type?: string;
    grantees?: string[];
    subtreeGrantees?: string[];
    recovery: string[];
    allow?: string[];
    site?: string;
    overwrite?: boolean;
};

export const NAMESPACE_LABEL = "rewall";

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
        this.cachedIdentity = options.identity ?? null;
    }

    // The absence of a wallet is what makes a client read only, so every write and both signatures stop here
    private signer(operation: string): { walletClient: any; account: any } {
        if (!this.walletClient || !this.account) throw new ReadOnlyError(operation);
        return { walletClient: this.walletClient, account: this.account };
    }

    /* Identity */

    // Cached for the life of the process only, never written to disk, and re-derived on the next run
    async identity(): Promise<Identity> {
        if (!this.cachedIdentity) {
            const { walletClient, account } = this.signer("deriving an identity");

            // Through the wallet client, so an injected wallet works the same as a local key
            const signature = await walletClient.signTypedData({ account, ...IDENTITY_TYPED_DATA });
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

    /* Payment address */

    // Publishing many over time is what keeps senders from noticing they pay the same account
    async publishShielded(address: string): Promise<Hash | null> {
        if (!isAddress(address)) throw new Error(`${address} is not an address`);

        const current = await this.read(this.name, [RECORD.shielded]);
        if (current[RECORD.shielded]?.toLowerCase() === address.toLowerCase()) return null;

        return this.write(this.name, [{ key: RECORD.shielded, value: address }]);
    }

    // How a payer turns a name into something payable, which is the whole of pay a name
    async shieldedOf(name: string): Promise<string | null> {
        const records = await this.read(name, [RECORD.shielded]);
        return records[RECORD.shielded] || null;
    }

    // Every key this caller can decrypt with, its own plus any subtree key sealed to its name
    async heldKeys(): Promise<Identity[]> {
        const identity = await this.identity();

        // A reader who holds no name of their own still has their own key, so this is a miss and not a failure
        if (!this.name) return [identity];
        const held = await this.read(this.name, [RECORD.subtreeKey]).catch(() => ({}) as Record<string, string>);

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
        const directNames = options.grantees ?? [];
        const subtreeNames = options.subtreeGrantees ?? [];
        const direct = await Promise.all(directNames.map((n) => this.publicKeyOf(n)));
        const subtrees = await Promise.all(subtreeNames.map((n) => this.subtreeKeyOf(n)));
        const grantees = [...direct, ...subtrees];

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
            // Normalized here, where a user typed it and can still be told what is wrong with it
            site: options.site ? normalizeSite(options.site) : "",
        });

        // A stale wrap from a previous secret here turns a clean denial into a decryption failure
        const kept = new Set(
            records.filter((r) => r.key.startsWith(WRAP_PREFIX)).map((r) => r.key.slice(WRAP_PREFIX.length)),
        );
        const cleared = splitNames(existing[RECORD.holders])
            .filter((fingerprint) => !kept.has(fingerprint))
            .map((fingerprint) => ({ key: RECORD.wrap(fingerprint), value: "" }));

        // A creator that is not the anchor would sign a list no rotation could ever verify, so it stops here
        const anchor = await this.ownerAddressOf(secretName);
        if (this.address().toLowerCase() !== anchor.toLowerCase()) {
            throw new Error(`${secretName} sits under a name held by ${anchor}, not by this wallet`);
        }

        // The source lists, not the resolved ones, so every approval lines up with the entry it came from
        const lists = { grantees: directNames, subtrees: subtreeNames, recovery: options.recovery };
        const authorization = await this.signAuthorization({
            secretName,
            counter: 1,
            owner: this.name,
            ...lists,
            approvals: this.approvalsFor(this.name, owner, lists, { grantees: direct, subtrees, recovery }),
        });

        // The index rides the same transaction, or a rejected second prompt would hide a secret that exists
        const parent = secretName.split(".").slice(1).join(".");
        const label = secretName.split(".")[0]!;
        const listed = await this.read(parent, [RECORD.index]);
        const updated = addToIndex(listed[RECORD.index], label);

        return this.writeAcross([
            { name: secretName, records: [...records, ...cleared, ...authorization] },
            { name: parent, records: updated === listed[RECORD.index] ? [] : [{ key: RECORD.index, value: updated }] },
        ]);
    }

    private address(): Address {
        const { account } = this.signer("reading the caller's address");
        return (typeof account === "string" ? account : account.address) as Address;
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
        this.assertIsOwner(secretName, await this.assertAuthorized(secretName, current));
        const listKey = options?.subtree ? RECORD.subtrees : RECORD.grantees;
        const role: ApprovalRole = options?.subtree ? "subtree" : "grantee";
        const grantee = options?.subtree ? await this.subtreeKeyOf(granteeName) : await this.publicKeyOf(granteeName);
        const approval: Approval = { role, name: granteeName, fingerprint: grantee.fingerprint };

        // A bare re-grant would leave the old key's wrap live on an unchanged data key
        if (splitNames(current[listKey]).includes(granteeName)) {
            // Naming it here is the owner approving this key, which is what lets a bumped subtree version re-grant
            return this.rotateTo(secretName, current, {
                grantees: splitNames(current[RECORD.grantees]),
                subtrees: splitNames(current[RECORD.subtrees]),
                accept: [approval],
            });
        }

        const keys = await this.heldKeys();
        const wrapped = await planGrant(current, keys, grantee);

        const nextList = splitNames(addToIndex(current[listKey], granteeName));
        const auth = this.authorizationOf(secretName, current);
        const signed = await this.signAuthorization({
            ...auth,
            counter: auth.counter + 1,
            grantees: options?.subtree ? auth.grantees : nextList,
            subtrees: options?.subtree ? nextList : auth.subtrees,
            approvals: [...auth.approvals, approval],
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

    // A hostname is typed by hand and gets typed wrong, and correcting it should not cost a whole rotation
    async setSite(secretName: string, site?: string): Promise<Hash> {
        return this.write(secretName, [{ key: RECORD.site, value: site ? normalizeSite(site) : "" }]);
    }

    // The one repair path, so the baseline it trusts must verify or a delegate list is laundered into a signature
    async reauthorize(
        secretName: string,
        lists?: { grantees?: string[]; subtrees?: string[]; recovery?: string[] },
        options?: { accept?: Approval[] },
    ): Promise<Hash> {
        const current = await this.readForRotate(secretName);

        // Appended junk rides under a signature that does not cover it, so the record has to be canonical
        assertCanonical(secretName, current);
        const auth = this.authorizationOf(secretName, current);
        const signature = current[RECORD.authSig];
        const ownerAddress = await this.ownerAddressOf(secretName);

        // A verified or legacy signature is a trustworthy baseline, neither means a tampered record so refuse
        const verifies = Boolean(signature) && (await isAuthorizedBy(auth, signature!, ownerAddress));
        const legacy = !verifies && Boolean(signature) && (await isLegacyAuthorizedBy(auth, signature!, ownerAddress));
        if (!verifies && !legacy) {
            throw new UnauthorizedListError(
                secretName,
                signature ? await authorizationSigner(auth, signature) : null,
                ownerAddress,
            );
        }

        // Only the owner produces a signature that verifies, so a delegate re-signing would only brick it
        if (this.address().toLowerCase() !== ownerAddress.toLowerCase()) {
            throw new Error(`only the owner of ${secretName} can reauthorize it`);
        }

        // Deduped and sorted up front, so the approvals line up with the lists that actually get written
        const settle = (names: string[]) => [...new Set(names)].sort();
        const nextLists = {
            grantees: settle(lists?.grantees ?? auth.grantees),
            subtrees: settle(lists?.subtrees ?? auth.subtrees),
            recovery: settle(lists?.recovery ?? auth.recovery),
        };

        // SPEC section 5 requires a recovery holder, so this cannot sign a list that strands the secret
        if (nextLists.recovery.length === 0) {
            throw new Error(`${secretName} would be left with no recovery entry, add one before reauthorizing`);
        }

        const ownerName = current[RECORD.owner] || this.name;
        const owner = ownerName === this.name ? await this.selfAsGrantee() : await this.publicKeyOf(ownerName);
        const resolved = {
            grantees: await Promise.all(nextLists.grantees.map((n) => this.publicKeyOf(n))),
            subtrees: await Promise.all(nextLists.subtrees.map((n) => this.subtreeKeyOf(n))),
            recovery: await Promise.all(nextLists.recovery.map((n) => this.resolveRecovery(n))),
        };

        const approvals = this.approvalsFor(ownerName, owner, nextLists, resolved);

        // A legacy list bound no keys, so nothing on it is trusted and every name is taken on trust here
        const prior = legacy ? [] : auth.approvals;
        // Re-blessing a name already bound to another key is the whole attack, so it has to be named deliberately
        const changes = unacceptedChanges(prior, approvals, options?.accept ?? []);
        if (changes.length) throw new KeyChangedError(secretName, changes);

        const next: Authorization = {
            secretName,
            counter: auth.counter + 1,
            owner: ownerName,
            ...nextLists,
            approvals,
        };

        // The owner record is written too, or a blanked one leaves a signature that can never re-verify
        return this.write(secretName, [
            { key: RECORD.owner, value: ownerName },
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

        // Every member shares the parent's resolver, so the whole team is sealed in one transaction
        distribute: async (memberNames: string[]): Promise<Hash> => {
            const key = await deriveSubtreeKey(await this.identity(), await this.subtreeVersion());

            const groups = await Promise.all(
                memberNames.map(async (member) => {
                    const { publicKey } = await this.publicKeyOf(member);
                    return {
                        name: member,
                        records: [{ key: RECORD.subtreeKey, value: await sealSubtreeKey(key, publicKey) }],
                    };
                }),
            );
            return this.writeAcross(groups);
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

        // Run by a guardian that can write on its own name, the piece being already sealed to the
        // replacement key, so a guardian whose records belong to a parent hands the string over instead
        approve: async (ownerName: string, newOwnerPublicKey: Uint8Array, publishOn?: string): Promise<Hash> => {
            const sealed = await this.guardians.reshare(ownerName, newOwnerPublicKey);
            return this.write(publishOn ?? this.name, [
                { key: RECORD.reshare(fingerprintOf(newOwnerPublicKey)), value: sealed },
            ]);
        },

        // Run by the new owner, gathering whatever each guardian has published for them
        collect: async (ownerName: string): Promise<string[]> => {
            const identity = await this.identity();
            const key = RECORD.reshare(identity.fingerprint);
            const { names } = await this.guardians.of(ownerName);

            const found = await Promise.all(
                names.map(async (guardian) => {
                    const records = await this.read(guardian, [key]).catch(() => ({}) as Record<string, string>);
                    return records[key] || "";
                }),
            );
            return found.filter(Boolean);
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
        // An unset version is only fine with no blob, so an absent secret still surfaces as MissingBlobError
        if (!records[RECORD.blob]) return;

        const version = records[RECORD.version];
        if (version !== SCHEMA_VERSION) {
            throw new Error(`${secretName} uses schema version ${version || "(unset)"}, expected ${SCHEMA_VERSION}`);
        }

        const encryption = records[RECORD.encryption];
        if (encryption !== ENCRYPTION) {
            throw new Error(`${secretName} is encrypted with ${encryption || "(unset)"}, expected ${ENCRYPTION}`);
        }
    }

    private async readForRotate(secretName: string): Promise<Record<string, string>> {
        const keys = await this.heldKeys();
        return this.read(secretName, [...ROTATE_KEYS, ...keys.map((k) => RECORD.wrap(k.fingerprint))]);
    }

    private async rotateTo(
        secretName: string,
        current: Record<string, string>,
        next: {
            grantees: string[];
            subtrees: string[];
            recovery?: string[];
            plaintext?: Uint8Array;
            accept?: Approval[];
        },
    ): Promise<Hash> {
        // Refuses a list the owner never signed, which is what stops a write delegate steering a rotation
        this.assertIsOwner(secretName, await this.assertAuthorized(secretName, current));

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
        const direct = await Promise.all(next.grantees.map((n) => this.publicKeyOf(n)));
        const subtrees = await Promise.all(next.subtrees.map((n) => this.subtreeKeyOf(n)));
        const grantees = [...direct, ...subtrees];

        const auth = this.authorizationOf(secretName, current);
        const lists = { grantees: next.grantees, subtrees: next.subtrees, recovery: recoveryNames };
        const approvals = this.approvalsFor(ownerName, owner, lists, { grantees: direct, subtrees, recovery });

        // Checked before anything is sealed, so a swapped pubkey cannot pick up the fresh data key
        assertApproved(secretName, [...auth.approvals, ...(next.accept ?? [])], approvals);

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
            // Carried as stored, because normalizing chain data would let one bad hostname block the rotation
            site: current[RECORD.site],
        });

        const signed = await this.signAuthorization({
            secretName,
            counter: auth.counter + 1,
            owner: ownerName,
            grantees: next.grantees,
            subtrees: next.subtrees,
            recovery: recoveryNames,
            approvals,
        });

        return this.write(secretName, [...records, ...signed]);
    }

    // Clears every record the secret owns and drops it from the index, in one transaction because one
    // resolver serves every name an account holds
    // What it cannot do is unpublish the blob, which stays in chain history for anyone who already held a wrap
    async forget(secretName: string): Promise<Hash> {
        this.signer("forgetting a secret");

        const parent = secretName.split(".").slice(1).join(".");
        const label = secretName.split(".")[0]!;

        const [current, listed] = await Promise.all([
            this.read(secretName, [RECORD.blob, RECORD.holders]),
            this.read(parent, [RECORD.index]),
        ]);
        if (!current[RECORD.blob]) throw new SecretMissingError(secretName);

        const index = removeFromIndex(listed[RECORD.index], label);
        return this.writeAcross([
            { name: secretName, records: clearSecretRecords(splitNames(current[RECORD.holders])) },
            ...(index === listed[RECORD.index]
                ? []
                : [{ name: parent, records: [{ key: RECORD.index, value: index }] }]),
        ]);
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
    ownerAddressOf(secretName: string): Promise<Address> {
        return ownerAddressOf(this.publicClient, this.universalResolver, secretName);
    }

    private authorizationOf(secretName: string, records: Record<string, string>): Authorization {
        return {
            secretName,
            counter: Number(records[RECORD.authCounter] || 0),
            owner: records[RECORD.owner] || "",
            grantees: splitNames(records[RECORD.grantees]),
            subtrees: splitNames(records[RECORD.subtrees]),
            recovery: splitNames(records[RECORD.recovery]),
            approvals: splitApprovals(records[RECORD.authKeys]),
        };
    }

    // Returns the address holding the name, so a caller can refuse to re-sign as anyone but the owner
    private async assertAuthorized(secretName: string, records: Record<string, string>): Promise<Address> {
        const signature = records[RECORD.authSig];
        if (!signature) {
            throw new Error(`${secretName} carries no ${RECORD.authSig}, refusing to act on an unsigned grantee list`);
        }

        assertCanonical(secretName, records);

        const auth = this.authorizationOf(secretName, records);
        const owner = await this.ownerAddressOf(secretName);

        if (await isAuthorizedBy(auth, signature, owner)) return owner;

        // Only a signature over the old payload gets the migration path, so a stripped record still reads as a forgery
        if (await isLegacyAuthorizedBy(auth, signature, owner)) throw new LegacyAuthorizationError(secretName);

        throw new UnauthorizedListError(secretName, await authorizationSigner(auth, signature), owner);
    }

    // Only the owner produces a signature that verifies, so a delegate re-sign would brick later owner actions
    private assertIsOwner(secretName: string, owner: Address): void {
        if (this.address().toLowerCase() !== owner.toLowerCase()) {
            throw new Error(`only the owner of ${secretName} can re-sign its authorization`);
        }
    }

    // Every party a rotation resolves by name, so each one is checked against the key the owner signed for
    private approvalsFor(
        ownerName: string,
        owner: Grantee,
        lists: { grantees: string[]; subtrees: string[]; recovery: string[] },
        resolved: { grantees: Grantee[]; subtrees: Grantee[]; recovery: Grantee[] },
    ): Approval[] {
        // A desync here would sign a binding for the wrong name, so it stops rather than trusting the index
        const pair = (role: ApprovalRole, names: string[], keys: Grantee[]): Approval[] => {
            if (names.length !== keys.length) throw new Error(`${role} names and keys are out of step on ${ownerName}`);
            return keys.map((g, i) => {
                const name = names[i];
                if (!name) throw new Error(`${role} entry ${i} on ${ownerName} has no name`);
                return { role, name, fingerprint: g.fingerprint };
            });
        };

        return [
            { role: "owner", name: ownerName, fingerprint: owner.fingerprint },
            ...pair("grantee", lists.grantees, resolved.grantees),
            ...pair("subtree", lists.subtrees, resolved.subtrees),
            ...pair("recovery", lists.recovery, resolved.recovery),
        ];
    }

    private async signAuthorization(auth: Authorization): Promise<SecretRecords> {
        const { walletClient, account } = this.signer("signing an authorization");
        const signature = await walletClient.signMessage({
            account,
            message: authorizationPayload(auth),
        });
        return [
            { key: RECORD.authCounter, value: String(auth.counter) },
            { key: RECORD.authKeys, value: joinApprovals(auth.approvals) },
            { key: RECORD.authSig, value: signature },
        ];
    }

    private read(name: string, keys: string[]): Promise<Record<string, string>> {
        return readTexts(this.publicClient, this.universalResolver, name, keys);
    }

    private write(name: string, records: SecretRecords): Promise<Hash> {
        return this.writeAcross([{ name, records }]);
    }

    // Records for several names share one transaction when they share a resolver, which by design they do
    private async writeAcross(groups: { name: string; records: SecretRecords }[]): Promise<Hash> {
        // Checked before the resolver lookups, so a read only client fails clearly instead of after a round trip
        this.signer("writing records");

        const pending = groups.filter((group) => group.records.length);
        if (!pending.length) throw new Error("no records to write");

        // Resolved every write, never cached, because the owner can repoint a name at any moment
        const resolvers = await Promise.all(
            pending.map(async (group) => {
                const resolver = await resolverFor(this.publicClient, this.universalResolver, group.name);
                if (!resolver) throw new Error(`no resolver configured for ${group.name}`);
                return resolver.toLowerCase() as Address;
            }),
        );

        const batched = new Map<Address, Hex[]>();
        pending.forEach((group, index) => {
            const resolver = resolvers[index]!;
            const calls = encodeSetTextCalls(namehash(group.name), group.records);
            batched.set(resolver, [...(batched.get(resolver) ?? []), ...calls]);
        });

        // One transaction per resolver, so a name repointed somewhere else still gets written
        let hash: Hash | null = null;
        for (const [resolver, calls] of batched) hash = await this.send(resolver, calls);
        return hash!;
    }

    private async send(resolver: Address, calls: Hex[]): Promise<Hash> {
        const { walletClient, account } = this.signer("sending a transaction");
        const hash = await walletClient.writeContract({
            address: resolver,
            abi: resolverAbi,
            functionName: "multicall",
            args: [calls],
            account,
            chain: walletClient.chain,
        });

        const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`write reverted on ${resolver}, ${hash}`);
        return hash;
    }
}
