"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { GUARDIAN_RECOVERY_PREFIX } from "@rewall/sdk";
import { TYPE_LABELS, type Secret, type SecretType } from "@/src/lib/vault";
import { FadeDots, FadeIn } from "./amicro";
import { useWorkspace } from "./dashboard-shell";
import { Glyph, Icon, type IconName } from "./ui";

// A fixed locale and zone so the server and the browser print the same string
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const MOMENT = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" });

const TYPE_ICONS: Record<string, IconName | undefined> = {
    totp: "authenticator",
    generic: "documents",
    envvar: "documents",
    dburl: "documents",
    webhook: "documents",
    cert: "shield",
    seed: "wallet",
};

const count = (total: number, one: string, many: string) => `${total} ${total === 1 ? one : many}`;

// People and teams are different kinds of access, so the tooltip keeps them apart the way the cell does
function sharedTitle(secret: Secret) {
    const parts: string[] = [];
    if (secret.grantees.length) parts.push(`People ${secret.grantees.join(", ")}`);
    if (secret.subtrees.length) parts.push(`Teams ${secret.subtrees.join(", ")}`);
    return parts.join("\n") || undefined;
}

function sharedWith(secret: Secret) {
    const parts: string[] = [];
    if (secret.grantees.length) parts.push(count(secret.grantees.length, "person", "people"));
    if (secret.subtrees.length) parts.push(count(secret.subtrees.length, "team", "teams"));
    return parts.join(", ");
}

// A prefixed entry resolves to a recovery key on that name, which is the owner's own phrase when it is their name
// Anything else is a plain ENS name holding a wrap of its own, so it is shown as the name it is
function recoveryOf(secret: Secret, ownName: string) {
    const guarded = secret.recovery.filter((entry) => entry.startsWith(GUARDIAN_RECOVERY_PREFIX));
    const named = secret.recovery.filter((entry) => !entry.startsWith(GUARDIAN_RECOVERY_PREFIX));

    if (guarded.some((entry) => entry.slice(GUARDIAN_RECOVERY_PREFIX.length) === ownName)) return "Your phrase";
    if (guarded.length) return "Guardians";
    // Dropped because every name here ends in it, and the suffix is what pushes the cell into an ellipsis
    if (named.length === 1) return named[0]!.replace(/\.eth$/, "");
    return count(named.length, "holder", "holders");
}

export function SecretsPage() {
    const params = useSearchParams();
    const requestedType = params.get("type") || "all";
    const type =
        Object.hasOwn(TYPE_LABELS, requestedType) && !["totp", "receipt"].includes(requestedType)
            ? requestedType
            : "all";
    const { setPanel, isOwnVault } = useWorkspace();
    return (
        <FadeIn className="secrets-page">
            <div className="page-heading">
                <h1>{TYPE_LABELS[type as SecretType] || "Secrets"}</h1>
                <div className="page-actions">
                    <button className="button" onClick={() => setPanel("find")}>
                        Find a secret
                    </button>
                    {isOwnVault && (
                        <button className="button primary" onClick={() => setPanel("create")}>
                            Store a secret
                        </button>
                    )}
                </div>
            </div>
            <SecretsTable key={type} initialType={type} />
        </FadeIn>
    );
}

export function SecretsTable({ compact = false, initialType = "all" }: { compact?: boolean; initialType?: string }) {
    const { vault, busy, error, refresh, setPanel, ownName } = useWorkspace();
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
                    <colgroup>
                        <col className="table-select-col" />
                        <col className="table-name-col" />
                        <col className="table-data-col" />
                        <col className="secrets-access-col" />
                        <col className="secrets-recovery-col" />
                        <col className="secrets-date-col" />
                    </colgroup>
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
                            <th scope="col">Shared with</th>
                            <th scope="col">Recovery</th>
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
                                                <Icon name={TYPE_ICONS[secret.type] ?? "key"} size={20} />
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
                                    <td className="access-cell" title={sharedTitle(secret)}>
                                        {sharedWith(secret) || <span className="unset">Only you</span>}
                                    </td>
                                    <td
                                        className="recovery-cell"
                                        title={
                                            secret.recovery
                                                .map((entry) => entry.replace(GUARDIAN_RECOVERY_PREFIX, ""))
                                                .join(", ") || undefined
                                        }
                                    >
                                        {secret.recovery.length ? (
                                            recoveryOf(secret, ownName)
                                        ) : (
                                            <span className="unset">Not set</span>
                                        )}
                                    </td>
                                    <td className="date-cell">
                                        {secret.created ? (
                                            <time
                                                dateTime={new Date(secret.created * 1000).toISOString()}
                                                title={MOMENT.format(secret.created * 1000)}
                                            >
                                                {DAY.format(secret.created * 1000)}
                                            </time>
                                        ) : (
                                            "—"
                                        )}
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
