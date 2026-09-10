"use client";

import { useState } from "react";
import { useWorkspace } from "./dashboard-shell";
import { usePrivateData } from "./private-data";
import { OtpCode } from "./otp-code";
import { Icon } from "./ui";
import { FadeIn } from "./amicro";

export function TwoFactorTable({ compact = false, query = "" }: { compact?: boolean; query?: string }) {
    const { vault, busy, error: vaultError } = useWorkspace();
    const { accounts, pending, error, unlock, lock } = usePrivateData();
    const filtered = (vault?.secrets || []).filter(
        (secret) => secret.type === "totp" && secret.name.includes(query.toLowerCase().trim()),
    );
    const entries = busy || vaultError ? [] : compact ? filtered.slice(0, 4) : filtered;
    return (
        <div className="secrets-browser otp-browser" aria-busy={busy}>
            <div className="table-scroll">
                <table className="otp-table">
                    <thead>
                        <tr>
                            <th scope="col">Account</th>
                            <th scope="col">Code / expires in</th>
                            <th scope="col">
                                <span className="sr-only">Actions</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((secret) => (
                            <tr key={secret.name}>
                                <td>
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
                                <td>
                                    {accounts[secret.name] ? (
                                        <OtpCode otp={accounts[secret.name]} label={secret.label} />
                                    ) : (
                                        <div className="otp-live">
                                            <span className="otp-locked mono" aria-label="Code locked">
                                                ••• •••
                                            </span>
                                            <span className="muted mono">—</span>
                                        </div>
                                    )}
                                    {error?.name === secret.name && (
                                        <p className="row-error" role="alert">
                                            {error.message}
                                        </p>
                                    )}
                                </td>
                                <td className="row-action">
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
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!entries.length && (
                <div className="quiet-empty" role="status">
                    {busy
                        ? "Loading accounts…"
                        : vaultError
                          ? "Accounts unavailable"
                          : query
                            ? "No matching accounts"
                            : "No 2FA accounts"}
                </div>
            )}
        </div>
    );
}

export function TwoFactorPage() {
    const [query, setQuery] = useState("");
    return (
        <FadeIn className="secrets-page">
            <div className="page-heading">
                <h1>2FA</h1>
            </div>
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
