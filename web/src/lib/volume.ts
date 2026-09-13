import { formatUnits } from "viem";
import type { Receipt } from "@rewall/sdk";
import type { Secret } from "./vault";

export type VolumePoint = { label: string; sent: number; shared: number };
export type TransferVolume = { asset: string; sentTotal: string; sharedTotal: string; points: VolumePoint[] };
export type VolumeToken = { address: string; symbol: string; decimals: number };

const DAY = 86400000;
const DAYS = 30;
const AXIS = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

/* One point a day for the last thirty, summed from the receipts that are open */
export function volumeOf(
    sent: Secret[],
    shared: Secret[],
    receipts: Record<string, Receipt>,
    token: VolumeToken | null,
    now = Date.now(),
): TransferVolume | null {
    if (!token) return null;
    const first = Math.floor(now / DAY) * DAY - (DAYS - 1) * DAY;
    const walk = (rows: Secret[]) => {
        const days = new Array<bigint>(DAYS).fill(BigInt(0));
        let total = BigInt(0);
        let opened = 0;
        for (const secret of rows) {
            const receipt = receipts[secret.name];
            if (!receipt) continue;
            opened++;
            // Another token's base units are not this one's, so summing them would make a wrong number
            if (receipt.token.toLowerCase() !== token.address.toLowerCase()) continue;
            const amount = BigInt(receipt.amount);
            total += amount;
            const day = Math.floor(((secret.created ?? 0) * 1000 - first) / DAY);
            if (day >= 0 && day < DAYS) days[day] += amount;
        }
        return { days, total, opened };
    };

    const out = walk(sent);
    const back = walk(shared);
    // Nothing open is not the same as nothing sent, and the caller offers to open them
    if (out.opened + back.opened === 0) return null;
    const plot = (value: bigint) => Number(formatUnits(value, token.decimals));
    return {
        asset: token.symbol,
        sentTotal: `${formatUnits(out.total, token.decimals)} ${token.symbol}`,
        sharedTotal: `${formatUnits(back.total, token.decimals)} ${token.symbol}`,
        points: out.days.map((value, index) => ({
            label: AXIS.format(first + index * DAY),
            sent: plot(value),
            shared: plot(back.days[index]!),
        })),
    };
}
