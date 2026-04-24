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
 *                       client.
 *                 value = the Splitwise access token we got on their behalf.
 *
 *   tokens        key = our bearer token (what MCP clients put in the
 *                       `Authorization: Bearer ...` header).
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
  /** PKCE: base64url(SHA-256(verifier)) if method is S256, raw verifier if "plain". */
  codeChallenge?: string;
  /** "S256" (preferred / required by MCP) or "plain". Absent = no PKCE. */
  codeChallengeMethod?: "S256" | "plain";
  expiresAt: number;
};

const pendingAuths = new Map<string, PendingAuth>();

export function createPendingAuth(
  entry: Omit<PendingAuth, "expiresAt">
): string {
  const state = randomToken(16);
  pendingAuths.set(state, { ...entry, expiresAt: Date.now() + PENDING_TTL_MS });
  return state;
}

export function consumePendingAuth(state: string): PendingAuth | null {
  const pending = pendingAuths.get(state);
  if (!pending) return null;
  pendingAuths.delete(state);
  if (Date.now() > pending.expiresAt) return null;
  return pending;
}

// ---------- AUTHORIZATION CODES (our /token endpoint consumes these) ----------

export type AuthCode = {
  code: string;
  mcpClientId: string;
  mcpClientRedirectUri: string;
  splitwiseToken: string;
  /** PKCE code_challenge from the /authorize request, carried through to /token. */
  codeChallenge?: string;
  codeChallengeMethod?: "S256" | "plain";
  expiresAt: number;
  used: boolean;
};

const codes = new Map<string, AuthCode>();

export function issueAuthCode(params: {
  mcpClientId: string;
  mcpClientRedirectUri: string;
  splitwiseToken: string;
  codeChallenge?: string;
  codeChallengeMethod?: "S256" | "plain";
}): string {
  const code = randomToken(16);
  const entry: AuthCode = {
    code,
    ...params,
    expiresAt: Date.now() + CODE_TTL_MS,
    used: false,
  };
  codes.set(code, entry);
  log("OUR code issued", { code, mcpClientId: params.mcpClientId });
  return code;
}

/**
 * Atomically consume a one-shot code. Returns the entry when it's valid and
 * marks it as used so a replay fails. All error branches delete the entry
 * for good measure.
 *
 * When the original /authorize carried a PKCE `code_challenge`, the caller
 * must supply a matching `codeVerifier` — this implements RFC 7636 §4.6.
 * If no challenge was recorded we accept any (or missing) verifier, keeping
 * pre-PKCE clients working.
 */
export async function consumeAuthCode(
  code: string,
  redirectUri: string,
  codeVerifier?: string
): Promise<{ ok: true; entry: AuthCode } | { ok: false; reason: string }> {
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

  if (entry.codeChallenge) {
    if (!codeVerifier) return { ok: false, reason: "missing_code_verifier" };
    const expected = await deriveChallenge(codeVerifier, entry.codeChallengeMethod ?? "plain");
    if (expected !== entry.codeChallenge) {
      return { ok: false, reason: "pkce_mismatch" };
    }
  }

  entry.used = true;
  codes.delete(code);
  return { ok: true, entry };
}

/** Derive what the `code_challenge` should be for a given verifier + method. */
async function deriveChallenge(
  verifier: string,
  method: "S256" | "plain"
): Promise<string> {
  if (method === "plain") return verifier;
  // S256: base64url(SHA-256(verifier)).
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(verifier);
  const digest = hasher.digest(); // Buffer
  return base64UrlEncode(digest);
}

function base64UrlEncode(buf: Uint8Array | Buffer): string {
  const b64 = Buffer.from(buf).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------- BEARER TOKENS (what /mcp validates on every request) ----------

export type AccessToken = {
  token: string;
  splitwiseToken: string;
  expiresAt: number;
};

const tokens = new Map<string, AccessToken>();

export function issueBearerToken(
  splitwiseToken: string
): AccessToken {
  const token = randomToken(32);
  const entry: AccessToken = {
    token,
    splitwiseToken,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  tokens.set(token, entry);
  log("TOKEN issued", { expires_in: Math.floor(TOKEN_TTL_MS / 1000) });
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
