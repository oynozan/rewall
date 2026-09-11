// A real EOA behind an EIP-1193 surface, real signatures and real transactions, only the popup is absent

import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

export function headlessWallet({ mnemonic, addressIndex = 0, rpcUrl = RPC } = {}) {
    if (!mnemonic) throw new Error("headlessWallet needs a mnemonic, set REWALL_TEST_MNEMONIC");

    const account = mnemonicToAccount(mnemonic, { addressIndex });
    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
    const calls = { personalSign: 0, typedData: 0, transactions: 0 };

    async function request({ method, params = [] }) {
        switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
                return [account.address];

            case "eth_chainId":
                return `0x${sepolia.id.toString(16)}`;

            case "net_version":
                return String(sepolia.id);

            case "personal_sign":
                calls.personalSign++;
                return account.signMessage({ message: { raw: params[0] } });

            case "eth_signTypedData_v4": {
                calls.typedData++;
                const payload = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
                // viem derives EIP712Domain itself and rejects it being passed back in
                const types = { ...payload.types };
                delete types.EIP712Domain;
                return account.signTypedData({ ...payload, types });
            }

            case "eth_sendTransaction": {
                calls.transactions++;
                const tx = params[0];
                return wallet.sendTransaction({
                    to: tx.to,
                    data: tx.data,
                    value: tx.value ? BigInt(tx.value) : undefined,
                });
            }

            case "wallet_switchEthereumChain":
            case "wallet_addEthereumChain":
                return null;

            default:
                return publicClient.request({ method, params });
        }
    }

    return { account, address: account.address, request, calls };
}

// Installed before any app code runs, so the page finds a provider exactly where it looks for one
export const injectProvider = `(() => {
    const listeners = new Map();
    const provider = {
        isMetaMask: true,
        request: (args) => window.__headlessWalletRequest(args),
        on: (event, handler) => {
            listeners.set(handler, event);
            return provider;
        },
        removeListener: (handler) => {
            listeners.delete(handler);
            return provider;
        },
        emit: (event, payload) => {
            for (const [handler, name] of listeners) if (name === event) handler(payload);
        },
    };
    window.ethereum = provider;
    window.__headlessWallet = provider;

    const announce = () =>
        window.dispatchEvent(
            new CustomEvent("eip6963:announceProvider", {
                detail: Object.freeze({
                    info: {
                        uuid: "00000000-0000-4000-8000-000000000001",
                        name: "Rewall Test Wallet",
                        icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
                        rdns: "dev.rewall.testwallet",
                    },
                    provider,
                }),
            }),
        );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
})();`;

export async function attachWallet(page, wallet) {
    await page.exposeFunction("__headlessWalletRequest", (args) => wallet.request(args));
    await page.addInitScript(injectProvider);
    return wallet;
}
