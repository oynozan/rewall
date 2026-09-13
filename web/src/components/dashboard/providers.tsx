"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { SEPOLIA } from "@/src/lib/vault";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;

export function Providers({ children }: { children: React.ReactNode }) {
    if (!APP_ID) {
        return (
            <div className="config-gate">
                <h1>Rewall is not configured</h1>
                <p>
                    Set <span className="mono">NEXT_PUBLIC_PRIVY_APP_ID</span> in{" "}
                    <span className="mono">web/.env.local</span>, then restart. The template lists every value.
                </p>
            </div>
        );
    }

    return (
        <PrivyProvider
            appId={APP_ID}
            {...(CLIENT_ID ? { clientId: CLIENT_ID } : {})}
            config={{
                // Both surfaces, because an identity derives the same way from either
                loginMethods: ["wallet", "email", "google"],
                // PrivyClientConfig carries no rpcConfig, so the endpoint rides on the chain it is given
                defaultChain: SEPOLIA,
                supportedChains: [SEPOLIA],
                // An embedded wallet is a plain EOA, which is the only kind Rewall can derive a key from
                // Privy's prompt holds one request at a time, so a click that signs then sends crashes its sign screen
                embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
                appearance: {
                    // Rewall's surface tone, because Privy's own dark theme is blue tinted
                    theme: "#1c1c1c",
                    accentColor: "#e5e5de",
                    logo: "/logo.svg",
                    walletChainType: "ethereum-only",
                },
            }}
        >
            {children}
        </PrivyProvider>
    );
}
