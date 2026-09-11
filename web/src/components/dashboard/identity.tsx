"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { sepolia } from "viem/chains";
import { Rewall, ownerAddressOf, toBase64, wipe, type Identity } from "@rewall/sdk";
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

    const lock = useCallback(() => {
        const held = identity.current;
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

    const build = useCallback(async () => {
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
        });
    }, [address, getProvider, name]);

    const unlock = useCallback(async () => {
        if (identity.current) return toBase64(identity.current.publicKey);
        setUnlocking(true);
        setError("");
        try {
            const live = await build();
            const derived = await live.identity();

            // The key is a hash of the signature, so a signer that varies would silently orphan every secret
            if (localStorage.getItem(verifiedKey(address)) !== "1") {
                const second = await (await build()).identity();
                const stable = second.fingerprint === derived.fingerprint;
                await wipe(second.secretKey);
                if (!stable) {
                    await wipe(derived.secretKey);
                    throw new NonDeterministicSignerError();
                }
                localStorage.setItem(verifiedKey(address), "1");
            }

            client.current = live;
            identity.current = derived;
            const encoded = toBase64(derived.publicKey);
            setFingerprint(derived.fingerprint);
            setPublicKey(encoded);
            setUnlocked(true);
            return encoded;
        } catch (failure) {
            setError(explain(failure));
            return "";
        } finally {
            setUnlocking(false);
        }
    }, [address, build]);

    const decrypt = useCallback(
        async (secretName: string) => {
            if (!client.current && !(await unlock())) throw new Error(error || "Unlock to read this secret.");
            return client.current!.get(secretName);
        },
        [unlock, error],
    );

    // Every mutation needs the identity too, because the data key is sealed to it
    const write = useCallback(
        async <T,>(action: (live: Rewall) => Promise<T>): Promise<T> => {
            if (!client.current && !(await unlock())) throw new Error(error || "Unlock to change this vault.");
            return action(client.current!);
        },
        [unlock, error],
    );

    const session: Session = { unlocked, unlocking, error, fingerprint, publicKey, unlock, lock, decrypt, write };
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

        void ownerAddressOf(vaultClient, UNIVERSAL_RESOLVER, vaultOwner)
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
