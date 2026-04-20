/**
 * In-memory state for our OAuth Authorization Server.
 *
 * Three maps model the flow:
 *
 *   pendingAuths  key = `state` we send to Splitwise
 *                 value = where to redirect the MCP client when Splitwise
 *                         comes back.
 *
 *   codes         key = the one-time authorization code we issue to the MCP
 *                       client (lives ~60s).
 *                 value = the Splitwise access token we got on their behalf.
 *
 *   tokens        key = our bearer token (what MCP clients put in the
 *                       `Authorization: Bearer …` header).
 *                 value = the Splitwise access token to proxy tool calls
 *                         with.
 *
 * Everything here is in-memory and wiped on restart: good enough for a POC,
 * swap for a KV store for production.
 */

import { CODE_TTL_MS, PENDING_TTL_MS, TOKEN_TTL_MS } from "../config";
import { log } from "../logger";
import { randomToken } from "../http";

// ---------- PENDING AUTHS (between /authorize and Splitwise callback) ----------

export type PendingAuth = {
  mcpClientId: string;
  mcpClientRedirectUri: string;
  mcpClientState: string;
  expiresAt: number;
};

const pendingAuths = new Map<string, PendingAuth>();

export function createPendingAuth(entry: Omit<PendingAuth, "expiresAt">): string {
  const state = randomToken(16);
  pendingAuths.set(state, { ...entry, expiresAt: Date.now() + PENDING_TTL_MS });
  return state;
}

export function consumePendingAuth(state: string): PendingAuth | null {
  const p = pendingAuths.get(state);
  if (!p) return null;
  pendingAuths.delete(state);
  if (Date.now() > p.expiresAt) return null;
  return p;
}

// ---------- AUTHORIZATION CODES (our /token endpoint consumes these) ----------

export type AuthCode = {
  code: string;
  mcpClientId: string;
  mcpClientRedirectUri: string;
  splitwiseToken: string;
  expiresAt: number;
  used: boolean;
};

const codes = new Map<string, AuthCode>();

export function issueAuthCode(params: {
  mcpClientId: string;
  mcpClientRedirectUri: string;
  splitwiseToken: string;
}): string {
  const code = randomToken(16);
  codes.set(code, {
    code,
    ...params,
    expiresAt: Date.now() + CODE_TTL_MS,
    used: false,
  });
  log("OUR code issued", { code, mcpClientId: params.mcpClientId });
  return code;
}

/**
 * Atomically consume a one-shot code. Returns the entry when it's valid and
 * marks it as used so a replay fails. All error branches delete the entry
 * for good measure.
 */
export function consumeAuthCode(
  code: string,
  redirectUri: string
): { ok: true; entry: AuthCode } | { ok: false; reason: string } {
  const entry = codes.get(code);
  if (!entry) return { ok: false, reason: "unknown_code" };

  if (entry.used) {
    codes.delete(code);
    return { ok: false, reason: "already_used" };
  }
  if (Date.now() > entry.expiresAt) {
    codes.delete(code);
    return { ok: false, reason: "expired" };
  }
  if (entry.mcpClientRedirectUri !== redirectUri) {
    return { ok: false, reason: "redirect_uri_mismatch" };
  }

  entry.used = true;
  codes.delete(code);
  return { ok: true, entry };
}

// ---------- BEARER TOKENS (what /mcp validates on every request) ----------

export type AccessToken = {
  token: string;
  splitwiseToken: string;
  expiresAt: number;
};

const tokens = new Map<string, AccessToken>();

export function issueBearerToken(splitwiseToken: string): AccessToken {
  const token = randomToken(32);
  const entry: AccessToken = {
    token,
    splitwiseToken,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  tokens.set(token, entry);
  log("TOKEN issued", { expires_in: TOKEN_TTL_MS / 1000 });
  return entry;
}

export function findBearerToken(token: string): AccessToken | null {
  const entry = tokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return null;
  }
  return entry;
}
