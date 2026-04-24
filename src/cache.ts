/**
 * Response cache for the Splitwise API, backed by Redis.
 *
 * Cache entries are stored as JSON strings at keys of the form:
 *
 *   cache:u:<tokenHash>:<bucket>:<qualifier>   (per-user)
 *   cache:global:<bucket>                      (shared)
 *
 * `tokenHash` is a short SHA-256 prefix of the caller's Splitwise bearer
 * token, so two users of this MCP server never see each other's data.
 *
 * Redis errors never propagate: a failed GET is treated as a miss and a
 * failed SET is silently dropped. We'd rather serve fresh uncached data than
 * 500 the tool call because the cache layer blew up.
 *
 * Invalidation is coarse — on mutations we delete the list keys and let
 * per-id keys age out on their short TTL. That's enough given the 60s
 * friends/groups TTL and is much simpler than reference-counting every key.
 */

import { redisDel, redisGet, redisSetEx } from "./redis";
import { log } from "./logger";

/** Short, stable hash of the caller's token for cache scoping. */
export function tokenHash(token: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(token);
  return hasher.digest("hex").slice(0, 16);
}

function userKey(hash: string, bucket: string, qualifier: string): string {
  return `cache:u:${hash}:${bucket}:${qualifier}`;
}

function globalKey(bucket: string): string {
  return `cache:global:${bucket}`;
}

/**
 * Try to read `key` from Redis and JSON-parse it. Returns `null` on miss,
 * Redis error, or malformed JSON.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redisGet(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    log("CACHE get error", { key, error: String(err) });
    return null;
  }
}

/** Serialize and store `value` at `key` with the given TTL. Never throws. */
export async function cacheSet<T>(
  key: string,
  ttlSec: number,
  value: T
): Promise<void> {
  try {
    await redisSetEx(key, ttlSec, JSON.stringify(value));
  } catch (err) {
    log("CACHE set error", { key, error: String(err) });
  }
}

/** Delete cache entries by exact key. Never throws. */
export async function cacheDel(...keys: string[]): Promise<void> {
  try {
    await redisDel(...keys);
    if (keys.length > 0) log("CACHE invalidate", { keys });
  } catch (err) {
    log("CACHE del error", { keys, error: String(err) });
  }
}

// --- Typed key builders for each cached bucket. ---

export const cacheKeys = {
  userMe: (hash: string) => userKey(hash, "user", "me"),
  userById: (hash: string, id: number) => userKey(hash, "user", String(id)),
  friendsList: (hash: string) => userKey(hash, "friends", "list"),
  friendById: (hash: string, id: number) => userKey(hash, "friends", String(id)),
  groupsList: (hash: string) => userKey(hash, "groups", "list"),
  groupById: (hash: string, id: number) => userKey(hash, "groups", String(id)),
  currencies: () => globalKey("currencies"),
  categories: () => globalKey("categories"),
};
