import type { Secret, Vault } from "../src/lib/vault";
import type { TransferVolume } from "../src/components/dashboard/volume-chart";

export const MOCKS_ENABLED = process.env.NODE_ENV === "development";
const owner = "demo.eth";
const created = Date.UTC(2026, 8, 10, 12) / 1000;

function secret(label: string, type: string, daysAgo = 0): Secret {
    return { name: `${label}.rewall.${owner}`, label, type, encryption: "aes-256-gcm", created: created - daysAgo * 86400, allow: [], version: "2", owner, grantees: [], site: "" };
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
    return new TextEncoder().encode(`otpauth://totp/${encodeURIComponent(account.issuer + ":" + account.label)}?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=${encodeURIComponent(account.issuer)}&algorithm=${account.algorithm}&digits=6&period=30`);
}

export const mockTransfers = {
    sent: [
        { secret: { ...secret("design-payment", "receipt"), grantees: ["alice.eth"] }, counterparty: "alice.eth", amount: "1,250.00 USDC" },
        { secret: { ...secret("project-deposit", "receipt", 2), grantees: ["studio.eth"] }, counterparty: "studio.eth", amount: "800.00 USDC" },
        { secret: { ...secret("consulting", "receipt", 5), grantees: ["alex.eth"] }, counterparty: "alex.eth", amount: "420.00 USDC" },
        { secret: { ...secret("monthly-payment", "receipt", 8), grantees: ["sam.eth"] }, counterparty: "sam.eth", amount: "650.00 USDC" },
    ],
    shared: [
        { secret: { ...secret("development", "receipt", 1), owner: "alex.eth", name: "development.rewall.alex.eth" }, counterparty: "alex.eth", amount: "2,400.00 USDC" },
        { secret: { ...secret("services", "receipt", 4), owner: "studio.eth", name: "services.rewall.studio.eth" }, counterparty: "studio.eth", amount: "350.00 USDC" },
        { secret: { ...secret("equipment", "receipt", 7), owner: "alice.eth", name: "equipment.rewall.alice.eth" }, counterparty: "alice.eth", amount: "180.00 USDC" },
    ],
};

export const mockVault: Vault = {
    owner,
    namespace: `rewall.${owner}`,
    identityPublished: true,
    secrets: [...mockSecrets, ...mockOtpAccounts.map((entry) => entry.secret), ...mockTransfers.sent.map((entry) => entry.secret)],
};

const sentVolume = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 650, 0, 0, 420, 0, 0, 800, 0, 1250];
const sharedVolume = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 180, 0, 0, 350, 0, 0, 2400, 0];
export const mockVolume: TransferVolume = {
    asset: "USDC",
    sentTotal: "3,120.00",
    sharedTotal: "2,930.00",
    points: sentVolume.map((sent, index) => ({ label: new Date((created - (29 - index) * 86400) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }), sent, shared: sharedVolume[index] })),
};
