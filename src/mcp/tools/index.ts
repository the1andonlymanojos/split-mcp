/**
 * Central registry of MCP tools.
 *
 * Each tool lives in its own file and exports a `register(...)` function
 * that adds itself to the given `McpServer`. Adding a new tool means:
 *   1. Create a `tools/<name>.ts` that exports `register`.
 *   2. Import it here and call `register(server)`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import * as friendsTool from "./friends";
import * as userTool from "./user";

export function registerAllTools(server: McpServer): void {
  userTool.register(server);
  friendsTool.register(server);
}
