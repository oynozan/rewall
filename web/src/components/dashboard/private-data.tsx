"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { decodeReceipt, wipe, type Receipt } from "@rewall/sdk";
import { parseOtp, type TOTP } from "@rewall/sdk/2fa";
import { explain } from "@/src/lib/errors";
import { watchedNames } from "@/src/lib/account";
import { readReceipts, type Secret } from "@/src/lib/vault";
import { useIdentity } from "./identity";
import { useWorkspace } from "./dashboard-shell";

export type SharedReceipt = { secret: Secret; owner: string };

type PrivateData = {
    accounts: Record<string, TOTP>;
    shared: SharedReceipt[];
    receipts: Record<string, Receipt>;
    scanning: boolean;
    pending: string;
    error: { name: string; message: string } | null;
    unlock: (name: string) => Promise<void>;
    lock: (name: string) => void;
    openReceipt: (name: string) => Promise<void>;
    rescan: () => void;
};
const PrivateContext = createContext<PrivateData | null>(null);

export function PrivateDataProvider({ children }: { children: React.ReactNode }) {
    const { decrypt } = useIdentity();
    const { account, ownName } = useWorkspace();
    const [accounts, setAccounts] = useState<Record<string, TOTP>>({});
    const [shared, setShared] = useState<SharedReceipt[]>([]);
    const [receipts, setReceipts] = useState<Record<string, Receipt>>({});
    const [round, setRound] = useState(0);
    // Derived from the last round that finished, so a rescan does not set state inside its own effect
    const [scanned, setScanned] = useState(-1);
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

    // ENS has no reverse index, so a receipt someone granted you is found by scanning the vaults you name
    useEffect(() => {
        if (!account || !ownName) return;
        let active = true;

        // A subtree grant goes to the team's parent name, which is where a member's sealed key comes from
        const parent = ownName.split(".").slice(1).join(".");
        const mine = (secret: Secret) =>
            secret.grantees.includes(ownName) || secret.subtrees.includes(ownName) || secret.subtrees.includes(parent);

        void Promise.all(
            watchedNames(account).map((name) =>
                readReceipts(name)
                    .then((rows) => rows.filter(mine).map((secret) => ({ secret, owner: name })))
                    .catch(() => [] as SharedReceipt[]),
            ),
        ).then((groups) => {
            if (!active) return;
            setShared(groups.flat());
            setScanned(round);
        });
        return () => {
            active = false;
        };
    }, [account, ownName, round]);

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

    // Opened on request rather than with the scan, so reading the page costs no wallet prompt
    const openReceipt = useCallback(
        async (name: string) => {
            const current = generation.current.value;
            setPending(name);
            setError(null);
            try {
                const bytes = await decrypt(name);
                try {
                    const receipt = decodeReceipt(bytes);
                    if (current === generation.current.value) setReceipts((held) => ({ ...held, [name]: receipt }));
                } finally {
                    await wipe(bytes);
                }
            } catch (failure) {
                if (current === generation.current.value) setError({ name, message: explain(failure) });
            } finally {
                if (current === generation.current.value) setPending("");
            }
        },
        [decrypt],
    );

    const value: PrivateData = {
        accounts,
        shared,
        receipts,
        scanning: Boolean(account && ownName) && scanned !== round,
        pending,
        error,
        unlock,
        lock,
        openReceipt,
        rescan: () => setRound((count) => count + 1),
    };
    return <PrivateContext value={value}>{children}</PrivateContext>;
}

export function usePrivateData() {
    const context = useContext(PrivateContext);
    if (!context) throw new Error("Private data requires a dashboard workspace.");
    return context;
}
