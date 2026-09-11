"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { sepolia } from "viem/chains";
import { RPC_URL } from "@/src/lib/vault";

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
                defaultChain: sepolia,
                supportedChains: [sepolia],
                // An embedded wallet is a plain EOA, which is the only kind Rewall can derive a key from
                embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
                appearance: {
                    theme: "dark",
                    accentColor: "#e5e5de",
                    logo: "/logo.svg",
                    walletChainType: "ethereum-only",
                },
                ...(RPC_URL ? { rpcConfig: { rpcUrlOverrides: { [sepolia.id]: RPC_URL } } } : {}),
            }}
        >
            {children}
        </PrivyProvider>
    );
}
