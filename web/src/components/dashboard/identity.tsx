"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { sepolia } from "viem/chains";
import { Rewall, RECORD, readTexts, registeredOwnerOf, toBase64, wipe, type Identity } from "@rewall/sdk";
import { UNIVERSAL_RESOLVER, vaultClient } from "@/src/lib/vault";
import { explain } from "@/src/lib/errors";

const IDLE_LOCK_MS = 15 * 60 * 1000;
const verifiedKey = (address: string) => `rewall.signer-verified.${address.toLowerCase()}`;

export class NonDeterministicSignerError extends Error {
    constructor() {
        super(
            "This wallet returns a different signature every time, so Rewall cannot derive a stable key from it. " +
                "Anything stored now would be unreadable after you sign in again.",
        );
        this.name = "NonDeterministicSignerError";
    }
}

type Session = {
    unlocked: boolean;
    unlocking: boolean;
    error: string;
    fingerprint: string;
    publicKey: string;
    // Returns the base64 public key rather than a flag, because a caller that unlocks usually needs it
    // in the same tick and the state setter below has not landed yet
    unlock: () => Promise<string>;
    lock: () => void;
    decrypt: (secretName: string) => Promise<Uint8Array>;
    write: <T>(action: (client: Rewall) => Promise<T>) => Promise<T>;
    // Posts the key itself rather than returning it, so no other component ever holds the bytes
    handOff: (nonce: string) => Promise<void>;
};

const IdentityContext = createContext<Session | null>(null);

export function useIdentity() {
    const session = useContext(IdentityContext);
    if (!session) throw new Error("Identity must be inside the dashboard");
    return session;
}

