"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWorkspace } from "./dashboard-shell";
import { usePrivateData } from "./private-data";
import { OtpCells } from "./otp-code";
import { Icon, SkeletonRows, TableColumns } from "./ui";
import { FadeIn } from "./amicro";
import { ExtensionBanner } from "./extension-banner";
import { PairExtension } from "./pair-extension";

export function TwoFactorTable({ compact = false, query = "" }: { compact?: boolean; query?: string }) {
    const { vault, busy, error: vaultError, isOwnVault, setPanel } = useWorkspace();
    const { accounts, pending, error, unlock, lock } = usePrivateData();
    // Matched against what the row actually shows too, or searching for the issuer on screen finds nothing
    const term = query.toLowerCase().trim();
    const filtered = (vault?.secrets || []).filter((secret) => {
        if (secret.type !== "totp") return false;
        if (!term) return true;
        const account = accounts[secret.name];
        return [secret.name, account?.issuer ?? "", account?.label ?? ""].some((field) =>
            field.toLowerCase().includes(term),
        );
    });
    const entries = busy || vaultError ? [] : compact ? filtered.slice(0, 4) : filtered;
    return (
        <div className="secrets-browser otp-browser" aria-busy={busy}>
            <div className="table-scroll">
                <table className="otp-table">
                    <TableColumns />
                    <thead>
                        <tr>
                            <th scope="col" colSpan={2}>
                                Account
                            </th>
                            <th scope="col">Code</th>
                            <th scope="col">Expires in</th>
                            <th scope="col">
                                <span className="sr-only">Actions</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {busy && <SkeletonRows rows={4} columns={5} />}
                        {entries.map((secret) => (
                            <tr key={secret.name}>
                                <td colSpan={2}>
                                    <div className="secret-name">
                                        <span className="secret-icon">
                                            <Icon name="authenticator" />
                                        </span>
                                        <span>
                                            <strong>{accounts[secret.name]?.issuer || secret.label}</strong>
                                            <small>{accounts[secret.name]?.label || secret.name}</small>
                                        </span>
                                    </div>
                                </td>
                                {accounts[secret.name] ? (
                                    <OtpCells otp={accounts[secret.name]} label={secret.label} />
                                ) : (
                                    <>
                                        <td className="otp-code-cell">
                                            <span className="otp-locked mono" aria-label="Code locked">
                                                ••• •••
                                            </span>
                                            {error?.name === secret.name && (
                                                <p className="row-error" role="alert">
                                                    {error.message}
                                                </p>
                                            )}
                                        </td>
                                        <td className="otp-expiry-cell">
                                            <span className="muted mono">—</span>
                                        </td>
                                    </>
                                )}
                                <td className="row-action">
                                    <div className="otp-row-actions">
                                        <button
                                            className="button small"
                                            disabled={Boolean(pending)}
                                            onClick={() =>
                                                accounts[secret.name] ? lock(secret.name) : void unlock(secret.name)
                                            }
                                        >
                                            {pending === secret.name
                                                ? "Unlocking…"
                                                : accounts[secret.name]
                                                  ? "Lock"
                                                  : "Unlock"}
                                        </button>
                                        {isOwnVault && (
                                            <button
                                                className="button small"
                                                onClick={() => setPanel({ removing: secret })}
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {busy && (
                <p className="sr-only" role="status">
                    Loading accounts
                </p>
            )}
            {!busy && !entries.length && (
                <div className="quiet-empty" role="status">
                    {vaultError ? "Accounts unavailable" : query ? "No matching accounts" : "No 2FA accounts"}
                </div>
            )}
        </div>
    );
}

export function TwoFactorPage() {
    const { setPanel } = useWorkspace();
    const [query, setQuery] = useState("");
    const params = useSearchParams();
    const handed = params.get("site") || params.get("capture");

    // Opens itself when the extension hands something over, so a capture lands in one click rather than two
    useEffect(() => {
        if (handed) setPanel("authenticator");
    }, [handed, setPanel]);

    return (
        <FadeIn className="secrets-page">
            <div className="page-heading">
                <h1>2FA</h1>
                <button className="button primary" onClick={() => setPanel("authenticator")}>
                    Add account
                </button>
            </div>
            <PairExtension />
            <ExtensionBanner />
            <div className="table-toolbar page-search">
                <label className="search-field">
                    <Icon name="folder_search" size={17} />
                    <span className="sr-only">Search 2FA accounts</span>
                    <input
                        placeholder="Search accounts"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </label>
            </div>
            <TwoFactorTable query={query} />
        </FadeIn>
    );
}
