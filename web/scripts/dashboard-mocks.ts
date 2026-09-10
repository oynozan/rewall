import { SCHEMA_VERSION } from "@rewall/sdk";
import type { Secret, Vault } from "../src/lib/vault";
import type { TransferVolume } from "../src/components/dashboard/volume-chart";

const preference = process.env.NEXT_PUBLIC_REWALL_MOCKS;
export const MOCKS_ENABLED = preference === "on" || (preference !== "off" && process.env.NODE_ENV === "development");
const owner = "demo.eth";
const created = Date.UTC(2026, 8, 10, 12) / 1000;

function secret(label: string, type: string, daysAgo = 0): Secret {
    return {
        name: `${label}.rewall.${owner}`,
        label,
        type,
        encryption: "aes-256-gcm",
        created: created - daysAgo * 86400,
        allow: [],
        version: SCHEMA_VERSION,
        owner,
        grantees: [],
        site: "",
    };
}

export const mockSecrets = [
    secret("github-token", "apikey"),
    secret("database", "generic", 1),
    secret("openai", "apikey", 2),
    secret("deployment-key", "privkey", 4),
    secret("recovery-note", "generic", 7),
    secret("stripe", "apikey", 10),
];
export const mockOtpAccounts = [
    { secret: secret("github", "totp"), issuer: "GitHub", label: "hello@example.com", algorithm: "SHA1" },
    { secret: secret("aws", "totp", 3), issuer: "AWS", label: "Personal account", algorithm: "SHA256" },
    { secret: secret("vercel", "totp", 6), issuer: "Vercel", label: "hello@example.com", algorithm: "SHA512" },
];

/* RFC 6238 public test material, never an enrolled account seed */
export function mockOtpBytes(name: string) {
    const account = mockOtpAccounts.find((entry) => entry.secret.name === name);
    if (!account) throw new Error("No mock authenticator at this name.");
    return new TextEncoder().encode(
        `otpauth://totp/${encodeURIComponent(account.issuer + ":" + account.label)}?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=${encodeURIComponent(account.issuer)}&algorithm=${account.algorithm}&digits=6&period=30`,
    );
}

export const mockTransfers = {
    sent: [
        {
            secret: { ...secret("design-payment", "receipt"), grantees: ["alice.eth"] },
            counterparty: "alice.eth",
            amount: "1,250.00 USDC",
        },
        {
            secret: { ...secret("project-deposit", "receipt", 2), grantees: ["studio.eth"] },
            counterparty: "studio.eth",
            amount: "800.00 USDC",
        },
        {
            secret: { ...secret("consulting", "receipt", 5), grantees: ["alex.eth"] },
            counterparty: "alex.eth",
            amount: "420.00 USDC",
        },
        {
            secret: { ...secret("monthly-payment", "receipt", 8), grantees: ["sam.eth"] },
            counterparty: "sam.eth",
            amount: "650.00 USDC",
        },
    ],
    shared: [
        {
            secret: { ...secret("development", "receipt", 1), owner: "alex.eth", name: "development.rewall.alex.eth" },
            counterparty: "alex.eth",
            amount: "2,400.00 USDC",
        },
        {
            secret: { ...secret("services", "receipt", 4), owner: "studio.eth", name: "services.rewall.studio.eth" },
            counterparty: "studio.eth",
            amount: "350.00 USDC",
        },
        {
            secret: { ...secret("equipment", "receipt", 7), owner: "alice.eth", name: "equipment.rewall.alice.eth" },
            counterparty: "alice.eth",
            amount: "180.00 USDC",
        },
    ],
};

export const mockVault: Vault = {
    owner,
    namespace: `rewall.${owner}`,
    identityPublished: true,
    secrets: [
        ...mockSecrets,
        ...mockOtpAccounts.map((entry) => entry.secret),
        ...mockTransfers.sent.map((entry) => entry.secret),
    ],
};

const sentVolume = [
    120, 0, 230, 140, 310, 80, 0, 240, 350, 120, 420, 275, 150, 0, 480, 325, 600, 400, 720, 510, 320, 650, 0, 0, 420, 0,
    0, 800, 0, 1250,
];
const sharedVolume = [
    0, 180, 120, 0, 260, 160, 90, 0, 320, 180, 120, 360, 280, 150, 0, 480, 320, 650, 460, 300, 240, 0, 180, 0, 0, 350,
    0, 0, 2400, 0,
];

for (const direction of ["sent", "shared"] as const) {
    const daily = direction === "sent" ? sentVolume : sharedVolume;
    for (let index = 20; index >= 0; index--) {
        if (!daily[index]) continue;
        const counterparty = ["alice.eth", "studio.eth", "alex.eth", "sam.eth"][index % 4];
        const receipt = secret("payment-" + (index + 1).toString().padStart(2, "0"), "receipt", 29 - index);
        if (direction === "sent") receipt.grantees = [counterparty];
        else {
            receipt.owner = counterparty;
            receipt.name = receipt.label + ".rewall." + counterparty;
        }
        mockTransfers[direction].push({
            secret: receipt,
            counterparty,
            amount: daily[index].toLocaleString("en-US", { minimumFractionDigits: 2 }) + " USDC",
        });
    }
}
mockVault.secrets = [
    ...mockSecrets,
    ...mockOtpAccounts.map((entry) => entry.secret),
    ...mockTransfers.sent.map((entry) => entry.secret),
];

export const mockVolume: TransferVolume = {
    asset: "USDC",
    sentTotal: sentVolume
        .reduce((total, value) => total + value, 0)
        .toLocaleString("en-US", { minimumFractionDigits: 2 }),
    sharedTotal: sharedVolume
        .reduce((total, value) => total + value, 0)
        .toLocaleString("en-US", { minimumFractionDigits: 2 }),
    points: sentVolume.map((sent, index) => ({
        label: new Date((created - (29 - index) * 86400) * 1000).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
        }),
        sent,
        shared: sharedVolume[index],
    })),
};
