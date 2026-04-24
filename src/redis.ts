/**
 * Redis plumbing.
 *
 * We use Bun's built-in `Bun.redis` client (1.2+), which auto-reads the
 * `REDIS_URL` env var. This file exposes:
 *
 *   - `redis`        the underlying client (use for exotic commands via `.send`).
 *   - `redisSetEx`   convenience wrapper around SET … EX (atomic TTL-on-write).
 *   - `redisGet`     typed `get` that returns `null` when the key is missing.
 *   - `redisDel`     delete one or more keys.
 *   - `redisInit`    called once at server startup to fail loudly if Redis is
 *                    unreachable, rather than discovering it on the first auth
 *                    request.
 *
 * All of our persistent state (OAuth pending auths, one-shot codes, bearer
 * tokens, and the API response cache) lives in Redis. The only in-memory
 * state that remains is the live MCP transport map in `src/mcp/session.ts`,
 * which can't be serialized.
 */

import { REDIS_URL } from "./config";
import { log } from "./logger";

export const redis = Bun.redis;

/**
 * Ensure Redis is reachable. Called once from `oauth-mcp.ts` at boot so the
 * process exits early if Redis is down or REDIS_URL is wrong. We do a real
 * PING (rather than just `.connect()`) because Bun's redis client connects
 * lazily and `.connect()` can hang forever when nothing is listening.
 */
export async function redisInit(): Promise<void> {
  const pong = await Promise.race([
    redis.send("PING", []),
    new Promise((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`Redis PING timed out after 3s (${REDIS_URL})`)),
        3000
      )
    ),
  ]);
  log("REDIS connected", { url: REDIS_URL, pong });
}

/** SET key value EX ttlSec. */
export async function redisSetEx(
  key: string,
  ttlSec: number,
  value: string
): Promise<void> {
  await redis.send("SETEX", [key, String(ttlSec), value]);
}

/** GET key, returning `null` when missing. */
export async function redisGet(key: string): Promise<string | null> {
  const raw = await redis.get(key);
  return raw ?? null;
}

/** DEL key(s). Missing keys are silently skipped by Redis. */
export async function redisDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await redis.send("DEL", keys);
}