export function IdentityProvider({
    children,
    address,
    getProvider,
    name,
}: {
    children: React.ReactNode;
    address: string;
    getProvider: () => Promise<EIP1193Provider | null>;
    name: string;
}) {
    const [unlocked, setUnlocked] = useState(false);
    const [unlocking, setUnlocking] = useState(false);
    const [error, setError] = useState("");
    const [fingerprint, setFingerprint] = useState("");
    const [publicKey, setPublicKey] = useState("");

    const client = useRef<Rewall | null>(null);
    const identity = useRef<Identity | null>(null);
    const idle = useRef<number | undefined>(undefined);
    // Held so two callers unlocking at once share one signature rather than prompting the wallet twice
    const pending = useRef<Promise<string> | null>(null);
    // Bumped by every lock, so an unlock still waiting on the wallet cannot land a key for the wrong session
    const generation = useRef(0);

    const lock = useCallback(() => {
        const held = identity.current;
        generation.current++;
        pending.current = null;
        identity.current = null;
        client.current = null;
        setUnlocked(false);
        setFingerprint("");
        setPublicKey("");
        if (held) void wipe(held.secretKey);
    }, []);

    // A key derived from one wallet must never outlive a switch to another
    useEffect(() => lock, [address, lock]);

    useEffect(() => {
        if (!unlocked) return;
        const reset = () => {
            window.clearTimeout(idle.current);
            idle.current = window.setTimeout(lock, IDLE_LOCK_MS);
        };
        const events = ["pointerdown", "keydown", "visibilitychange"] as const;
        events.forEach((event) => window.addEventListener(event, reset));
        reset();
        return () => {
            window.clearTimeout(idle.current);
            events.forEach((event) => window.removeEventListener(event, reset));
        };
    }, [unlocked, lock]);

    // A supplied identity skips the signature, which is what lets a rebuild follow a name change for free
    const build = useCallback(
        async (held?: Identity) => {
            const provider = await getProvider();
            if (!provider || !address) throw new Error("Connect your wallet first.");
            return new Rewall({
                publicClient: vaultClient,
                walletClient: createWalletClient({
                    account: address as Address,
                    chain: sepolia,
                    transport: custom(provider),
                }),
                account: address as Address,
                name,
                universalResolver: UNIVERSAL_RESOLVER,
                ...(held ? { identity: held } : {}),
            });
        },
        [address, getProvider, name],
    );

    // A key that reproduces the one this name published is already proven stable, so no second prompt is needed
    const matchesPublished = useCallback(
        async (derived: Identity) => {
            if (!name) return false;
            const records = await readTexts(vaultClient, UNIVERSAL_RESOLVER, name, [RECORD.pubkey]).catch(() => null);
            return records?.[RECORD.pubkey] === toBase64(derived.publicKey);
        },
        [name],
    );

    const unlock = useCallback(async () => {
        if (identity.current) return toBase64(identity.current.publicKey);
        if (pending.current) return pending.current;

        const started = generation.current;
        let attempt: Promise<string> | null = null;
        attempt = (async () => {
            setUnlocking(true);
            setError("");
            try {
                const live = await build();
                const derived = await live.identity();

                try {
                    // The key is a hash of the signature, so a signer that varies would silently orphan every secret
                    if (localStorage.getItem(verifiedKey(address)) !== "1") {
                        if (!(await matchesPublished(derived))) {
                            const second = await (await build()).identity();
                            const stable = second.fingerprint === derived.fingerprint;
                            await wipe(second.secretKey);
                            if (!stable) throw new NonDeterministicSignerError();
                        }
                        localStorage.setItem(verifiedKey(address), "1");
                    }
                    // A lock or a wallet switch while the prompt was open means this key is for a session that ended
                    if (generation.current !== started)
                        throw new Error("The wallet changed while unlocking. Try again.");
                } catch (failure) {
                    // Wiped on every path out, including a wallet that refused the second prompt
                    await wipe(derived.secretKey);
                    throw failure;
                }

                client.current = live;
                identity.current = derived;
                const encoded = toBase64(derived.publicKey);
                setFingerprint(derived.fingerprint);
                setPublicKey(encoded);
                setUnlocked(true);
                return encoded;
            } catch (failure) {
                // Shown here for the drawer, and rethrown so a flow driving the unlock can say what actually failed
                setError(explain(failure));
                throw failure;
            } finally {
                setUnlocking(false);
                if (pending.current === attempt) pending.current = null;
            }
        })();

        pending.current = attempt;
        return attempt;
    }, [address, build, matchesPublished]);

    // Rebuilt when the vault name arrives after setup, or the first secret is written under an empty owner
    const live = useCallback(async (): Promise<Rewall> => {
        if (!identity.current) await unlock();
        if (!client.current || client.current.name !== name) client.current = await build(identity.current!);
        return client.current;
    }, [build, name, unlock]);

    const decrypt = useCallback(async (secretName: string) => (await live()).get(secretName), [live]);

    // Every mutation needs the identity too, because the data key is sealed to it
    const write = useCallback(
        async <T,>(action: (client: Rewall) => Promise<T>): Promise<T> => action(await live()),
        [live],
    );

    // The extension decrypts and never signs, so pairing hands it this key and never the wallet
    const handOff = useCallback(
        async (nonce: string) => {
            if (!identity.current) await unlock();
            const held = identity.current;
            if (!held) throw new Error("Unlock your vault first.");

            // Addressed to this origin, where the extension's relay content script is the only listener
            window.postMessage(
                { type: "rewall:pair-handoff", nonce, name, secretKey: toBase64(held.secretKey) },
                window.location.origin,
            );
        },
        [name, unlock],
    );

    const session: Session = {
        unlocked,
        unlocking,
        error,
        fingerprint,
        publicKey,
        unlock,
        lock,
        decrypt,
        write,
        handOff,
    };
    return <IdentityContext value={session}>{children}</IdentityContext>;
}

// Reading is public, decrypting is cryptographic, writing is ENS ownership. Three separate questions
export function useCapabilities(vaultOwner: string | undefined, address: string) {
    const { unlocked } = useIdentity();
    const [resolved, setResolved] = useState<{ question: string; owner: string } | null>(null);
    const question = `${vaultOwner ?? ""}|${address}`;

    useEffect(() => {
        let active = true;
        if (!vaultOwner || !address) return;

        void registeredOwnerOf(vaultClient, UNIVERSAL_RESOLVER, vaultOwner)
            .then((owner) => {
                if (active) setResolved({ question, owner: owner.toLowerCase() });
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [question, vaultOwner, address]);

    // Keyed by the question it answers, so a stale reply for a previous vault is ignored rather than reset
    const canWrite = resolved?.question === question && resolved.owner === address.toLowerCase();
    return { canRead: Boolean(vaultOwner), canDecrypt: unlocked, canWrite };
}
