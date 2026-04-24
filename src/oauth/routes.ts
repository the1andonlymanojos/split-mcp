/**
 * Our OAuth Authorization Server endpoints.
 *
 * We implement just enough of OAuth 2.1 to let an MCP client sign in, and we
 * delegate actual user authentication to Splitwise:
 *
 *   MCP client --/authorize--> us --redirect--> Splitwise (user logs in)
 *                                    |
 *                                    v
 *          Splitwise --/auth/splitwise/callback--> us (receives Splitwise code)
 *                                    |
 *                                    v
 *                  us --redirect--> MCP client's redirect_uri?code=OURCODE
 *                                    |
 *                                    v
 *                  MCP client --/token-- us --> { access_token: OURBEARER }
 *
 * Each exported function is a route handler returning a `Response`. The top-
 * level router (in `oauth-mcp.ts`) wires the URL pathnames to these.
 */

import { BASE_URL } from "../config";
import { html, json, randomToken } from "../http";
import { log } from "../logger";
import { buildAuthorizeUrl, exchangeCodeForToken } from "../splitwise/oauth";
import {
  consumeAuthCode,
  consumePendingAuth,
  createPendingAuth,
  issueAuthCode,
  issueBearerToken,
} from "./store";
import { TOKEN_TTL_MS } from "../config";

// ---------- DISCOVERY DOCUMENTS ----------

/**
 * OAuth 2.1 Authorization Server metadata (RFC 8414).
 *
 * We advertise:
 *   - `registration_endpoint` so MCP clients can self-register via RFC 7591
 *     Dynamic Client Registration. Modern MCP clients (opencode, Claude Desktop,
 *     ChatGPT connectors, MCP Inspector) call this before starting the OAuth
 *     dance; without it they fail with `Error POSTing to endpoint`.
 *   - `code_challenge_methods_supported: ["S256"]` because the MCP auth spec
 *     mandates OAuth 2.1, which requires PKCE. "plain" is also accepted server-
 *     side for compatibility but we only advertise the secure method.
 */
export function authorizationServerMetadata(): Response {
  return json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/authorize`,
    token_endpoint: `${BASE_URL}/token`,
    registration_endpoint: `${BASE_URL}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
  });
}

/** MCP Protected Resource metadata. */
export function protectedResourceMetadata(): Response {
  return json({
    resource: `${BASE_URL}/mcp`,
    authorization_servers: [BASE_URL],
    bearer_methods_supported: ["header"],
  });
}

// ---------- /authorize ----------

/**
 * Kick off the dance. We stash the MCP client's redirect info under a random
 * `state` and forward the user to Splitwise. On the way back we'll look the
 * state up to know where to redirect.
 */
export async function handleAuthorize(url: URL): Promise<Response> {
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const responseType = url.searchParams.get("response_type") ?? "";
  const mcpState = url.searchParams.get("state") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const codeChallengeMethodRaw =
    url.searchParams.get("code_challenge_method") ?? "";

  log("AUTHORIZE start", {
    clientId,
    redirectUri,
    responseType,
    mcpState,
    pkce: codeChallenge ? codeChallengeMethodRaw || "plain" : "none",
  });

  if (responseType !== "code") {
    return json({ error: "unsupported_response_type" }, { status: 400 });
  }
  if (!redirectUri) {
    return json(
      { error: "invalid_request", message: "redirect_uri required" },
      { status: 400 }
    );
  }

  // Normalize PKCE params. The method defaults to "plain" per RFC 7636 when
  // a challenge is supplied without an explicit method. We only accept the
  // two methods defined by the spec.
  let codeChallengeMethod: "S256" | "plain" | undefined;
  if (codeChallenge) {
    if (codeChallengeMethodRaw === "S256" || codeChallengeMethodRaw === "") {
      codeChallengeMethod = codeChallengeMethodRaw === "S256" ? "S256" : "plain";
    } else if (codeChallengeMethodRaw === "plain") {
      codeChallengeMethod = "plain";
    } else {
      return json(
        {
          error: "invalid_request",
          message: `unsupported code_challenge_method: ${codeChallengeMethodRaw}`,
        },
        { status: 400 }
      );
    }
  }

  const state = await createPendingAuth({
    mcpClientId: clientId,
    mcpClientRedirectUri: redirectUri,
    mcpClientState: mcpState,
    codeChallenge: codeChallenge || undefined,
    codeChallengeMethod,
  });

  const target = buildAuthorizeUrl(state);
  log("AUTHORIZE redirect -> Splitwise", { ourState: state });
  return Response.redirect(target, 302);
}

