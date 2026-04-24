/**
 * Persistent state for our OAuth Authorization Server, stored in Redis.
 *
 * Three logical stores model the flow:
 *
 *   pendingAuths  key = `state` we send to Splitwise
 *                 value = where to redirect the MCP client when Splitwise
 *                         comes back.
 *                 ttl = PENDING_TTL_MS
 *
 *   codes         key = the one-time authorization code we issue to the MCP
 *                       client.
 *                 value = the Splitwise access token we got on their behalf.
 *                 ttl = CODE_TTL_MS
 *
 *   tokens        key = our bearer token (what MCP clients put in the
 *                       `Authorization: Bearer …` header).
 *                 value = the Splitwise access token to proxy tool calls
 *                         with.
 *                 ttl = TOKEN_TTL_MS
 *
 * Each logical store has its own key prefix in Redis. Values are JSON.
 * TTLs are attached via SETEX so Redis evicts them automatically — we never
 * have to sweep stale entries ourselves.
 *
 * Authorization codes are one-shot: `consumeAuthCode` deletes the key as part
 * of consumption so a replay just returns `unknown_code`.
 */

import { CODE_TTL_MS, PENDING_TTL_MS, TOKEN_TTL_MS } from "../config";
import { log } from "../logger";
import { randomToken } from "../http";
import { redisDel, redisGet, redisSetEx } from "../redis";

const PENDING_PREFIX = "oauth:pending:";
const CODE_PREFIX = "oauth:code:";
const TOKEN_PREFIX = "oauth:token:";

function msToSec(ms: number): number {
  return Math.max(1, Math.floor(ms / 1000));
}

// ---------- PENDING AUTHS (between /authorize and Splitwise callback) ----------

export type PendingAuth = {
  mcpClientId: string;
  mcpClientRedirectUri: string;
  mcpClientState: string;
};

export async function createPendingAuth(entry: PendingAuth): Promise<string> {
  const state = randomToken(16);
  await redisSetEx(
    PENDING_PREFIX + state,
    msToSec(PENDING_TTL_MS),
    JSON.stringify(entry)
  );
  return state;
}

export async function consumePendingAuth(state: string): Promise<PendingAuth | null> {
  const key = PENDING_PREFIX + state;
  const raw = await redisGet(key);
  if (!raw) return null;
  await redisDel(key);
  try {
    return JSON.parse(raw) as PendingAuth;
  } catch {
    return null;
  }
}

// ---------- AUTHORIZATION CODES (our /token endpoint consumes these) ----------

export type AuthCode = {
  code: string;
  mcpClientId: string;
  mcpClientRedirectUri: string;
  splitwiseToken: string;
};

export async function issueAuthCode(params: {
  mcpClientId: string;
  mcpClientRedirectUri: string;
  splitwiseToken: string;
}): Promise<string> {
  const code = randomToken(16);
  const entry: AuthCode = { code, ...params };
  await redisSetEx(CODE_PREFIX + code, msToSec(CODE_TTL_MS), JSON.stringify(entry));
  log("OUR code issued", { code, mcpClientId: params.mcpClientId });
  return code;
}

/**
 * Atomically consume a one-shot code. Returns the entry when it's valid and
 * deletes it from Redis so a replay fails. All error branches also delete
 * the key for good measure.
 */
export async function consumeAuthCode(
  code: string,
  redirectUri: string
): Promise<{ ok: true; entry: AuthCode } | { ok: false; reason: string }> {
  const key = CODE_PREFIX + code;
  const raw = await redisGet(key);
  if (!raw) return { ok: false, reason: "unknown_code" };

  // Delete first, so a concurrent consumer loses.
  await redisDel(key);

  let entry: AuthCode;
  try {
    entry = JSON.parse(raw) as AuthCode;
  } catch {
    return { ok: false, reason: "corrupt" };
  }

  if (entry.mcpClientRedirectUri !== redirectUri) {
    return { ok: false, reason: "redirect_uri_mismatch" };
  }

  return { ok: true, entry };
}

// ---------- BEARER TOKENS (what /mcp validates on every request) ----------

export type AccessToken = {
  token: string;
  splitwiseToken: string;
};

export async function issueBearerToken(
  splitwiseToken: string
): Promise<AccessToken> {
  const token = randomToken(32);
  const entry: AccessToken = { token, splitwiseToken };
  await redisSetEx(
    TOKEN_PREFIX + token,
    msToSec(TOKEN_TTL_MS),
    JSON.stringify(entry)
  );
  log("TOKEN issued", { expires_in: msToSec(TOKEN_TTL_MS) });
  return entry;
}

export async function findBearerToken(token: string): Promise<AccessToken | null> {
  const raw = await redisGet(TOKEN_PREFIX + token);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AccessToken;
  } catch {
    return null;
  }
}
