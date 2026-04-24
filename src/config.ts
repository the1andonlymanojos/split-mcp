/**
 * Central configuration.
 *
 * All environment variables and constants used across the app live here so
 * the rest of the code never reads `Bun.env` directly.
 *
 * Override any of these at launch, e.g.:
 *   BASE_URL=https://manojs-macbook-air.stoat-toad.ts.net bun run oauth-mcp.ts
 */

export const PORT = Number(process.env.PORT ?? 7021);

/**
 * Public base URL of this server. Used as the OAuth issuer, the resource URL,
 * and to build the Splitwise redirect URI.
 *
 * When running behind a tunnel (ngrok / Tailscale funnel / etc.) set this to
 * the public URL so OAuth redirects work end-to-end.
 */
export const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Splitwise OAuth app credentials. Create one at:
 *   https://secure.splitwise.com/apps
 *
 * The "Callback URL" registered on the Splitwise app MUST equal
 * `${BASE_URL}/auth/splitwise/callback`.
 */
export const SPLITWISE_CLIENT_ID =
process.env.SPLITWISE_CLIENT_ID ?? "tSynJUXEQPlKwsd6OzeIOcIEJxKAgoEpLspm8oEK";
export const SPLITWISE_CLIENT_SECRET =
process.env.SPLITWISE_CLIENT_SECRET ?? "UA7SjONqHyDy7S4R88pxA1AOdIPat4uii91uCuV1";
export const SPLITWISE_REDIRECT_URI = `${BASE_URL}/auth/splitwise/callback`;

// Splitwise endpoints (hard-coded; these rarely change).
export const SPLITWISE_AUTHORIZE_URL = "https://secure.splitwise.com/oauth/authorize";
export const SPLITWISE_TOKEN_URL = "https://secure.splitwise.com/oauth/token";
export const SPLITWISE_API_BASE = "https://secure.splitwise.com/api/v3.0";

// Lifetimes for OAuth state stored in Redis.
export const PENDING_TTL_MS = 10 * 60_000; //       /authorize -> Splitwise round-trip
export const CODE_TTL_MS = 60_000; //                our authorization codes
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60_000; // our bearer tokens (30 days)

/**
 * Redis connection string. `Bun.redis` reads `REDIS_URL` automatically but we
 * re-export it here so the rest of the code has a single place to look.
 */
export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * TTLs for cached Splitwise API responses (seconds). Tuned to balance
 * responsiveness against staleness:
 *   - Things that rarely change (currencies, categories) → 24h.
 *   - User profile → 5 min.
 *   - Friends / groups → 60s, and we explicitly invalidate them on mutations.
 *   - Expenses / comments / notifications are NOT cached (too volatile / too
 *     important to be fresh).
 * Tool handlers also expose a `force_refresh: true` flag that bypasses the
 * cache for one call.
 */
export const CACHE_TTL_USER_SEC = 5 * 60;
export const CACHE_TTL_FRIENDS_SEC = 5*60;
export const CACHE_TTL_GROUPS_SEC = 5*60;
export const CACHE_TTL_METADATA_SEC = 24 * 60 * 60;