// ---------- /auth/splitwise/callback ----------

/**
 * Splitwise redirects the user back here with `?code=…&state=…`. We:
 *   1. Look up the pending auth by `state`.
 *   2. Swap the Splitwise code for a Splitwise access token.
 *   3. Mint OUR own authorization code (tied to that token).
 *   4. Redirect the user to the MCP client's original `redirect_uri`.
 */
export async function handleSplitwiseCallback(url: URL): Promise<Response> {
  const swCode = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  log("SPLITWISE callback", { swCode, ourState: state });

  if (!swCode || !state) {
    return html("Missing code or state from Splitwise.", { status: 400 });
  }

  const pending = await consumePendingAuth(state);
  if (!pending) {
    return html("Unknown or expired state.", { status: 400 });
  }

  const tokenResponse = await exchangeCodeForToken(swCode);
  if (!tokenResponse.access_token) {
    return html(
      `Splitwise token exchange failed: <pre>${JSON.stringify(tokenResponse, null, 2)}</pre>`,
      { status: 500 }
    );
  }

  const ourCode = await issueAuthCode({
    mcpClientId: pending.mcpClientId,
    mcpClientRedirectUri: pending.mcpClientRedirectUri,
    splitwiseToken: tokenResponse.access_token,
    codeChallenge: pending.codeChallenge,
    codeChallengeMethod: pending.codeChallengeMethod,
  });

  const target = new URL(pending.mcpClientRedirectUri);
  target.searchParams.set("code", ourCode);
  if (pending.mcpClientState) target.searchParams.set("state", pending.mcpClientState);
  log("Redirect -> MCP client", { to: target.toString() });
  return Response.redirect(target.toString(), 302);
}

// ---------- /token ----------

/**
 * MCP client posts `{ grant_type, code, client_id, redirect_uri }`. If the
 * code is valid we issue a bearer token bound to the same Splitwise token.
 */
export async function handleToken(req: Request): Promise<Response> {
  const contentType = req.headers.get("content-type") ?? "";

  let params: URLSearchParams;
  if (contentType.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await req.text());
  } else if (contentType.includes("application/json")) {
    const body = (await req.json()) as Record<string, string>;
    params = new URLSearchParams(body);
  } else {
    return json(
      { error: "invalid_request", message: "unsupported content-type" },
      { status: 400 }
    );
  }

  const grantType = params.get("grant_type");
  const code = params.get("code") ?? "";
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const codeVerifier = params.get("code_verifier") ?? undefined;
  log("TOKEN request", {
    grantType,
    code,
    clientId,
    redirectUri,
    pkce: codeVerifier ? "present" : "absent",
  });

  if (grantType !== "authorization_code") {
    return json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  const result = await consumeAuthCode(code, redirectUri, codeVerifier);
  if (!result.ok) {
    log("TOKEN invalid_grant", { reason: result.reason });
    return json({ error: "invalid_grant", error_description: result.reason }, {
      status: 400,
    });
  }

  const bearer = await issueBearerToken(result.entry.splitwiseToken);
  return json({
    access_token: bearer.token,
    token_type: "Bearer",
    expires_in: Math.floor(TOKEN_TTL_MS / 1000),
  });
}

// ---------- /register ----------

/**
 * RFC 7591 Dynamic Client Registration.
 *
 * Modern MCP clients (opencode, Claude Desktop, ChatGPT, MCP Inspector) expect
 * to self-register here before running the OAuth dance. They send a JSON body
 * with `redirect_uris` / `client_name` / etc. and expect a JSON response
 * carrying a `client_id` they can use in the subsequent `/authorize` call.
 *
 * Because we only support public clients (no secret, no client authentication —
 * `token_endpoint_auth_method: "none"`) we don't actually need to remember the
 * client_id on the server side: it's just a random handle that the client
 * echoes back. The OAuth authorization code is already bound to the exact
 * `redirect_uri` used in /authorize, which is what actually provides the
 * security guarantee, together with PKCE.
 *
 * Returning 200 with a generated `client_id` is sufficient to unblock clients
 * that strictly follow RFC 7591; anything more (persisting registrations,
 * validating redirect_uris against a whitelist) would be security theater
 * given we accept public clients anyway.
 */
export async function handleRegister(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_request", error_description: "invalid JSON body" }, { status: 400 });
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const clientName = typeof body.client_name === "string" ? body.client_name : "mcp-client";

  const clientId = `mcp_${randomToken(12)}`;
  log("REGISTER issued", { clientId, clientName, redirectUris });

  return json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}
