"use client";

/*
 * The four transfer flows that live in the workspace drawer, plus the two widgets the balance card
 * embeds. They share the rail session, one amount parser and one set of error messages, which is why
 * they sit together. A payment leaves no trace on chain, so the receipt each send writes is the only
 * record of it and the grant list on that receipt is the entire visibility control.
 */

import { useEffect, useState } from "react";
import { formatEther, formatUnits, getAddress, isAddress, parseUnits, type Address } from "viem";
import {
    encodeReceipt,
    decodeReceipt,
    guardianRecoveryEntry,
    NAMESPACE_LABEL,
    readTexts,
    receiptLabel,
    RECORD,
    wipe,
    type Receipt,
} from "@rewall/sdk";
import { explain } from "@/src/lib/errors";
import { watchName } from "@/src/lib/account";
import {
    affordsGas,
    CREATE_GAS,
    ownerName,
    UNIVERSAL_RESOLVER,
    vaultClient,
    type GasCheck,
    type Secret,
} from "@/src/lib/vault";
import { useIdentity } from "./identity";
import { useWorkspace } from "./dashboard-shell";
import { useOwnRecovery } from "./create-secret";
import { useRail, type Token } from "./rail";
import { CopyButton, Glyph, Icon } from "./ui";

// A payment is irreversible and its id is the only handle on it, so it outlives a failed receipt write
const unwrittenKey = (address: string) => `rewall.unwritten.${address.toLowerCase()}`;

// The whole write plan, so a retry replays what the payment intended instead of rebuilding a guess
type Unwritten = { tx: string; recipient: string; amount: string; grantees?: string[]; recovery?: string };

/* Shared */

function useAmount() {
    const { token } = useRail();
    return (value: string): bigint => {
        if (!token) throw new Error("The token has not loaded yet.");
        const amount = parseUnits(value.trim(), token.decimals);
        if (amount <= BigInt(0)) throw new Error("Enter an amount above zero.");
        return amount;
    };
}

// A receipt names its own token, so one written against a different one is shown in base units
export function receiptAmount(receipt: Receipt, token: Token | null): string {
    if (!token || receipt.token.toLowerCase() !== token.address.toLowerCase()) return receipt.amount;
    return `${formatUnits(BigInt(receipt.amount), token.decimals)} ${token.symbol}`;
}

function Amounts({ value }: { value: bigint | null }) {
    const { token } = useRail();
    if (value === null || !token) return <span className="mono">—</span>;
    return (
        <span className="mono">
            {formatUnits(value, token.decimals)} {token.symbol}
        </span>
    );
}

/* Send */

type Candidate = {
    state: "empty" | "checking" | "missing" | "unpaid" | "unset" | "ready" | "address";
    shielded?: string;
};

