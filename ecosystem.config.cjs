/**
 * pm2 config for the Splitwise MCP server.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save                    # remember the process list across reboots
 *   pm2 startup                 # print the OS-specific command to enable boot auto-start
 *
 * Ops:
 *   pm2 logs splitwise-mcp
 *   pm2 restart splitwise-mcp
 *   pm2 stop splitwise-mcp
 *   pm2 reload splitwise-mcp    # graceful (no downtime if cluster mode)
 *
 * NOTE: pm2 cluster mode does NOT work here — the MCP session map in
 * `src/mcp/session.ts` holds live streaming transports that can't be shared
 * across workers. Keep `instances: 1`.
 */

module.exports = {
  apps: [
    {
      name: "splitwise-mcp",
      script: "oauth-mcp.ts",
      // pm2 spawns `bun oauth-mcp.ts`. Needs `bun` on $PATH — if pm2 was
      // installed under root / a different user, hardcode the absolute path
      // you get from `which bun` (e.g. "/home/manojos/.bun/bin/bun").
      interpreter: "bun",
      instances: 1,
      exec_mode: "fork",

      // Bun auto-loads `.env`, so pm2 doesn't need to duplicate it. Override
      // here only if you want pm2-level defaults that beat .env.
      env: {
        NODE_ENV: "production",
      },

      // Restart policy.
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 2000,

      // Memory guard — restart if the process balloons past 512MB.
      max_memory_restart: "512M",

      // Logs. Rotate with `pm2 install pm2-logrotate` if they grow too big.
      out_file: "./logs/out.log",
      error_file: "./logs/err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
