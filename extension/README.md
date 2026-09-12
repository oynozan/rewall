# Rewall 2FA

A browser extension that fills sign-in codes. The codes come from 2FA secrets stored under your ENS
name. One build works in Chrome and one in Firefox.

## How it works

You pair it once from the dashboard. The dashboard hands over your derived key, and the extension
stores it wrapped under a passphrase. This is the one place in Rewall a key is stored, because a page
action cannot ask your wallet to sign every time you log in somewhere.

After that, on a sign-in page, it finds the field a code goes into, works out which of your accounts
matches the site, computes the code and types it in. Clicking the toolbar button fills the code. If
no field is found, it opens a small menu instead.

Nothing is sent to a Rewall server, because there is none. The extension reads your secrets straight
from Sepolia and computes codes locally.

## The pieces

| File                          | What it does                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `src/detect.ts`               | Finds the code field on a page. Pure DOM, no extension APIs.                 |
| `src/fill.ts`                 | Types a code into that field so the page's own code sees it.                 |
| `src/capture.ts`              | Works out the hostname a code is for, from the tab rather than the frame.    |
| `src/lock.ts`                 | Holds the key, wrapped by a passphrase on disk, in the clear only in memory. |
| `src/vault.ts`                | Reads the paired vault and gives one account per hostname.                   |
| `src/protocol.ts`             | The messages the popup, background, page relay and dashboard all use.        |
| `entrypoints/background.ts`   | Keeps the unlocked key for a short time, then drops it.                      |
| `entrypoints/otp.content.ts`  | Runs on pages. Detects the field and fills it.                               |
| `entrypoints/pair.content.ts` | Runs on the dashboard. Relays the pairing between page and extension.        |
| `entrypoints/popup/`          | The toolbar window. Shows accounts and hands any write to the dashboard.     |

The field detection uses the same pattern Chromium itself uses to spot one time code fields. Filling
uses `insertText`, so the page's own event handlers run and a React controlled input updates its
state, not just its DOM.

## Building

```bash
pnpm install
pnpm run build             # Chrome, into .output/chrome-mv3
pnpm run build:firefox     # Firefox, into .output/firefox-mv3
pnpm run zip               # a file to upload
```

Load it unpacked from `.output/` while developing. `pnpm run dev` rebuilds on change.

## Checking it

```bash
pnpm test                  # unit tests on the lock
pnpm run check             # two scripts against a real browser
pnpm run lint:firefox      # Firefox's own linter, zero warnings allowed
```

The first check script bundles `detect.ts` and `fill.ts` and runs them on real page markup with no
extension loaded. It asserts seven kinds of code field are found and seven lookalikes, such as a
card security code, are refused. The second loads the built extension into a real Chromium profile
and walks through pairing, locking, filling and refusing a bad pairing request.

## Limits

The key on disk is protected by your passphrase and nothing else. Anyone who reads the extension's
storage and knows the passphrase can read every secret shared with you. The dashboard never has this
problem, because it never stores the key. This is the trade the extension makes so it can fill a code
without a wallet prompt.
