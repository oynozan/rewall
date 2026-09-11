"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { sepolia } from "viem/chains";
import { Rewall, ownerAddressOf, wipe, type Identity } from "@rewall/sdk";
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
    unlock: () => Promise<boolean>;
    lock: () => void;
    decrypt: (secretName: string) => Promise<Uint8Array>;
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

    const client = useRef<Rewall | null>(null);
    const identity = useRef<Identity | null>(null);
    const idle = useRef<number | undefined>(undefined);

    const lock = useCallback(() => {
        const held = identity.current;
        identity.current = null;
        client.current = null;
        setUnlocked(false);
        setFingerprint("");
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
        if (client.current) return true;
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
            setFingerprint(derived.fingerprint);
            setUnlocked(true);
            return true;
        } catch (failure) {
            setError(explain(failure));
            return false;
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

    const session: Session = { unlocked, unlocking, error, fingerprint, unlock, lock, decrypt };
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