export function SendTransfer({ onDone }: { onDone: () => void }) {
    const { ownName, account, refresh: reload } = useWorkspace();
    const { write } = useIdentity();
    const rail = useRail();
    const parse = useAmount();
    const ownRecovery = useOwnRecovery(ownName);
    const [candidate, setCandidate] = useState<Candidate>({ state: "empty" });
    const [step, setStep] = useState("");
    const [error, setError] = useState("");
    // The balance below the amount is the rail token, so a wallet out of gas looks fully funded without this
    const [gas, setGas] = useState<GasCheck | null>(null);
    // Read at mount, because a payment whose receipt never landed has to be the first thing shown
    const [pending, setPending] = useState<Unwritten | null>(() => {
        try {
            const held = localStorage.getItem(unwrittenKey(account));
            return held ? JSON.parse(held) : null;
        } catch {
            return null;
        }
    });

    useEffect(() => {
        if (!account) return;
        let active = true;
        void affordsGas(account as Address, CREATE_GAS)
            .then((result) => {
                if (active) setGas(result);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [account]);

    // Both keys in one read, because a receipt cannot be shared with a name that publishes no key
    async function look(value: string) {
        const typed = value.trim();
        // An emptied field is not a name that failed to resolve, so it says nothing rather than no
        if (!typed) {
            setCandidate({ state: "empty" });
            return;
        }
        setCandidate({ state: "checking" });

        // The rail credits whatever address it is given, so a raw one is payable without any ENS.
        // Checksum off because people paste lowercase, and lowercasing first keeps getAddress safe
        if (isAddress(typed, { strict: false })) {
            setCandidate({ state: "address", shielded: getAddress(typed.toLowerCase()) });
            return;
        }

        let name: string;
        try {
            name = ownerName(typed);
        } catch {
            setCandidate({ state: "missing" });
            return;
        }
        try {
            const records = await readTexts(vaultClient, UNIVERSAL_RESOLVER, name, [RECORD.shielded, RECORD.pubkey]);
            if (!records[RECORD.shielded]) setCandidate({ state: "unpaid" });
            else if (!records[RECORD.pubkey]) setCandidate({ state: "unset" });
            else setCandidate({ state: "ready", shielded: records[RECORD.shielded] });
        } catch {
            setCandidate({ state: "missing" });
        }
    }

    async function store(entry: Unwritten) {
        // Defaulted, because an entry written before the plan was persisted carries neither field
        const recovery = entry.recovery || (ownRecovery ? guardianRecoveryEntry(ownName) : "");
        if (!recovery) throw new Error("Set up a recovery phrase before writing this receipt.");

        setStep("Encrypting and sealing…");
        await write(async (client) => {
            setStep("Waiting for your wallet…");
            const hash = await client.create(
                `${receiptLabel(entry.tx)}.${NAMESPACE_LABEL}.${ownName}`,
                encodeReceipt({
                    amount: entry.amount,
                    token: rail.token!.address,
                    counterparty: entry.recipient,
                    tx: entry.tx,
                    direction: "sent",
                }),
                { type: "receipt", recovery: [recovery], grantees: entry.grantees ?? [] },
            );
            setStep("Confirming on Sepolia…");
            return hash;
        });
        try {
            localStorage.removeItem(unwrittenKey(account));
        } catch {}
        setPending(null);
        // Watching scans a vault under an ENS name, which an address does not have
        if (!isAddress(entry.recipient, { strict: false })) watchName(account, entry.recipient);
        reload();
        void rail.refresh();
        onDone();
    }

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        const form = new FormData(event.currentTarget);
        const typedRecipient = String(form.get("recipient")).trim();
        const typedRecovery = String(form.get("recovery") || "").trim();
        const extra = String(form.get("share") || "")
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean);
        // An address publishes no key, so there is nothing to seal a receipt to and nothing to grant
        const toAddress = candidate.state === "address";

        if (!typedRecovery && !ownRecovery) {
            setError("Name someone who can recover this, or set up a recovery phrase first.");
            return;
        }

        // Normalized before anything moves, so the receipt names and grants the name the payment resolved
        let amount: bigint;
        let recipient: string;
        let recovery: string;
        let grantees: string[];
        try {
            amount = parse(String(form.get("amount")));
            recipient = toAddress ? typedRecipient : ownerName(typedRecipient);
            recovery = typedRecovery ? ownerName(typedRecovery) : guardianRecoveryEntry(ownName);
            grantees = [...(!toAddress && form.get("tell") ? [recipient] : []), ...extra.map((n) => ownerName(n))];
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Check the amount and the names.");
            return;
        }

        // The payment is free and irreversible and the receipt is not, so a short wallet stops it here
        try {
            setStep("Checking you can write the receipt…");
            const gas = await affordsGas(account as Address, CREATE_GAS);
            if (!gas.ok) {
                setError(
                    `This wallet holds ${formatEther(gas.held)} Sepolia ETH and writing the receipt needs about ${formatEther(gas.needed)}. Top it up first, because the payment cannot be undone and the receipt is the only record of it.`,
                );
                return;
            }
        } catch {
            // A balance that cannot be read is not a balance that is too low, so this only warns
            setError("Could not check this wallet's gas. Retry, or top it up before sending.");
            return;
        } finally {
            setStep("");
        }

        try {
            setStep("Waiting for your wallet…");
            const tx = await rail.pay(candidate.shielded as Address, amount);
            const entry: Unwritten = { tx, recipient, amount: amount.toString(), grantees, recovery };
            try {
                localStorage.setItem(unwrittenKey(account), JSON.stringify(entry));
            } catch {}
            setPending(entry);
            await store(entry);
        } catch (failure) {
            setError(explain(failure));
        } finally {
            setStep("");
        }
    }

    async function retry() {
        setError("");
        try {
            await store(pending!);
        } catch (failure) {
            setError(explain(failure));
        } finally {
            setStep("");
        }
    }

    // The payment is done and cannot be undone, so the only thing left is to stop being asked about it
    function dismiss() {
        try {
            localStorage.removeItem(unwrittenKey(account));
        } catch {}
        setPending(null);
        setError("");
    }

    if (!ownName) return <p className="field-help">Set up your vault before sending, a receipt lives under it.</p>;
    if (!rail.configured) return <p className="field-help">{rail.error}</p>;

    // Recorded the moment the payment lands but only shown once nothing is in flight, since a write
    // still running is not a write that failed
    if (pending && !step) {
        return (
            <div className="unfinished" role="alert">
                <p className="unfinished-title">
                    <Glyph name="warning" size={16} />
                    <span>The payment went through. The receipt did not.</span>
                </p>
                <p className="field-help">
                    Nothing else records this, so write it before you close the tab. The id is the only handle.
                </p>

                <div className="unfinished-id">
                    <span className="mono">{pending.tx}</span>
                    <CopyButton value={pending.tx} label="Copy transaction id" />
                </div>

                <button
                    type="button"
                    className="button primary full-width"
                    disabled={Boolean(step)}
                    onClick={() => void retry()}
                >
                    {step || "Write the receipt"}
                </button>

                {error && <p className="unfinished-note">{error}</p>}

                <button type="button" className="text-button" disabled={Boolean(step)} onClick={dismiss}>
                    Dismiss, I have saved the id
                </button>
            </div>
        );
    }

    return (
        <form onSubmit={submit} className="panel-form">
            <label htmlFor="send-recipient">Pay</label>
            <input
                id="send-recipient"
                name="recipient"
                placeholder="bob.eth or 0x…"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                onChange={(event) => void look(event.target.value)}
            />
            <Resolution candidate={candidate} />

            <label htmlFor="send-amount">Amount</label>
            <input
                id="send-amount"
                name="amount"
                inputMode="decimal"
                placeholder="1.0"
                autoComplete="off"
                spellCheck={false}
                required
            />
            <p className="field-help">
                You hold <Amounts value={rail.balance} />. Nothing about this payment reaches the chain.
            </p>
            {gas && !gas.ok && (
                <p className="unfinished-title">
                    <Glyph name="warning" size={16} />
                    <span>
                        The receipt does, and it costs gas. This wallet holds {formatEther(gas.held)} Sepolia ETH, which
                        will not cover writing one. Top it up before sending, because the payment cannot be undone.
                    </span>
                </p>
            )}

            {candidate.state !== "address" && (
                <label className="check-row">
                    <input type="checkbox" name="tell" defaultChecked />
                    Let them see the receipt
                </label>
            )}

            <label htmlFor="send-share">Also share with</label>
            <input
                id="send-share"
                name="share"
                placeholder="ci.bob.eth"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
            />
            <p className="field-help">
                Being paid does not come with the details. Everyone named here can read the amount, nobody else can.
            </p>

            {ownRecovery === false && (
                <>
                    <label htmlFor="send-recovery">Recovery name</label>
                    <input
                        id="send-recovery"
                        name="recovery"
                        placeholder="vault.eth"
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                    />
                    <p className="field-help">
                        Required, because losing this wallet would otherwise strand the only record of the payment.
                    </p>
                </>
            )}

            <button
                className="button primary full-width"
                disabled={!(candidate.state === "ready" || candidate.state === "address") || Boolean(step)}
            >
                {step || "Send"}
            </button>

            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
        </form>
    );
}

function Resolution({ candidate }: { candidate: Candidate }) {
    if (candidate.state === "empty") return null;
    if (candidate.state === "checking") return <p className="field-help">Looking it up…</p>;
    if (candidate.state === "missing") return <p className="field-help">No such name on Sepolia.</p>;
    if (candidate.state === "unpaid") {
        return <p className="field-help">That name has not published a payment address, so there is nothing to pay.</p>;
    }
    if (candidate.state === "unset") {
        return <p className="field-help">That name has not set up Rewall, so it could never read a receipt.</p>;
    }
    if (candidate.state === "address") {
        return (
            <p className="field-help">
                Paying an address directly. It still leaves the chain untouched, but the rail sees who you paid, and
                they cannot be granted the receipt because an address publishes no key.
            </p>
        );
    }
    return (
        <p className="field-help">
            Paying <span className="mono">{candidate.shielded}</span>. It leads nowhere on chain, which is the point.
        </p>
    );
}

/* Fund */

export function FundBalance({ onDone }: { onDone: () => void }) {
    const { configured, error: railError, token, balance, walletBalance, deposit, awaitCredit } = useRail();
    const parse = useAmount();
    const [held, setHeld] = useState<bigint | null>(null);
    const [step, setStep] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        if (!configured) return;
        void walletBalance()
            .then(setHeld)
            .catch(() => {});
    }, [configured, walletBalance]);

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        try {
            const amount = parse(String(new FormData(event.currentTarget).get("amount")));
            const before = balance ?? BigInt(0);
            await deposit(amount, setStep);
            setStep("Waiting for the rail to credit it…");
            await awaitCredit(before);
            onDone();
        } catch (failure) {
            setError(explain(failure));
        } finally {
            setStep("");
        }
    }

    if (!configured) return <p className="field-help">{railError}</p>;

    return (
        <form onSubmit={submit} className="panel-form">
            <label htmlFor="fund-amount">Amount</label>
            <input
                id="fund-amount"
                name="amount"
                inputMode="decimal"
                placeholder="10.0"
                autoComplete="off"
                spellCheck={false}
                required
            />
            <p className="field-help">
                This wallet holds <Amounts value={held} />. Moving it in makes it spendable without gas.
            </p>
            <button className="button primary full-width" disabled={Boolean(step) || !token}>
                {step || "Deposit"}
            </button>
            <div className="notice">
                <Icon name="lock" size={17} />
                <p>A deposit is public and so is the amount. Everything after it, who you pay and how much, is not.</p>
            </div>
            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
        </form>
    );
}

