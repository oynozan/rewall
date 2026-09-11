import { english, generateMnemonic, mnemonicToAccount } from "viem/accounts";
import { identityFromAccount, type Identity } from "@rewall/sdk";

// A recovery holder is just another Rewall identity, so the kit reuses the derivation every wallet uses
// rather than inventing a second way to make an X25519 key
export const newRecoveryPhrase = () => generateMnemonic(english, 256);

export const normalizePhrase = (phrase: string) => phrase.trim().toLowerCase().split(/\s+/).join(" ");

export async function recoveryIdentity(phrase: string): Promise<Identity> {
    return identityFromAccount(mnemonicToAccount(normalizePhrase(phrase)));
}

// Grouped so someone copying it onto paper can keep their place
export function phraseRows(phrase: string, perRow = 4): string[][] {
    const words = normalizePhrase(phrase).split(" ");
    return Array.from({ length: Math.ceil(words.length / perRow) }, (_, row) =>
        words.slice(row * perRow, row * perRow + perRow),
    );
}
