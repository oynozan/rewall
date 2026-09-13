/**
 * mcp.rewall.me, the Rewall MCP server under pm2
 *
 * cjs rather than mjs because pm2 loads this file with require, and the package is type module.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup          # prints one command to run, which brings pm2 back after a reboot
 *   pm2 logs rewall-mcp
 *
 * It binds loopback only, because nginx is what faces the network. A shared host holds no identity of
 * its own, so REWALL_NAME and REWALL_IDENTITY_SEED stay unset and every caller sends their own.
 */

module.exports = {
    apps: [
        {
            name: "rewall-mcp",
            script: "src/http.ts",
            interpreter: "node",
            interpreter_args: "--experimental-strip-types",
            cwd: __dirname,

            // Fork with one instance, because the rate limit counters live in the process
            // Cluster mode would run N of them and quietly multiply every limit by N
            exec_mode: "fork",
            instances: 1,

            env: {
                NODE_ENV: "production",
                PORT: 8787,
                REWALL_MCP_HOST: "127.0.0.1",

                // Without this the proxy's own loopback socket reads as the caller, which hands a
                // stranger the fallback credentials and counts every caller as one peer
                REWALL_TRUST_PROXY: "1",

                // DNS rebinding protection checks the Host header, and behind nginx that is the
                // public name, so a missing entry here refuses every real request
                REWALL_ALLOWED_HOSTS: "mcp.rewall.me",
            },

            autorestart: true,
            restart_delay: 2000,
            max_memory_restart: "256M",

            // Timestamped and kept apart, so a restart loop is readable after the fact
            time: true,
            merge_logs: false,
        },
    ],
};
