"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { parseOtp, type TOTP } from "@rewall/sdk/2fa";
import { explain } from "@/src/lib/errors";
import { useIdentity } from "./identity";

type PrivateData = {
    accounts: Record<string, TOTP>;
    pending: string;
    error: { name: string; message: string } | null;
    unlock: (name: string) => Promise<void>;
    lock: (name: string) => void;
};
const PrivateContext = createContext<PrivateData | null>(null);

export function PrivateDataProvider({ children }: { children: React.ReactNode }) {
    const { decrypt } = useIdentity();
    const [accounts, setAccounts] = useState<Record<string, TOTP>>({});
    const [pending, setPending] = useState("");
    const [error, setError] = useState<PrivateData["error"]>(null);
    const keys = useRef(new Map<string, TOTP>());
    const generation = useRef({ value: 0 });
    const inFlight = useRef(false);

    // Decrypted seeds die with the provider, which remounts on any wallet or vault change
    useEffect(() => {
        const retained = keys.current;
        const lifecycle = generation.current;
        return () => {
            lifecycle.value++;
            retained.forEach((otp) => otp.secret.bytes.fill(0));
            retained.clear();
        };
    }, []);

    async function unlock(name: string) {
        if (inFlight.current) return;
        inFlight.current = true;
        const current = generation.current.value;
        setPending(name);
        setError(null);
        try {
            const bytes = await decrypt(name);
            if (current !== generation.current.value) {
                bytes.fill(0);
                return;
            }
            const otp = parseOtp(bytes);
            keys.current.get(name)?.secret.bytes.fill(0);
            keys.current.set(name, otp);
            setAccounts(Object.fromEntries(keys.current));
        } catch (failure) {
            if (current === generation.current.value) {
                setError({ name, message: explain(failure) });
            }
        } finally {
            if (current === generation.current.value) {
                inFlight.current = false;
                setPending("");
            }
        }
    }

    function lock(name: string) {
        keys.current.get(name)?.secret.bytes.fill(0);
        keys.current.delete(name);
        setAccounts(Object.fromEntries(keys.current));
    }

    return <PrivateContext value={{ accounts, pending, error, unlock, lock }}>{children}</PrivateContext>;
}

export function usePrivateData() {
    const context = useContext(PrivateContext);
    if (!context) throw new Error("Private data requires a dashboard workspace.");
    return context;
}
