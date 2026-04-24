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
 *
 * We also track a `lastUsed` timestamp so stale sessions (clients that spun
 * one up during OAuth discovery and then forgot about it) get reaped rather
 * than leaking forever.
 */
type SessionEntry = {
  transport: WebStandardStreamableHTTPServerTransport;
  lastUsed: number;
};

const sessions = new Map<string, SessionEntry>();

/**
 * Idle sessions get reaped after this long. A normal client will send traffic
 * well within this window (initialize, tools/list, tool calls). Anything
 * quieter is almost certainly an abandoned session from a re-running
 * discovery dance, and keeping it around just leaks the transport + the
 * `McpServer` instance attached to it.
 */
const SESSION_IDLE_MS = 10 * 60_000;

/** Periodic sweep. Cheap: O(sessions) and sessions are single-digit in practice. */
setInterval(() => {
  const now = Date.now();
  for (const [sid, entry] of sessions) {
    if (now - entry.lastUsed > SESSION_IDLE_MS) {
      sessions.delete(sid);
      void entry.transport.close().catch(() => {});
      log("MCP session reaped (idle)", { sid });
    }
  }
}, 60_000).unref?.();

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
    const entry = sessions.get(incomingSid);
    if (!entry) {
      log("MCP unknown session", {
        incomingSid,
        method: req.method,
        activeSessions: sessions.size,
      });
      return handleStatelessMcp(req, headers, "unknown_session");
    }
    entry.lastUsed = Date.now();
    log("MCP route -> existing session", {
      sid: incomingSid,
      method: req.method,
      rpc: await summarizeJsonRpcRequest(req),
    });
    return entry.transport.handleRequest(new Request(req, { headers }));
  }

  // --- No session id. Only valid if this is an `initialize` POST. ---
  //
  // opencode sometimes opens a bare GET /mcp notification stream after a
  // successful initialize, without echoing Mcp-Session-Id. The actual tools
  // flow is still POST-based, so treat that GET as a harmless compatibility
  // stream instead of failing the whole "get tools" validation.
  if (req.method !== "POST") {
    const accept = headers.get("accept") ?? "";
    log("MCP request without session", {
      method: req.method,
      accept,
      userAgent: headers.get("user-agent"),
      activeSessions: sessions.size,
    });
    if (req.method === "GET" && accept.includes("text/event-stream")) {
      return handleStatelessMcp(req, headers, "sessionless_get");
    }
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
    log("MCP non-init without session", {
      rpc: summarizeJsonRpcBody(parsedBody),
    });
    return handleStatelessMcp(
      new Request(req.url, {
        method: req.method,
        headers,
        body: bodyText,
      }),
      headers,
      "sessionless_post"
    );
  }

  // --- New session. Spin up a fresh server+transport pair. ---
  //
  // `enableJsonResponse: true` makes the transport reply to POSTs with a
  // one-shot JSON body instead of an SSE stream. The MCP Streamable HTTP
  // spec explicitly allows this, and for our tools (simple request/response,
  // no server-initiated streaming) it's strictly better: clients don't have
  // to drain an SSE stream between requests, so a slow client doesn't
  // head-of-line-block the next POST on the same connection.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sid: string) => {
      sessions.set(sid, { transport, lastUsed: Date.now() });
      log("MCP session initialized", { sid });
    },
    onsessionclosed: (sid: string) => {
      sessions.delete(sid);
      log("MCP session closed", { sid });
    },
  });
  transport.onerror = (err) => {
    const error =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : err;
    log("MCP transport error", { error });
  };

  const server = buildMcpServer();
  await server.connect(transport);
  log("MCP new session -> handling initialize", {
    rpc: summarizeJsonRpcBody(parsedBody),
  });

  return transport.handleRequest(new Request(req, { headers }), { parsedBody });
}

async function handleStatelessMcp(
  req: Request,
  headers: Headers,
  reason: string
): Promise<Response> {
  // Our tools are pure request/response and keep all durable state in Redis via
  // the bearer token, so a one-shot stateless transport is a safe fallback for
  // clients that race, omit, or reuse Mcp-Session-Id across process restarts.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  transport.onerror = (err) => {
    const error =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : err;
    log("MCP stateless transport error", { reason, error });
  };

  const server = buildMcpServer();
  await server.connect(transport);
  log("MCP stateless fallback", {
    reason,
    method: req.method,
    rpc: await summarizeJsonRpcRequest(req),
  });
  return transport.handleRequest(new Request(req, { headers }));
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

async function summarizeJsonRpcRequest(req: Request): Promise<unknown> {
  if (req.method !== "POST") return undefined;
  try {
    return summarizeJsonRpcBody(await req.clone().json());
  } catch {
    return "unreadable_json";
  }
}

function summarizeJsonRpcBody(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(summarizeJsonRpcMessage);
  return summarizeJsonRpcMessage(body);
}

function summarizeJsonRpcMessage(message: unknown): unknown {
  if (!message || typeof message !== "object") return typeof message;
  const msg = message as {
    id?: unknown;
    method?: unknown;
    params?: { name?: unknown; clientInfo?: { name?: unknown; version?: unknown } };
  };
  return {
    id: msg.id,
    method: msg.method,
    tool: msg.params?.name,
    client: msg.params?.clientInfo
      ? {
          name: msg.params.clientInfo.name,
          version: msg.params.clientInfo.version,
        }
      : undefined,
  };
}
