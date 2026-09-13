import { defineConfig } from "wxt";

export default defineConfig({
    // WXT targets MV2 for Firefox unless told otherwise, which would ship a different extension than the one tested
    manifestVersion: 3,

    // Named for what a person downloads, not for the package that produced it
    zip: { name: "rewall-2fa" },
    manifest: ({ browser }) => ({
        name: "Rewall 2FA",
        description: "Fill sign-in codes from secrets stored under your ENS name.",
        permissions: ["storage", "activeTab"],
        host_permissions: ["<all_urls>"],

        // The default spanning mode would serve incognito tabs from the same worker and the same unlocked key
        incognito: "not_allowed",

        content_security_policy: {
            extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
        },

        commands: {
            _execute_action: {
                suggested_key: { default: "Alt+Shift+O" },
                description: "Fill a sign-in code, or open Rewall",
            },
        },

        // No externally_connectable, because Firefox has no web page half of it and Chrome's needs a published id
        // Pairing relays through a content script on the same origins instead, which both browsers run identically

        ...(browser === "firefox"
            ? {
                  browser_specific_settings: {
                      gecko: {
                          id: "2fa@rewall.me",
                          // 140 is where Firefox's own data collection consent lands, so no custom flow is needed
                          strict_min_version: "140.0",
                          // Nothing reaches a Rewall server because there is none, so nothing is collected
                          data_collection_permissions: { required: ["none"] },
                      },
                      // Android got the consent system two releases after desktop, so it carries its own floor
                      gecko_android: { strict_min_version: "142.0" },
                  },
              }
            : {}),
    }),
});