/* Withdraw */

export function WithdrawBalance({ onDone }: { onDone: () => void }) {
    const rail = useRail();
    const parse = useAmount();
    const [step, setStep] = useState("");
    const [error, setError] = useState("");

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setStep("Waiting for your wallet…");
        try {
            await rail.withdraw(parse(String(new FormData(event.currentTarget).get("amount"))));
            await rail.refresh();
        } catch (failure) {
            setError(explain(failure));
        } finally {
            setStep("");
        }
    }

    if (!rail.configured) return <p className="field-help">{rail.error}</p>;

    return (
        <>
            {rail.ticket ? (
                <PendingTicket onDone={onDone} />
            ) : (
                <form onSubmit={submit} className="panel-form">
                    <label htmlFor="withdraw-amount">Amount</label>
                    <input
                        id="withdraw-amount"
                        name="amount"
                        inputMode="decimal"
                        placeholder="1.0"
                        autoComplete="off"
                        spellCheck={false}
                        required
                    />
                    <p className="field-help">
                        You hold <Amounts value={rail.balance} />.
                    </p>
                    <button className="button primary full-width" disabled={Boolean(step) || !rail.token}>
                        {step || "Request ticket"}
                    </button>
                    <p className="field-help">
                        The rail debits you when it issues the ticket. Redeeming it on chain is what hands the tokens
                        back.
                    </p>
                    {error && (
                        <p className="form-error" role="alert">
                            {error}
                        </p>
                    )}
                </form>
            )}
        </>
    );
}

