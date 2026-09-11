/*
 * Watches the rail's vault and moves chain events into the off chain ledger. Deposits credit a
 * balance once they are CONFIRMATIONS blocks deep, and Withdraw events settle the ticket that
 * produced them so the expiry sweep cannot refund a balance that already left the vault.
 */

import { createPublicClient, http, parseAbiItem } from "viem";
import { sepolia } from "viem/chains";
import { CONFIRMATIONS, POLL_INTERVAL_MS, rpcUrl, vaultAddress } from "./config.ts";
import { claimLog, credit, getCursor, recordTransaction, refundExpiredTickets, setCursor, settleTicket } from "./db.ts";

const DEPOSIT = parseAbiItem("event Deposit(address indexed user, address indexed token, uint256 amount)");
const WITHDRAW = parseAbiItem(
    "event Withdraw(address indexed user, address indexed token, uint256 amount, bytes32 indexed withdrawTicketHash)",
);

// Public RPCs cap getLogs ranges, so a cold start walks forward in chunks rather than one query
const CHUNK = 5000n;

const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl()) });

async function scan(from: bigint, to: bigint) {
    const vault = vaultAddress();

    for (const event of [DEPOSIT, WITHDRAW]) {
        const logs = await client.getLogs({ address: vault, event, fromBlock: from, toBlock: to });

        for (const log of logs) {
            const key = `${log.transactionHash}:${log.logIndex}`;
            if (!claimLog(key)) continue;

            const { user, token, amount } = log.args as { user: string; token: string; amount: bigint };

            if (event === DEPOSIT) {
                credit(user, token, amount);
                recordTransaction({
                    id: key,
                    account: user,
                    type: "deposit",
                    token,
                    amount,
                    txHash: log.transactionHash,
                });
                console.log(`credited ${amount} of ${token} to ${user}`);
            } else {
                settleTicket(user, token, amount);
                recordTransaction({
                    id: key,
                    account: user,
                    type: "withdraw",
                    token,
                    amount,
                    txHash: log.transactionHash,
                });
                console.log(`settled withdrawal of ${amount} for ${user}`);
            }
        }
    }
}

export function startIndexer() {
    let running = false;

    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const head = await client.getBlockNumber();
            const safe = head - CONFIRMATIONS;
            let from = getCursor();

            if (from === null) {
                from = process.env.RAIL_START_BLOCK ? BigInt(process.env.RAIL_START_BLOCK) : safe;
                setCursor(from - 1n);
            }
            from = getCursor()! + 1n;

            while (from <= safe) {
                const to = from + CHUNK - 1n > safe ? safe : from + CHUNK - 1n;
                await scan(from, to);
                setCursor(to);
                from = to + 1n;
            }

            const refunded = refundExpiredTickets(Math.floor(Date.now() / 1000));
            if (refunded) console.log(`refunded ${refunded} expired ticket(s)`);
        } catch (error) {
            console.error("indexer error", (error as Error).message);
        } finally {
            running = false;
        }
    };

    void tick();
    return setInterval(tick, POLL_INTERVAL_MS);
}
