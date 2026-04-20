import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "splitwise-mcp",
  version: "1.0.0",
});

// ---- TOOL: GET FRIENDS ----
server.tool("get_friends", {}, async (_args, { requestInfo }) => {
  const userId =
    (requestInfo?.headers?.["x-user-id"] as string | undefined) ?? "test-user";

  const res = await fetch("https://manojs-macbook-air.stoat-toad.ts.net/friends", {
    headers: {
      "x-user-id": userId,
    },
  });

  const raw = await res.text();
  let text: string;
  try {
    text = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    text = `[${res.status} ${res.statusText}] ${raw}`;
  }

  return {
    content: [{ type: "text", text }],
  };
});

server.tool("connect_splitwise", {}, async (_args, { requestInfo }) => {
    const userId =
      (requestInfo?.headers?.["x-user-id"] as string | undefined) ?? "test-user";
  
    const authUrl = `https://manojs-macbook-air.stoat-toad.ts.net/auth/splitwise?user_id=${userId}`;
  
    return {
      content: [
        {
          type: "text",
          text: `Go here to connect your Splitwise account:\n${authUrl}`,
        },
      ],
    };
  });

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();