export function PendingTicket({ onDone }: { onDone?: () => void }) {
    const rail = useRail();
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
    const [step, setStep] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    if (!rail.ticket) return null;
    const ticket = rail.ticket;
    const minutes = Math.floor((ticket.deadline - now) / 60);

    async function redeem() {
        setStep("Waiting for your wallet…");
        setError("");
        try {
            await rail.redeem(ticket);
            await rail.refresh();
            onDone?.();
        } catch (failure) {
            setError(explain(failure));
        } finally {
            setStep("");
        }
    }

    return (
        <div className="notice">
            <Icon name="wallet" size={17} />
            <div>
                <p>
                    <Amounts value={BigInt(ticket.amount)} /> is waiting on a ticket.
                </p>
                {minutes > 0 ? (
                    <>
                        <p className="field-help">
                            Expires in {minutes} min. Redeem from this wallet on this device, the ticket is stored here
                            only.
                        </p>
                        <button
                            className="button primary full-width"
                            disabled={Boolean(step)}
                            onClick={() => void redeem()}
                        >
                            {step || "Redeem"}
                        </button>
                    </>
                ) : (
                    <>
                        <p className="field-help">This ticket expired. The rail refunds your balance shortly.</p>
                        <button className="text-button" onClick={rail.forgetTicket}>
                            Dismiss
                        </button>
                    </>
                )}
                {error && (
                    <p className="form-error" role="alert">
                        {error}
                    </p>
                )}
            </div>
        </div>
    );
}

