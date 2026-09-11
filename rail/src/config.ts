/* Configuration for the local private transfer rail, all overridable from the environment */

// Signs withdraw tickets and never holds funds or pays gas, so it stays off the participant indices
export const TICKET_SIGNER_INDEX = Number(process.env.TICKET_SIGNER_INDEX ?? 6);

// Deploys the contracts and holds the minted supply
export const DEPLOYER_INDEX = Number(process.env.DEPLOYER_INDEX ?? 0);

// Redeems a withdraw ticket, which is the only leg a participant pays gas for
export const REDEEMER_INDEX = Number(process.env.REDEEMER_INDEX ?? 1);

export const PORT = Number(process.env.RAIL_PORT ?? 8787);

// Blocks to wait before crediting a deposit, raise it to reproduce the finality delay of the real service
export const CONFIRMATIONS = BigInt(process.env.CONFIRMATIONS ?? 1);

// How long a withdraw ticket stays redeemable, matching the demo's one hour
export const TICKET_TTL_SECONDS = Number(process.env.TICKET_TTL_SECONDS ?? 3600);

export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);

// A signed request older than this is refused, which bounds replay of a captured signature
export const MAX_REQUEST_AGE_SECONDS = Number(process.env.MAX_REQUEST_AGE_SECONDS ?? 300);

export const DB_PATH = process.env.RAIL_DB ?? new URL("../rail.db", import.meta.url).pathname;

export const vaultAddress = () => {
    const address = process.env.VAULT_ADDRESS;
    if (!address) throw new Error("VAULT_ADDRESS is not set, run pnpm run deploy first");
    return address as `0x${string}`;
};

export const tokenAddress = () => {
    const address = process.env.TOKEN_ADDRESS;
    if (!address) throw new Error("TOKEN_ADDRESS is not set, run pnpm run deploy first");
    return address as `0x${string}`;
};

export const rpcUrl = () => {
    const rpc = process.env.SEPOLIA_RPC_URL;
    if (!rpc) throw new Error("SEPOLIA_RPC_URL is not set");
    return rpc;
};
