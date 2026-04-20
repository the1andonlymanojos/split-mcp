/**
 * Factory for a fresh MCP server instance with all tools registered.
 *
 * We create a new `McpServer` per MCP session (see `./session.ts`) so session
 * state can't leak between users.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerAllTools } from "./tools";

export function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "splitwise-mcp",
    version: "1.0.0",
  });
  registerAllTools(server);
  return server;
}
