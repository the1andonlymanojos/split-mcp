/**
 * MCP server that acts as an OAuth 2.1 Authorization Server, but delegates
 * the actual user authentication to Splitwise.
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
 *   GET  /.well-known/oauth-authorization-server    - AS metadata
 *   GET  /.well-known/oauth-protected-resource      - PR metadata (MCP)
 *   GET  /authorize                                 - redirects to Splitwise
 *   GET  /auth/splitwise/callback                   - receives Splitwise code
 *   POST /token                                     - exchanges our code for our bearer
 *   GET  /callback-demo                             - built-in demo client
 *   *    /mcp                                       - MCP endpoint (bearer required)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

// ---------- CONFIG ----------
// Override via env, e.g.:
//   BASE_URL=https://manojs-macbook-air.stoat-toad.ts.net bun run oauth-mcp.ts
const PORT = Number(Bun.env.PORT ?? 3000);
const BASE_URL = Bun.env.BASE_URL ?? `http://localhost:${PORT}`;

// Splitwise OAuth app credentials. Redirect URI must match what's registered
// on the Splitwise app: `${BASE_URL}/auth/splitwise/callback`.
const SPLITWISE_CLIENT_ID =
  Bun.env.SPLITWISE_CLIENT_ID ?? "";
const SPLITWISE_CLIENT_SECRET =
  Bun.env.SPLITWISE_CLIENT_SECRET ?? "";
const SPLITWISE_REDIRECT_URI = `${BASE_URL}/auth/splitwise/callback`;

const SPLITWISE_AUTHORIZE_URL = "https://secure.splitwise.com/oauth/authorize";
const SPLITWISE_TOKEN_URL = "https://secure.splitwise.com/oauth/token";
const SPLITWISE_API = "https://secure.splitwise.com/api/v3.0";

// TTLs
const PENDING_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 60_000;
const TOKEN_TTL_MS = 60 * 60_000;

// ---------- LOGGING ----------
let stepCounter = 0;
function log(step: string, data?: unknown) {
  stepCounter += 1;
  const ts = new Date().toISOString();
  if (data === undefined) {
    console.log(`[${ts}] #${stepCounter} ${step}`);
  } else {
    console.log(`[${ts}] #${stepCounter} ${step}`, data);
  }
}

// ---------- IN-MEMORY STATE ----------
// key = state we send to Splitwise; value = the MCP client's original request
type PendingAuth = {
  mcpClientId: string;
  mcpClientRedirectUri: string;
  mcpClientState: string;
  expiresAt: number;
};
const pendingAuths = new Map<string, PendingAuth>();

// key = our authorization code; value = tied to a freshly-obtained Splitwise token
type AuthCode = {
  code: string;
  mcpClientId: string;
  mcpClientRedirectUri: string;
  splitwiseToken: string;
  expiresAt: number;
  used: boolean;
};
const codes = new Map<string, AuthCode>();

// key = our bearer token; value = the user's Splitwise token
type AccessToken = {
  token: string;
  splitwiseToken: string;
  expiresAt: number;
};
const tokens = new Map<string, AccessToken>();

function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- MCP SERVER (per-session) ----------
function getSplitwiseToken(
  requestInfo: { headers?: Record<string, string | string[] | undefined> } | undefined
): string | null {
  const h = requestInfo?.headers?.["x-splitwise-token"];
  return typeof h === "string" ? h : null;
}

async function splitwiseGET(path: string, token: string) {
  const res = await fetch(`${SPLITWISE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const bodyText = await res.text();
  log(`SPLITWISE GET ${path}`, { status: res.status });
  let data: unknown;
  try {
    data = JSON.parse(bodyText);
  } catch {
    data = bodyText;
  }
  return { status: res.status, data };
}

function asToolText(obj: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2),
      },
    ],
  };
}

function buildMcpServer(): McpServer {
  const mcpServer = new McpServer({
    name: "splitwise-mcp",
    version: "1.0.0",
  });

  mcpServer.tool(
    "whoami",
    "Returns the Splitwise user's name and id.",
    {},
    async (_args, { requestInfo }) => {
      const token = getSplitwiseToken(requestInfo);
      if (!token) return asToolText("Not authenticated.");
      const { status, data } = await splitwiseGET("/get_current_user", token);
      if (status !== 200) return asToolText({ error: "splitwise_error", status, data });
      const user = (data as { user?: { id: number; first_name: string; last_name: string } }).user;
      return asToolText(
        user
          ? `You are ${user.first_name} ${user.last_name} (id ${user.id}).`
          : "Unexpected Splitwise response."
      );
    }
  );

  mcpServer.tool(
    "get_current_user",
    "Get full information about the current Splitwise user.",
    {},
    async (_args, { requestInfo }) => {
      const token = getSplitwiseToken(requestInfo);
      if (!token) return asToolText("Not authenticated.");
      const { data } = await splitwiseGET("/get_current_user", token);
      return asToolText(data);
    }
  );

  mcpServer.tool(
    "get_user",
    "Get information about another Splitwise user by id.",
    { id: z.number().int().positive().describe("Splitwise user id") },
    async ({ id }, { requestInfo }) => {
      const token = getSplitwiseToken(requestInfo);
      if (!token) return asToolText("Not authenticated.");
      const { data } = await splitwiseGET(`/get_user/${id}`, token);
      return asToolText(data);
    }
  );

  mcpServer.tool(
    "get_friends",
    "List the current user's Splitwise friends.",
    {},
    async (_args, { requestInfo }) => {
      const token = getSplitwiseToken(requestInfo);
      if (!token) return asToolText("Not authenticated.");
      const { data } = await splitwiseGET("/get_friends", token);
      return asToolText(data);
    }
  );

  return mcpServer;
}

// Per-session transport pool. Each MCP client gets its own server+transport
// pair, keyed by the Mcp-Session-Id the SDK issues on `initialize`.
const mcpSessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

// ---------- HELPERS ----------
function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

function html(body: string, init?: ResponseInit) {
  return new Response(body, {
    ...init,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

function unauthorized(message: string) {
  log("AUTH reject", { message });
  return new Response(JSON.stringify({ error: "unauthorized", message }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer realm="mcp", resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
    },
  });
}

function verifyBearer(req: Request): AccessToken | null {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const tok = tokens.get(m[1]!);
  if (!tok) return null;
  if (Date.now() > tok.expiresAt) {
    tokens.delete(tok.token);
    return null;
  }
  return tok;
}

// ---------- HTTP SERVER ----------
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    log(`HTTP ${req.method} ${url.pathname}${url.search}`);

    // ---- LANDING ----
    if (url.pathname === "/" && req.method === "GET") {
      return html(`
        <h1>Splitwise MCP (OAuth via Splitwise)</h1>
        <p>This MCP server authenticates users via Splitwise OAuth.</p>
        <ol>
          <li><a href="/authorize?client_id=demo&redirect_uri=${encodeURIComponent(
            BASE_URL + "/callback-demo"
          )}&response_type=code&state=xyz">Start authorization (demo client)</a></li>
          <li>You'll be sent to Splitwise to sign in.</li>
          <li>Back here, the demo client receives a code, swaps it for a bearer token, and calls the <code>whoami</code> tool.</li>
        </ol>
      `);
    }

    // ---- DISCOVERY ----
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json({
        issuer: BASE_URL,
        authorization_endpoint: `${BASE_URL}/authorize`,
        token_endpoint: `${BASE_URL}/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: [],
      });
    }
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return json({
        resource: `${BASE_URL}/mcp`,
        authorization_servers: [BASE_URL],
        bearer_methods_supported: ["header"],
      });
    }

    // ---- /authorize: start the dance -> Splitwise ----
    if (url.pathname === "/authorize" && req.method === "GET") {
      const clientId = url.searchParams.get("client_id") ?? "";
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const responseType = url.searchParams.get("response_type") ?? "";
      const mcpState = url.searchParams.get("state") ?? "";

      log("AUTHORIZE start", { clientId, redirectUri, responseType, mcpState });

      if (responseType !== "code") {
        return json({ error: "unsupported_response_type" }, { status: 400 });
      }
      if (!redirectUri) {
        return json(
          { error: "invalid_request", message: "redirect_uri required" },
          { status: 400 }
        );
      }

      const ourState = randomToken(16);
      pendingAuths.set(ourState, {
        mcpClientId: clientId,
        mcpClientRedirectUri: redirectUri,
        mcpClientState: mcpState,
        expiresAt: Date.now() + PENDING_TTL_MS,
      });

      const splitwiseUrl =
        SPLITWISE_AUTHORIZE_URL +
        "?" +
        new URLSearchParams({
          client_id: SPLITWISE_CLIENT_ID,
          response_type: "code",
          redirect_uri: SPLITWISE_REDIRECT_URI,
          state: ourState,
        });
      log("AUTHORIZE redirect -> Splitwise", { ourState });
      return Response.redirect(splitwiseUrl, 302);
    }

    // ---- /auth/splitwise/callback: Splitwise returns with ?code & ?state ----
    if (url.pathname === "/auth/splitwise/callback" && req.method === "GET") {
      const swCode = url.searchParams.get("code");
      const ourState = url.searchParams.get("state");
      log("SPLITWISE callback", { swCode, ourState });

      if (!swCode || !ourState) {
        return html("Missing code or state from Splitwise.", { status: 400 });
      }
      const pending = pendingAuths.get(ourState);
      if (!pending) {
        return html("Unknown or expired state.", { status: 400 });
      }
      pendingAuths.delete(ourState);
      if (Date.now() > pending.expiresAt) {
        return html("Authorization request expired.", { status: 400 });
      }

      // Exchange Splitwise code for Splitwise access token
      const swRes = await fetch(SPLITWISE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: swCode,
          client_id: SPLITWISE_CLIENT_ID,
          client_secret: SPLITWISE_CLIENT_SECRET,
          redirect_uri: SPLITWISE_REDIRECT_URI,
        }),
      });
      const swData = (await swRes.json()) as { access_token?: string; error?: string };
      log("SPLITWISE token exchange", { status: swRes.status, ok: !!swData.access_token });

      if (!swData.access_token) {
        return html(
          `Splitwise token exchange failed: <pre>${JSON.stringify(swData, null, 2)}</pre>`,
          { status: 500 }
        );
      }

      // Mint OUR authorization code and hand it back to the original MCP client
      const ourCode = randomToken(16);
      codes.set(ourCode, {
        code: ourCode,
        mcpClientId: pending.mcpClientId,
        mcpClientRedirectUri: pending.mcpClientRedirectUri,
        splitwiseToken: swData.access_token,
        expiresAt: Date.now() + CODE_TTL_MS,
        used: false,
      });
      log("OUR code issued", { ourCode, mcpClientId: pending.mcpClientId });

      const target = new URL(pending.mcpClientRedirectUri);
      target.searchParams.set("code", ourCode);
      if (pending.mcpClientState) target.searchParams.set("state", pending.mcpClientState);
      log("Redirect -> MCP client", { to: target.toString() });
      return Response.redirect(target.toString(), 302);
    }

    // ---- /token: MCP client exchanges our code for our bearer token ----
    if (url.pathname === "/token" && req.method === "POST") {
      const ct = req.headers.get("content-type") ?? "";
      let params: URLSearchParams;
      if (ct.includes("application/x-www-form-urlencoded")) {
        params = new URLSearchParams(await req.text());
      } else if (ct.includes("application/json")) {
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
      log("TOKEN request", { grantType, code, clientId, redirectUri });

      if (grantType !== "authorization_code") {
        return json({ error: "unsupported_grant_type" }, { status: 400 });
      }
      const entry = codes.get(code);
      if (!entry) {
        log("TOKEN invalid_code");
        return json({ error: "invalid_grant" }, { status: 400 });
      }
      if (entry.used) {
        codes.delete(code);
        log("TOKEN code already used (revoking)");
        return json({ error: "invalid_grant" }, { status: 400 });
      }
      if (Date.now() > entry.expiresAt) {
        codes.delete(code);
        log("TOKEN code expired");
        return json({ error: "invalid_grant" }, { status: 400 });
      }
      if (entry.mcpClientRedirectUri !== redirectUri) {
        log("TOKEN redirect_uri mismatch", {
          expected: entry.mcpClientRedirectUri,
          got: redirectUri,
        });
        return json({ error: "invalid_grant" }, { status: 400 });
      }

      entry.used = true;
      codes.delete(code);

      const bearer = randomToken(32);
      tokens.set(bearer, {
        token: bearer,
        splitwiseToken: entry.splitwiseToken,
        expiresAt: Date.now() + TOKEN_TTL_MS,
      });
      log("TOKEN issued", { expires_in: TOKEN_TTL_MS / 1000 });

      return json({
        access_token: bearer,
        token_type: "Bearer",
        expires_in: Math.floor(TOKEN_TTL_MS / 1000),
      });
    }

    // ---- /callback-demo: built-in demo client ----
    if (url.pathname === "/callback-demo" && req.method === "GET") {
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      log("CALLBACK-DEMO received", { code, state });

      if (!code) return html(`<p>No <code>code</code> in query string.</p>`, { status: 400 });

      const tokenRes = await fetch(`${BASE_URL}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: "demo",
          redirect_uri: `${BASE_URL}/callback-demo`,
        }),
      });
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        error?: string;
      };
      log("CALLBACK-DEMO token exchange", tokenJson);

      if (!tokenJson.access_token) {
        return html(
          `<p>Token exchange failed: <pre>${JSON.stringify(tokenJson, null, 2)}</pre></p>`,
          { status: 400 }
        );
      }
      const token = tokenJson.access_token;
      return html(`
        <h2>You're in.</h2>
        <p><b>access_token:</b> <code>${token}</code></p>
        <p>
          <button data-tool="whoami">whoami</button>
          <button data-tool="get_current_user">get_current_user</button>
          <button data-tool="get_friends">get_friends</button>
        </p>
        <pre id="out" style="background:#f4f4f4;padding:1em;white-space:pre-wrap"></pre>
        <script>
          const token = ${JSON.stringify(token)};
          const out = document.getElementById("out");
          let sessionId = null;
          async function rpc(body) {
            const r = await fetch("/mcp", {
              method: "POST",
              headers: {
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
              },
              body: JSON.stringify(body),
            });
            const sid = r.headers.get("mcp-session-id");
            if (sid) sessionId = sid;
            return r.text();
          }
          async function ensureInit() {
            if (sessionId) return;
            await rpc({
              jsonrpc: "2.0", id: 1, method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "browser-demo", version: "0" }
              }
            });
            await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
          }
          document.querySelectorAll("button[data-tool]").forEach(btn => {
            btn.onclick = async () => {
              out.textContent = "working...";
              await ensureInit();
              const body = {
                jsonrpc: "2.0", id: Math.floor(Math.random()*1e9),
                method: "tools/call",
                params: { name: btn.dataset.tool, arguments: {} }
              };
              out.textContent = await rpc(body);
            };
          });
        </script>
      `);
    }

    // ---- /mcp: protected, per-session transports ----
    if (url.pathname === "/mcp") {
      const tok = verifyBearer(req);
      if (!tok) return unauthorized("Missing or invalid bearer token");

      // Inject the Splitwise token for tool handlers.
      const h = new Headers(req.headers);
      h.set("x-splitwise-token", tok.splitwiseToken);

      const incomingSid = h.get("mcp-session-id");

      // Existing session: route to its transport.
      if (incomingSid) {
        const transport = mcpSessions.get(incomingSid);
        if (!transport) {
          log("MCP unknown session", { incomingSid });
          return json({ error: "session_not_found" }, { status: 404 });
        }
        log("MCP route -> existing session", { sid: incomingSid, method: req.method });
        return transport.handleRequest(new Request(req, { headers: h }));
      }

      // No session id. For POST we peek at the body to see if it's an
      // `initialize` request; if so, mint a fresh server+transport. For other
      // methods (GET/DELETE without sid) we reject.
      if (req.method !== "POST") {
        return json({ error: "session_required" }, { status: 400 });
      }

      const bodyText = await req.text();
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        return json({ error: "invalid_json" }, { status: 400 });
      }
      const isInit =
        (parsedBody &&
          typeof parsedBody === "object" &&
          (parsedBody as { method?: string }).method === "initialize") ||
        (Array.isArray(parsedBody) &&
          parsedBody.some((m) => (m as { method?: string })?.method === "initialize"));

      if (!isInit) {
        log("MCP non-init without session", { parsedBody });
        return json(
          {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32000, message: "Missing Mcp-Session-Id header" },
          },
          { status: 400 }
        );
      }

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sid: string) => {
          mcpSessions.set(sid, transport);
          log("MCP session initialized", { sid });
        },
        onsessionclosed: (sid: string) => {
          mcpSessions.delete(sid);
          log("MCP session closed", { sid });
        },
      });
      const server = buildMcpServer();
      await server.connect(transport);
      log("MCP new session -> handling initialize");

      return transport.handleRequest(new Request(req, { headers: h }), {
        parsedBody,
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`
Splitwise MCP server running:
  local:  http://localhost:${PORT}
  public: ${BASE_URL}
Splitwise redirect_uri (must match your app's registered URL):
  ${SPLITWISE_REDIRECT_URI}
`);
