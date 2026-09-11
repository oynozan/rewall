/*
 * SQLite state for the rail. Amounts are uint256 and are stored as decimal strings, since they do
 * not survive a JavaScript number, and every read converts straight back to bigint. Issuing a
 * withdraw ticket debits immediately and the expiry sweep refunds it, which matches the deployed
 * service returning a balance when a ticket goes unredeemed.
 */

import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./config.ts";

const db = new DatabaseSync(DB_PATH);

db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY CHECK (id = 1), last_block TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS balances (
        account TEXT NOT NULL, token TEXT NOT NULL, amount TEXT NOT NULL DEFAULT '0',
        PRIMARY KEY (account, token)
    );
    CREATE TABLE IF NOT EXISTS shielded (address TEXT PRIMARY KEY, account TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS seen_logs (key TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY, seq INTEGER, account TEXT NOT NULL, type TEXT NOT NULL,
        counterparty TEXT, token TEXT NOT NULL, amount TEXT NOT NULL, tx_hash TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tickets (
        nonce INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, token TEXT NOT NULL,
        amount TEXT NOT NULL, deadline INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0
    );
`);

const lower = (value: string) => value.toLowerCase();

/* Indexer cursor */

export function getCursor(): bigint | null {
    const row = db.prepare("SELECT last_block FROM cursor WHERE id = 1").get() as { last_block: string } | undefined;
    return row ? BigInt(row.last_block) : null;
}

export function setCursor(block: bigint) {
    db.prepare("INSERT INTO cursor (id, last_block) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_block = ?").run(
        block.toString(),
        block.toString(),
    );
}

// Returns false when this log was already applied, which keeps a replayed range idempotent
export function claimLog(key: string): boolean {
    try {
        db.prepare("INSERT INTO seen_logs (key) VALUES (?)").run(key);
        return true;
    } catch {
        return false;
    }
}

/* Balances */

export function balanceOf(account: string, token: string): bigint {
    const row = db
        .prepare("SELECT amount FROM balances WHERE account = ? AND token = ?")
        .get(lower(account), lower(token)) as { amount: string } | undefined;
    return BigInt(row?.amount ?? 0);
}

export function balancesOf(account: string) {
    const rows = db
        .prepare("SELECT token, amount FROM balances WHERE account = ? AND amount != '0'")
        .all(lower(account)) as { token: string; amount: string }[];
    return rows.map((r) => ({ token: r.token, amount: r.amount }));
}

export function credit(account: string, token: string, amount: bigint) {
    const next = balanceOf(account, token) + amount;
    db.prepare(
        "INSERT INTO balances (account, token, amount) VALUES (?, ?, ?) ON CONFLICT(account, token) DO UPDATE SET amount = ?",
    ).run(lower(account), lower(token), next.toString(), next.toString());
}

export function debit(account: string, token: string, amount: bigint) {
    const current = balanceOf(account, token);
    if (current < amount) throw new Error("insufficient balance");
    const next = current - amount;
    db.prepare("UPDATE balances SET amount = ? WHERE account = ? AND token = ?").run(
        next.toString(),
        lower(account),
        lower(token),
    );
}

/* Shielded addresses */

export function putShielded(address: string, account: string) {
    db.prepare("INSERT INTO shielded (address, account) VALUES (?, ?)").run(lower(address), lower(account));
}

// Falls back to the address itself so a transfer to a plain address still works
export function resolveShielded(address: string): string {
    const row = db.prepare("SELECT account FROM shielded WHERE address = ?").get(lower(address)) as
        { account: string } | undefined;
    return row?.account ?? lower(address);
}

/* History */

export function recordTransaction(entry: {
    id: string;
    account: string;
    type: string;
    counterparty?: string | null;
    token: string;
    amount: bigint;
    txHash?: string | null;
}) {
    db.prepare(
        "INSERT OR IGNORE INTO transactions (id, seq, account, type, counterparty, token, amount, tx_hash, created_at) VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM transactions), ?, ?, ?, ?, ?, ?, ?)",
    ).run(
        entry.id,
        lower(entry.account),
        entry.type,
        entry.counterparty ? lower(entry.counterparty) : null,
        lower(entry.token),
        entry.amount.toString(),
        entry.txHash ?? null,
        Math.floor(Date.now() / 1000),
    );
}

export function transactionsOf(account: string, limit: number, cursor?: string) {
    const before = cursor
        ? ((db.prepare("SELECT seq FROM transactions WHERE id = ?").get(cursor) as { seq: number } | undefined)?.seq ??
          Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;

    return db
        .prepare(
            "SELECT id, type, account, counterparty, token, amount, tx_hash FROM transactions WHERE account = ? AND seq < ? ORDER BY seq DESC LIMIT ?",
        )
        .all(lower(account), before, limit) as Record<string, unknown>[];
}

/* Withdraw tickets */

export function issueTicket(account: string, token: string, amount: bigint, deadline: number): bigint {
    const result = db
        .prepare("INSERT INTO tickets (account, token, amount, deadline) VALUES (?, ?, ?, ?)")
        .run(lower(account), lower(token), amount.toString(), deadline);
    return BigInt(result.lastInsertRowid as number);
}

export function settleTicket(account: string, token: string, amount: bigint) {
    const row = db
        .prepare("SELECT nonce FROM tickets WHERE account = ? AND token = ? AND amount = ? AND settled = 0 LIMIT 1")
        .get(lower(account), lower(token), amount.toString()) as { nonce: number } | undefined;
    if (row) db.prepare("UPDATE tickets SET settled = 1 WHERE nonce = ?").run(row.nonce);
}

// Refunds tickets that expired without being redeemed on chain
export function refundExpiredTickets(now: number): number {
    const rows = db
        .prepare("SELECT nonce, account, token, amount FROM tickets WHERE settled = 0 AND deadline < ?")
        .all(now) as { nonce: number; account: string; token: string; amount: string }[];

    for (const row of rows) {
        credit(row.account, row.token, BigInt(row.amount));
        db.prepare("UPDATE tickets SET settled = 1 WHERE nonce = ?").run(row.nonce);
    }
    return rows.length;
}
