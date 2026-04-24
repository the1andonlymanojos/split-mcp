/**
 * Bearer-token verification for our protected resource (`/mcp`).
 *
 * The `WWW-Authenticate` header on 401s points clients at our
 * `oauth-protected-resource` metadata, which is what the MCP spec wants.
 */

import { BASE_URL } from "../config";
import { log } from "../logger";
import { findBearerToken, type AccessToken } from "./store";

/**
 * Extract and validate the `Authorization: Bearer …` header. Returns the
 * token entry on success or `null` when it's missing / unknown / expired.
 */
export async function verifyBearer(req: Request): Promise<AccessToken | null> {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return findBearerToken(m[1]!);
}

/** Standard 401 with the MCP-required `resource_metadata` pointer. */
export function unauthorized(message: string): Response {
  log("AUTH reject", { message });
  return new Response(JSON.stringify({ error: "unauthorized", message }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer realm="mcp", resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
    },
  });
}
