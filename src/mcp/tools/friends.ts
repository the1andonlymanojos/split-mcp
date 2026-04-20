/**
 * Friends-related MCP tools.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { asToolText, withSplitwiseClient } from "./_shared";

export function register(server: McpServer): void {
  server.tool(
    "get_friends",
    "List the current user's Splitwise friends.",
    {},
    withSplitwiseClient(async (_args, client) => {
      const { data } = await client.getFriends();
      return asToolText(data);
    })
  );
}
