// The chart is drawn from receipts the reader has opened, so this is where the bucketing has to be right

import assert from "node:assert/strict";
import { volumeOf } from "../src/lib/volume.ts";

const DAY = 86400000;
const NOW = Date.UTC(2026, 0, 31, 13, 30);
const USDC = { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", symbol: "USDC", decimals: 6 };

// A receipt is public metadata plus a payload that only a key holder can read
const at = (name, daysAgo) => ({ name, created: Math.floor((NOW - daysAgo * DAY) / 1000), type: "receipt" });
const paid = (amount, token = USDC.address) => ({
    v: 1,
    amount,
    token,
    counterparty: "bob.eth",
    tx: "0x",
    direction: "sent",
});

const sent = [at("a.rewall.alice.eth", 0), at("b.rewall.alice.eth", 0), at("c.rewall.alice.eth", 29)];
const shared = [at("d.rewall.bob.eth", 1)];

/* Nothing open reads as no chart, which is what lets the card offer to open them */
assert.equal(volumeOf(sent, shared, {}, USDC, NOW), null, "a closed receipt cannot be plotted");
assert.equal(volumeOf([], [], {}, null, NOW), null, "no token means no units to plot in");

const receipts = {
    "a.rewall.alice.eth": paid("1500000"),
    "b.rewall.alice.eth": paid("2500000"),
    "c.rewall.alice.eth": paid("1000000"),
    "d.rewall.bob.eth": paid("4000000"),
};
const volume = volumeOf(sent, shared, receipts, USDC, NOW);

assert.equal(volume.points.length, 30, "thirty days means thirty points");
assert.equal(volume.asset, "USDC");
assert.equal(volume.sentTotal, "5 USDC", "three sent receipts sum in whole tokens");
assert.equal(volume.sharedTotal, "4 USDC");

// Same day lands in one bucket, and today is the last point rather than the first
assert.equal(volume.points.at(-1).sent, 4, "two receipts today sum into today");
assert.equal(volume.points.at(-2).shared, 4, "a receipt from yesterday lands a day back");
assert.equal(volume.points[0].sent, 1, "twenty nine days ago is the first point");
assert.equal(
    volume.points.reduce((sum, point) => sum + point.sent, 0),
    5,
    "every sent receipt inside the window is plotted once",
);

// A receipt older than the window still counts toward the total, since the total is not the plot
const older = [...sent, at("e.rewall.alice.eth", 45)];
const wider = volumeOf(older, shared, { ...receipts, "e.rewall.alice.eth": paid("9000000") }, USDC, NOW);
assert.equal(wider.sentTotal, "14 USDC");
assert.equal(
    wider.points.reduce((sum, point) => sum + point.sent, 0),
    5,
    "a receipt off the left edge is not folded into the first day",
);

// Base units only mean something per token, so another one is counted nowhere
const mixed = volumeOf(sent, shared, { ...receipts, "a.rewall.alice.eth": paid("1500000", "0xdead") }, USDC, NOW);
assert.equal(mixed.sentTotal, "3.5 USDC", "a receipt in another token is left out of the sum");

console.log("ok thirty daily buckets, totals in whole tokens, and no foreign token in the sum");
