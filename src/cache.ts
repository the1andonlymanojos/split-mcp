/**
 * In-memory response cache for the Splitwise API.
 *
 * Cache entries are stored at keys of the form:
 *
 *   cache:u:<tokenHash>:<bucket>:<qualifier>   (per-user)
 *   cache:global:<bucket>                      (shared)
 *
 * `tokenHash` is a short SHA-256 prefix of the caller's Splitwise bearer
 * token, so two users of this MCP server never see each other's data.
 *
 * Invalidation is coarse — on mutations we delete the list keys and let
 * per-id keys age out on their short TTL. That's enough given the 60s
 * friends/groups TTL and is much simpler than reference-counting every key.
 */

import { log } from "./logger";

type CacheEntry = {
  value: string;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

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
 * Try to read `key` and JSON-parse it. Returns `null` on miss, expiry, or
 * malformed JSON.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  try {
    return JSON.parse(entry.value) as T;
  } catch {
    cache.delete(key);
    return null;
  }
}

/** Serialize and store `value` at `key` with the given TTL. Never throws. */
export async function cacheSet<T>(
  key: string,
  ttlSec: number,
  value: T
): Promise<void> {
  cache.set(key, {
    value: JSON.stringify(value),
    expiresAt: Date.now() + ttlSec * 1000,
  });
}

/** Delete cache entries by exact key. Never throws. */
export async function cacheDel(...keys: string[]): Promise<void> {
  for (const key of keys) {
    cache.delete(key);
  }
  if (keys.length > 0) log("CACHE invalidate", { keys });
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
