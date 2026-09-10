# Transfer integration

The dashboard has Home, Secrets, 2FA and Transfers routes. Receipt parsing and the shared-transfer feed remain with the transfer implementation agent; no receipt schema or discovery API has been invented in the web client.

- `src/components/dashboard/transfers.tsx` currently displays public metadata for receipt secrets in the open vault under Sent. Shared shows an unavailable state until its authorized feed is connected. Replace this metadata-only source with the transfer feed and its confirmed direction semantics.
- `src/components/dashboard/terminal-overview.tsx` has sent/shared counts. Shared and monetary totals are unknown, never treated as zero.
- `src/components/dashboard/volume-chart.tsx` accepts a presentation-only `TransferVolume` prop: `asset`, exact formatted `sentTotal` / `sharedTotal`, and daily `points` containing `label`, `sent`, `shared`. This is a chart view model, not a serialized receipt format. Supply 30 daily buckets for the selected asset. Keep exact amounts as integers/decimal strings upstream; convert only plotted values to numbers. Never combine assets or substitute USD without an actual price source.
- `src/components/dashboard/private-data.tsx` retains decrypted OTP accounts in memory. Wallet or vault changes remount it and wipe seed buffers. Reuse that lifecycle for private transfer data when integrating the feed. `decryptSecret` in the workspace signs only after an explicit user action and clears its derived SDK identity after use.

`node scripts/check-dashboard.mjs` checks the live vault and all four routes. `node scripts/check-otp.mjs` runs an isolated browser fixture using the public RFC 6238 seed and chart test values; these never appear on dashboard routes. Both save screenshots and results under the ignored `artifacts/dashboard/` directory. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if Chromium is installed outside Playwright's default location.
