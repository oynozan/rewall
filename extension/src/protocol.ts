// The one vocabulary the popup, the background, the page relay and the dashboard all speak

// The page never learns the extension id, so every direction is tagged instead of addressed
export const OFFER = "rewall:pair-offer";
export const HANDOFF = "rewall:pair-handoff";

// A scanned seed never rides the URL, so the page asks for it by an id that is good once
export const CLAIM = "rewall:capture-claim";
export const CAPTURE = "rewall:capture";

// The dashboard cannot see the extension any other way, so it asks and the relay is what answers
export const HELLO = "rewall:hello";
export const HERE = "rewall:here";
export const WANT_PAIRING = "rewall:want-pairing";

export type PairOffer = { type: typeof OFFER; nonce: string };
export type PairHandoff = { type: typeof HANDOFF; nonce: string; name: string; secretKey: string };
export type CaptureClaim = { type: typeof CLAIM; id: string };
export type Capture = { type: typeof CAPTURE; uri: string; site: string; error?: string };
export type Here = { type: typeof HERE; paired: boolean; unlocked: boolean; nonce?: string };

export type ToBackground =
    | { type: "rewall:state" }
    | { type: "rewall:paired"; nonce: string; name: string; secretKey: string }
    | { type: "rewall:begin-pairing" }
    | { type: "rewall:request-pairing" }
    | { type: "rewall:unlock"; passphrase: string }
    | { type: "rewall:set-passphrase"; passphrase: string }
    | { type: "rewall:lock" }
    | { type: "rewall:forget" }
    | { type: "rewall:announce"; present: boolean }
    | { type: "rewall:code"; hostname: string }
    | { type: "rewall:seen"; present: boolean }
    | { type: "rewall:begin-crop" }
    | {
          type: "rewall:cropped";
          selection: { x: number; y: number; width: number; height: number; ratio: number } | null;
      }
    | { type: "rewall:hand-capture"; uri: string; site: string }
    | { type: "rewall:claim-capture"; id: string };

export type Status = {
    // No stored wrap at all, versus stored but not open in this browser session
    paired: boolean;
    unlocked: boolean;
    needsPassphrase: boolean;
    name: string;
    accounts: number;
    hostname: string;
    matched: string;
    error: string;
};
