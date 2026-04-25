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
 *   GET  /.well-known/oauth-authorization-server    - AS metadata (+ path-variants)
 *   GET  /.well-known/oauth-protected-resource      - PR metadata (+ path-variants)
 *   GET  /authorize                                 - redirects to Splitwise
 *   GET  /auth/splitwise/callback                   - receives Splitwise code
 *   POST /token                                     - exchanges our code for our bearer (PKCE verified)
 *   POST /register                                  - RFC 7591 Dynamic Client Registration
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
  handleRegister,
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

    // OAuth 2.1 Authorization Server metadata (RFC 8414).
    // Our resource lives at `${BASE_URL}/mcp`, so RFC 8414-compliant clients
    // try the path-suffixed variant. A few clients also try the path-prefixed
    // variant (`/mcp/.well-known/...`). We serve the same payload from all of
    // them so discovery converges in a single hop instead of cascading through
    // 404s that make clients drop their bearer and re-run the OAuth dance.
    if (
      url.pathname === "/.well-known/oauth-authorization-server" ||
      url.pathname === "/.well-known/oauth-authorization-server/mcp" ||
      url.pathname === "/mcp/.well-known/oauth-authorization-server"
    ) {
      return authorizationServerMetadata();
    }

    // Protected-Resource metadata (RFC 9728). Same reasoning as above.
    if (
      url.pathname === "/.well-known/oauth-protected-resource" ||
      url.pathname === "/.well-known/oauth-protected-resource/mcp" ||
      url.pathname === "/mcp/.well-known/oauth-protected-resource"
    ) {
      return protectedResourceMetadata();
    }

    // Some clients probe OpenID Connect discovery before falling back to
    // plain OAuth. We're not an OIDC provider, but replying 404 JSON quickly
    // (instead of a generic text "Not found") makes clients give up in one
    // step and move on to the OAuth metadata they should be using.
    if (
      url.pathname === "/.well-known/openid-configuration" ||
      url.pathname === "/.well-known/openid-configuration/mcp" ||
      url.pathname === "/mcp/.well-known/openid-configuration"
    ) {
      return new Response(
        JSON.stringify({ error: "not_an_openid_provider" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
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
    if (url.pathname === "/register" && req.method === "POST") {
      return handleRegister(req);
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
splitMCP server running:
  local:  http://localhost:${PORT}
  public: ${BASE_URL}
Splitwise redirect_uri (must match your app's registered URL):
  ${SPLITWISE_REDIRECT_URI}
`);
