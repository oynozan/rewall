"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TYPE_LABELS, type SecretType } from "@/src/lib/vault";
import { FadeDots, FadeIn } from "./amicro";
import { useWorkspace } from "./dashboard-shell";
import { Glyph, Icon } from "./ui";

export function SecretsPage() {
    const params = useSearchParams();
    const requestedType = params.get("type") || "all";
    const type =
        Object.hasOwn(TYPE_LABELS, requestedType) && !["totp", "receipt"].includes(requestedType)
            ? requestedType
            : "all";
    const { setPanel } = useWorkspace();
    return (
        <FadeIn className="secrets-page">
            <div className="page-heading">
                <h1>{TYPE_LABELS[type as SecretType] || "Secrets"}</h1>
                <button className="button primary" onClick={() => setPanel("find")}>
                    Find a secret
                </button>
            </div>
            <SecretsTable key={type} initialType={type} />
        </FadeIn>
    );
}

export function SecretsTable({ compact = false, initialType = "all" }: { compact?: boolean; initialType?: string }) {
    const { vault, busy, error, refresh, setPanel } = useWorkspace();
    const [query, setQuery] = useState("");
    const [type, setType] = useState(initialType);
    const [sort, setSort] = useState("newest");
    const [selected, setSelected] = useState<string[]>([]);
    const [status, setStatus] = useState("");
    const searchInput = useRef<HTMLInputElement>(null);
    useEffect(() => {
        const focusSearch = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            if (
                event.key !== "/" ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey ||
                target.matches("input, textarea, select, [contenteditable='true']") ||
                document.querySelector("dialog[open]")
            )
                return;
            event.preventDefault();
            searchInput.current?.focus();
        };
        document.addEventListener("keydown", focusSearch);
        return () => document.removeEventListener("keydown", focusSearch);
    }, []);
    const secrets = (vault?.secrets ?? [])
        .filter((secret) => !["totp", "receipt"].includes(secret.type))
        .filter(
            (secret) =>
                (type === "all" || secret.type === type) &&
                secret.name.toLowerCase().includes(query.toLowerCase().trim()),
        )
        .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : (b.created || 0) - (a.created || 0)));
    const shown = compact ? secrets.slice(0, 5) : secrets;
    const allSelected = shown.length > 0 && shown.every((secret) => selected.includes(secret.name));
    const toggleAll = () =>
        setSelected(
            allSelected
                ? selected.filter((name) => !shown.some((secret) => secret.name === name))
                : [...new Set([...selected, ...shown.map((secret) => secret.name)])],
        );
    const selectedVisible = shown.filter((secret) => selected.includes(secret.name));

    async function copySelected() {
        try {
            await navigator.clipboard.writeText(selectedVisible.map((secret) => secret.name).join("\n"));
            setStatus("Names copied");
        } catch {
            setStatus("Clipboard unavailable");
        }
    }

    return (
        <div className={`secrets-browser ${compact ? "compact" : ""}`} aria-busy={busy}>
            <div className="table-toolbar">
                <label className="search-field">
                    <Icon name="folder_search" size={17} />
                    <span className="sr-only">Search secrets</span>
                    <input
                        ref={searchInput}
                        placeholder="Search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                    <kbd>/</kbd>
                </label>
                <label className="filter-control">
                    <select aria-label="Filter by type" value={type} onChange={(event) => setType(event.target.value)}>
                        <option value="all">All types</option>
                        {Object.entries(TYPE_LABELS)
                            .filter(([key]) => !["totp", "receipt"].includes(key))
                            .map(([key, value]) => (
                                <option key={key} value={key}>
                                    {value}
                                </option>
                            ))}
                    </select>
                </label>
                {!compact && (
                    <label className="filter-control">
                        <select
                            aria-label="Sort secrets"
                            value={sort}
                            onChange={(event) => setSort(event.target.value)}
                        >
                            <option value="newest">Newest first</option>
                            <option value="name">Name A–Z</option>
                        </select>
                    </label>
                )}
                <button
                    className="icon-button refresh-button"
                    onClick={refresh}
                    disabled={busy}
                    aria-label="Refresh vault"
                >
                    <Glyph name="refresh" size={17} />
                </button>
            </div>
            {selectedVisible.length > 0 && (
                <div className="selection-bar">
                    <span>{selectedVisible.length} selected</span>
                    <button className="text-button" onClick={copySelected}>
                        Copy names
                    </button>
                    <button
                        className="text-button"
                        onClick={() => {
                            setSelected([]);
                            setStatus("");
                        }}
                    >
                        Clear
                    </button>
                    <span role="status">{status}</span>
                </div>
            )}
            <div className="table-scroll">
                <table>
                    <thead>
                        <tr>
                            <th className="checkbox-cell">
                                <input
                                    type="checkbox"
                                    aria-label="Select all visible secrets"
                                    checked={allSelected}
                                    disabled={shown.length === 0 || busy}
                                    onChange={toggleAll}
                                />
                            </th>
                            <th scope="col">Secret</th>
                            <th scope="col">Type</th>
                            <th scope="col">Protection</th>
                            <th scope="col">Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!busy &&
                            !error &&
                            shown.map((secret) => (
                                <tr key={secret.name} className={selected.includes(secret.name) ? "is-selected" : ""}>
                                    <td className="checkbox-cell">
                                        <input
                                            type="checkbox"
                                            aria-label={`Select ${secret.label}`}
                                            checked={selected.includes(secret.name)}
                                            onChange={(event) =>
                                                setSelected(
                                                    event.target.checked
                                                        ? [...selected, secret.name]
                                                        : selected.filter((name) => name !== secret.name),
                                                )
                                            }
                                        />
                                    </td>
                                    <td>
                                        <button
                                            className="secret-name"
                                            onClick={() => setPanel(secret)}
                                            aria-label={`View ${secret.label} details`}
                                        >
                                            <span className="secret-icon">
                                                <Icon
                                                    name={
                                                        secret.type === "totp"
                                                            ? "authenticator"
                                                            : secret.type === "generic"
                                                              ? "documents"
                                                              : "key"
                                                    }
                                                    size={20}
                                                />
                                            </span>
                                            <span>
                                                <strong>{secret.label}</strong>
                                                <small>{secret.name}</small>
                                            </span>
                                        </button>
                                    </td>
                                    <td>
                                        <span className="badge">
                                            {TYPE_LABELS[secret.type as SecretType] || secret.type}
                                        </span>
                                    </td>
                                    <td>
                                        <span className="protection-label">
                                            <Icon name="lock" size={14} />
                                            {secret.encryption === "aes-256-gcm" ? "Encrypted" : "Unverified"}
                                        </span>
                                    </td>
                                    <td className="date-cell">
                                        {secret.created
                                            ? new Date(secret.created * 1000).toLocaleDateString("en-GB", {
                                                  month: "short",
                                                  day: "numeric",
                                                  timeZone: "UTC",
                                              })
                                            : "—"}
                                    </td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            </div>
            {busy ? (
                <div className="table-state" aria-live="polite">
                    <FadeDots />
                </div>
            ) : error ? (
                <div className="table-state">
                    <p role="alert">{error}</p>
                    <button className="button small" onClick={refresh}>
                        Try again
                    </button>
                </div>
            ) : shown.length === 0 ? (
                <div className="table-state">
                    <h3>{query || type !== "all" ? "No matching secrets" : "No secrets found"}</h3>
                    <button
                        className="button small"
                        onClick={() => {
                            if (query || type !== "all") {
                                setQuery("");
                                setType("all");
                            } else setPanel("vault");
                        }}
                    >
                        {query || type !== "all" ? "Clear filters" : "Open a vault"}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
