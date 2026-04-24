/**
 * Entry point for the Splitwise MCP server.
 *
 * This file owns nothing but the HTTP routing table. Every handler lives in
 * a focused module under `src/` and can be read/edited in isolation.
 *
 * High-level flow (see `src/oauth/routes.ts` for the full picture):
 *
 *    MCP client --/authorize--> us --redirect--> Splitwise (user logs in)
 *                                      |
 *                                      v
 *            Splitwise --/auth/splitwise/callback--> us (receives Splitwise code)
 *                                      |
 *                                      v
 *                    us --redirect--> MCP client's redirect_uri?code=OURCODE
 *                                      |
 *                                      v
 *                    MCP client --/token-- us --> { access_token: OURBEARER }
 *
 * Our bearer token is mapped 1:1 to the user's Splitwise access token, which
 * the tool handlers use to call the Splitwise API on the user's behalf.
 *
 * Endpoints:
 *   GET  /                                          - landing page
 *   GET  /.well-known/oauth-authorization-server    - AS metadata
 *   GET  /.well-known/oauth-protected-resource      - PR metadata (MCP)
 *   GET  /authorize                                 - redirects to Splitwise
 *   GET  /auth/splitwise/callback                   - receives Splitwise code
 *   POST /token                                     - exchanges our code for our bearer
 *   GET  /callback-demo                             - built-in demo client
 *   *    /mcp                                       - MCP endpoint (bearer required)
 */

import { BASE_URL, PORT, REDIS_URL, SPLITWISE_REDIRECT_URI } from "./src/config";
import { log } from "./src/logger";
import { handleMcp } from "./src/mcp/session";
import "dotenv/config";
import { demoCallback, landingPage } from "./src/oauth/pages";
import {
  authorizationServerMetadata,
  handleAuthorize,
  handleSplitwiseCallback,
  handleToken,
  protectedResourceMetadata,
} from "./src/oauth/routes";
import { redisInit } from "./src/redis";

// Fail fast if Redis is unreachable — all persistent state (OAuth codes,
// bearer tokens, response cache) depends on it.
try {
  await redisInit();
} catch (err) {
  console.error(
    `\nFailed to connect to Redis at ${REDIS_URL}. Is it running?\n` +
      `  macOS: brew services start redis\n` +
      `  linux: sudo systemctl start redis\n` +
      `Override REDIS_URL in .env if Redis is elsewhere.\n`
  );
  console.error(err);
  process.exit(1);
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    log(`HTTP ${req.method} ${url.pathname}${url.search}`);

    // --- Static / discovery ---
    if (url.pathname === "/" && req.method === "GET") {
      return landingPage();
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return authorizationServerMetadata();
    }
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return protectedResourceMetadata();
    }

    // --- OAuth dance ---
    if (url.pathname === "/authorize" && req.method === "GET") {
      return handleAuthorize(url);
    }
    if (url.pathname === "/auth/splitwise/callback" && req.method === "GET") {
      return handleSplitwiseCallback(url);
    }
    if (url.pathname === "/token" && req.method === "POST") {
      return handleToken(req);
    }

    // --- Demo MCP client (browser) ---
    if (url.pathname === "/callback-demo" && req.method === "GET") {
      return demoCallback(url);
    }

    // --- Protected MCP endpoint ---
    if (url.pathname === "/mcp") {
      return handleMcp(req);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`
Splitwise MCP server running:
  local:  http://localhost:${PORT}
  public: ${BASE_URL}
Splitwise redirect_uri (must match your app's registered URL):
  ${SPLITWISE_REDIRECT_URI}
`);
