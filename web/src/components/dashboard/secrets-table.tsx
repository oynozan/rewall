"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { TYPE_LABELS, type SecretType } from "@/src/lib/vault";
import { FadeDots, FadeIn } from "./amicro";
import { useWorkspace } from "./dashboard-shell";
import { Glyph, Icon, TableColumns } from "./ui";

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
    const selectAll = useRef<HTMLInputElement>(null);
    const selectionAnchor = useRef<string | null>(null);
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
    const selectedVisible = shown.filter((secret) => selected.includes(secret.name));
    const allSelected = shown.length > 0 && selectedVisible.length === shown.length;
    const partiallySelected = selectedVisible.length > 0 && !allSelected;
    useEffect(() => {
        if (selectAll.current) selectAll.current.indeterminate = partiallySelected;
    }, [partiallySelected]);
    const clearSelection = () => {
        setSelected([]);
        selectionAnchor.current = null;
    };
    const toggleAll = () => {
        setSelected(allSelected ? [] : shown.map((secret) => secret.name));
        selectionAnchor.current = null;
    };
    const toggleRow = (name: string, checked: boolean, range: boolean) => {
        const anchor = shown.findIndex((secret) => secret.name === selectionAnchor.current);
        const index = shown.findIndex((secret) => secret.name === name);
        const names =
            range && anchor >= 0
                ? shown.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((secret) => secret.name)
                : [name];
        setSelected((current) =>
            checked ? [...new Set([...current, ...names])] : current.filter((value) => !names.includes(value)),
        );
        selectionAnchor.current = name;
    };

    async function copySelected() {
        try {
            await navigator.clipboard.writeText(selectedVisible.map((secret) => secret.name).join("\n"));
            toast(selectedVisible.length === 1 ? "Name copied" : `${selectedVisible.length} names copied`, {
                id: "secret-selection",
            });
        } catch {
            toast("Could not copy names", { id: "secret-selection" });
        }
    }

    return (
        <div
            className={`secrets-browser ${compact ? "compact" : ""}`}
            aria-busy={busy}
            onKeyDown={(event) => {
                if (event.key === "Escape" && selectedVisible.length && !document.querySelector("dialog[open]")) {
                    event.preventDefault();
                    clearSelection();
                    selectAll.current?.focus();
                }
            }}
        >
            <div className="table-toolbar">
                <label className="search-field">
                    <Icon name="folder_search" size={17} />
                    <span className="sr-only">Search secrets</span>
                    <input
                        ref={searchInput}
                        placeholder="Search"
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            clearSelection();
                        }}
                    />
                    <kbd>/</kbd>
                </label>
                {selectedVisible.length > 0 ? (
                    <div className="selection-actions" role="group" aria-label="Selection actions">
                        <span className="selection-count" role="status">
                            {selectedVisible.length} selected
                        </span>
                        <button className="button small" onClick={copySelected}>
                            <Glyph name="copy" size={16} />
                            Copy names
                        </button>
                        <button
                            className="icon-button"
                            aria-label="Clear selection"
                            title="Clear selection (Esc)"
                            onClick={() => {
                                clearSelection();
                                selectAll.current?.focus();
                            }}
                        >
                            <Glyph name="close" size={16} />
                        </button>
                    </div>
                ) : (
                    <>
                        <label className="filter-control">
                            <select
                                aria-label="Filter by type"
                                value={type}
                                onChange={(event) => {
                                    setType(event.target.value);
                                    clearSelection();
                                }}
                            >
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
                            onClick={() => {
                                clearSelection();
                                void refresh();
                            }}
                            disabled={busy}
                            aria-label="Refresh vault"
                        >
                            <Glyph name="refresh" size={17} />
                        </button>
                    </>
                )}
            </div>
            <div className="table-scroll">
                <table className="secrets-table">
                    <TableColumns />
                    <thead>
                        <tr>
                            <th className="checkbox-cell">
                                <label className="table-checkbox">
                                    <input
                                        ref={selectAll}
                                        type="checkbox"
                                        aria-label="Select all visible secrets"
                                        checked={allSelected}
                                        disabled={shown.length === 0 || busy}
                                        onChange={toggleAll}
                                    />
                                </label>
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
                                        <label className="table-checkbox">
                                            <input
                                                type="checkbox"
                                                aria-label={`Select ${secret.label}`}
                                                checked={selected.includes(secret.name)}
                                                onChange={(event) =>
                                                    toggleRow(
                                                        secret.name,
                                                        event.target.checked,
                                                        event.nativeEvent instanceof MouseEvent &&
                                                            event.nativeEvent.shiftKey,
                                                    )
                                                }
                                            />
                                        </label>
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
