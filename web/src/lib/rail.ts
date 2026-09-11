import { isAddress, type Address } from "viem";
import { Transfers, type TransferSigner } from "@rewall/sdk";

// ponytail: relative because only client components call this, a server caller would need an origin
export const RAIL_API = "/api/rail";

// Transfers falls back to Chainlink's deployment, which credits nothing, so an unset address must throw
function required(name: string, value: string | undefined): Address {
    if (!value || !isAddress(value)) {
        throw new Error(`${name} is not set, run pnpm run deploy in rail and paste the printed block in`);
    }
    return value;
}

export const railVault = () => required("NEXT_PUBLIC_REWALL_VAULT", process.env.NEXT_PUBLIC_REWALL_VAULT);

// Circle's Sepolia USDC, a fixed network address like the resolver rather than a per deploy setting
export const RAIL_TOKEN = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address;

// The only place the web constructs a Transfers, which is what makes the silent fallback unreachable
export const railFor = (account: TransferSigner) => new Transfers({ account, api: RAIL_API, vault: railVault() });
