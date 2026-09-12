// A real EOA behind an EIP-1193 surface, real signatures and real transactions, only the popup is absent

import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

// chainId and knownChains default to a wallet already sitting on Sepolia, which is what most checks want
// Pass another pair to model a wallet that has to be asked to add the chain before it can switch
export function headlessWallet({
    mnemonic,
    addressIndex = 0,
    rpcUrl = RPC,
    chainId = sepolia.id,
    knownChains = [sepolia.id],
} = {}) {
    if (!mnemonic) throw new Error("headlessWallet needs a mnemonic, set REWALL_TEST_MNEMONIC");

    const account = mnemonicToAccount(mnemonic, { addressIndex });
    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
    const known = new Set(knownChains);
    const calls = { personalSign: 0, typedData: 0, transactions: 0, addedChains: [], addParams: [] };
    let current = chainId;

    async function request({ method, params = [] }) {
        switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
                return [account.address];

            case "eth_chainId":
                return `0x${current.toString(16)}`;

            case "net_version":
                return String(current);

            case "personal_sign":
                calls.personalSign++;
                return account.signMessage({ message: { raw: params[0] } });

            case "eth_signTypedData_v4": {
                const payload = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
                // What a real wallet answers when the domain names a chain it is not currently on
                if (payload.domain?.chainId !== undefined && Number(payload.domain.chainId) !== current) {
                    const mismatch = new Error("Invalid parameters were provided. Details: CHAIN_ID_MISMATCH");
                    mismatch.code = -32602;
                    throw mismatch;
                }
                calls.typedData++;
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

            // 4902 is the code a real wallet answers with when it has never been told about the chain
            case "wallet_switchEthereumChain": {
                const target = Number(params[0].chainId);
                if (!known.has(target)) {
                    // The code is carried in the text too, because only the message survives the page boundary
                    const refusal = new Error("Unrecognized chain ID 4902, add it with wallet_addEthereumChain first");
                    refusal.code = 4902;
                    throw refusal;
                }
                current = target;
                return null;
            }

            case "wallet_addEthereumChain": {
                const target = Number(params[0].chainId);
                known.add(target);
                calls.addedChains.push(target);
                calls.addParams.push(params[0]);
                current = target;
                return null;
            }

            default:
                return publicClient.request({ method, params });
        }
    }

    // Moves the wallet the way a user does, behind the app's back, so nothing downstream is told about it
    // forget drops the chain as well, which is the wallet a returning session finds when it was never added
    const setChain = (id, { forget } = {}) => {
        if (forget) known.delete(forget);
        known.add(id);
        current = id;
    };

    return { account, address: account.address, request, calls, setChain };
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