/* Being paid */

export function PublishShielded() {
    const { ownName, isOwnVault } = useWorkspace();
    const { write } = useIdentity();
    const rail = useRail();
    const [published, setPublished] = useState<boolean | null>(null);
    const [step, setStep] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        if (!ownName) return;
        let active = true;
        void readTexts(vaultClient, UNIVERSAL_RESOLVER, ownName, [RECORD.shielded])
            .then((records) => {
                if (active) setPublished(Boolean(records[RECORD.shielded]));
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [ownName]);

    if (!isOwnVault || published !== false || !rail.configured) return null;

    // Asked for once rather than in an effect, since every call mints a fresh address and a new row
    async function publish() {
        setStep("Waiting for your wallet…");
        setError("");
        try {
            const address = await rail.shielded();
            setStep("Confirming on Sepolia…");
            await write((client) => client.publishShielded(address));
            setPublished(true);
        } catch (failure) {
            setError(explain(failure));
        } finally {
            setStep("");
        }
    }

    return (
        <>
            <button className="text-button" disabled={Boolean(step)} onClick={() => void publish()}>
                {step || "Publish a payment address"}
            </button>
            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
        </>
    );
}

/* Reading a receipt */

export function ReceiptDetail({ secret }: { secret: Secret }) {
    const { decrypt } = useIdentity();
    const { token } = useRail();
    const [receipt, setReceipt] = useState<Receipt | null>(null);
    const [opening, setOpening] = useState(false);
    const [error, setError] = useState("");

    async function open() {
        setOpening(true);
        setError("");
        try {
            const bytes = await decrypt(secret.name);
            try {
                setReceipt(decodeReceipt(bytes));
            } finally {
                await wipe(bytes);
            }
        } catch (failure) {
            setError(explain(failure));
        } finally {
            setOpening(false);
        }
    }

    if (!receipt) {
        return (
            <>
                <div className="sealed-value">
                    <Icon name="lock" size={22} />
                    <button className="text-button" onClick={() => void open()} disabled={opening}>
                        {opening ? "Waiting for your wallet…" : "Open receipt"}
                    </button>
                </div>
                {error && (
                    <p className="form-error" role="alert">
                        {error}
                    </p>
                )}
            </>
        );
    }

    return (
        <dl className="detail-list">
            <div>
                <dt>Amount</dt>
                <dd className="mono">{receiptAmount(receipt, token)}</dd>
            </div>
            <div>
                <dt>{receipt.direction === "sent" ? "Paid" : "From"}</dt>
                <dd className="mono">{receipt.counterparty}</dd>
            </div>
            <div>
                <dt>Transaction</dt>
                <dd className="mono">{receipt.tx}</dd>
            </div>
        </dl>
    );
}
