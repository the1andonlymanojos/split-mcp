import { serve } from "bun";

const CLIENT_ID = Bun.env.SPLITWISE_CLIENT_ID;
const CLIENT_SECRET = Bun.env.SPLITWISE_CLIENT_SECRET;
const BASE_URL = "https://manojs-macbook-air.stoat-toad.ts.net"; // funnel URL
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

//---- STORAGE (POC only) ----
const stateToUser = new Map<string, string>();
const userToToken = new Map<string, string>();

// ---- MCP SERVER ----
const mcpServer = new McpServer({
  name: "splitwise",
  version: "1.0.0",
});

const mcpTransport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});
await mcpServer.connect(mcpTransport);

// ---- TOOL: GET FRIENDS ----
mcpServer.tool("get_friends", {}, async (_args, { requestInfo }) => {
  const userId =
    (requestInfo?.headers?.["x-user-id"] as string | undefined) ?? "test-user";

  const token = userToToken.get(userId);

  if (!token) {
    return {
      content: [
        {
          type: "text",
          text: `Not connected.\nGo here:\n${BASE_URL}/auth/splitwise?user_id=${userId}`,
        },
      ],
    };
  }

  const res = await fetch(
    "https://secure.splitwise.com/api/v3.0/get_friends",
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const data = await res.json();

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
});

// ---- HTTP SERVER ----
serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // ---- 1. START OAUTH ----
    if (url.pathname === "/auth/splitwise") {
      const state = crypto.randomUUID();

      const userId =
        url.searchParams.get("user_id") || crypto.randomUUID();

      stateToUser.set(state, userId);

      const redirectUrl =
        "https://secure.splitwise.com/oauth/authorize?" +
        new URLSearchParams({
          client_id: CLIENT_ID,
          response_type: "code",
          redirect_uri: `${BASE_URL}/auth/splitwise/callback`,
          state,
        });

      return Response.redirect(redirectUrl);
    }

    // ---- 2. CALLBACK ----
    if (url.pathname === "/auth/splitwise/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        return new Response("Missing code/state", { status: 400 });
      }

      const userId = stateToUser.get(state);

      if (!userId) {
        return new Response("Invalid state", { status: 400 });
      }

      const tokenRes = await fetch(
        "https://secure.splitwise.com/oauth/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri: `${BASE_URL}/auth/splitwise/callback`,
          }),
        }
      );

      const data = (await tokenRes.json()) as { access_token?: string };
      const token = data.access_token;

      if (!token) {
        return new Response("Failed to get token", { status: 500 });
      }

      userToToken.set(userId, token);

      return new Response(
        "✅ Connected. Go back to ChatGPT and try again."
      );
    }

    // ---- DEBUG: FRIENDS ----
    if (url.pathname === "/friends") {
      const userId = url.searchParams.get("user_id") || "test-user";
      const token = userToToken.get(userId);

      if (!token) {
        return new Response("Not connected");
      }

      const res = await fetch(
        "https://secure.splitwise.com/api/v3.0/get_friends",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await res.json();

      return Response.json(data);
    }

    // ---- MCP ENDPOINT ----
    if (url.pathname === "/mcp") {
      return mcpTransport.handleRequest(req);
    }

    return new Response("OK");
  },
});