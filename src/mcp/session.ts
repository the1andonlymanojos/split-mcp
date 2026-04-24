/**
 * MCP `/mcp` endpoint handler.
 *
 * Responsibilities:
 *   - Validate the bearer token (delegated to `oauth/bearer`).
 *   - Inject the caller's Splitwise token into a header tool handlers can
 *     read, so tools never see our bearer.
 *   - Route to a per-session transport, creating a new one on `initialize`.
 *
 * One `McpServer` + one transport = one MCP session. The SDK generates a
 * `Mcp-Session-Id` on the `initialize` response and clients echo it back on
 * every subsequent request.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { json } from "../http";
import { log } from "../logger";
import { unauthorized, verifyBearer } from "../oauth/bearer";
import { buildMcpServer } from "./server";

/**
 * Live MCP transports, keyed by `Mcp-Session-Id`. Intentionally NOT moved to
 * Redis — these values are open streaming connection objects tied to this
 * process and can't be serialized. The practical consequence is that this
 * server must run as a single process; horizontal scaling would require
 * sticky sessions (or re-initialising on each replica).
 */
const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

export async function handleMcp(req: Request): Promise<Response> {
  const bearer = await verifyBearer(req);
  if (!bearer) return unauthorized("Missing or invalid bearer token");

  // Tool handlers read `x-splitwise-token` from their requestInfo; injecting
  // it here keeps the Splitwise token completely contained within the server
  // (never exposed to the client, never conflated with our bearer).
  const headers = new Headers(req.headers);
  headers.set("x-splitwise-token", bearer.splitwiseToken);

  const incomingSid = headers.get("mcp-session-id");

  // --- Existing session: route straight to its transport. ---
  if (incomingSid) {
    const transport = sessions.get(incomingSid);
    if (!transport) {
      log("MCP unknown session", { incomingSid });
      return json({ error: "session_not_found" }, { status: 404 });
    }
    log("MCP route -> existing session", { sid: incomingSid, method: req.method });
    return transport.handleRequest(new Request(req, { headers }));
  }

  // --- No session id. Only valid if this is an `initialize` POST. ---
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

  if (!isInitializeRequest(parsedBody)) {
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

  // --- New session. Spin up a fresh server+transport pair. ---
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (sid: string) => {
      sessions.set(sid, transport);
      log("MCP session initialized", { sid });
    },
    onsessionclosed: (sid: string) => {
      sessions.delete(sid);
      log("MCP session closed", { sid });
    },
  });

  const server = buildMcpServer();
  await server.connect(transport);
  log("MCP new session -> handling initialize");

  return transport.handleRequest(new Request(req, { headers }), { parsedBody });
}

/** True if body is (or contains) an `initialize` JSON-RPC request. */
function isInitializeRequest(body: unknown): boolean {
  if (!body) return false;
  if (Array.isArray(body)) {
    return body.some((m) => (m as { method?: string })?.method === "initialize");
  }
  if (typeof body === "object") {
    return (body as { method?: string }).method === "initialize";
  }
  return false;
}
