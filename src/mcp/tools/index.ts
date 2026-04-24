/**
 * Central registry of MCP tools.
 *
 * Each tool lives in its own file and exports a `register(...)` function
 * that adds itself to the given `McpServer`. Adding a new tool means:
 *   1. Create a `tools/<name>.ts` that exports `register`.
 *   2. Import it here and call `register(server)`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import * as commentsTool from "./comments";
import * as expensesTool from "./expenses";
import * as friendsTool from "./friends";
import * as groupsTool from "./groups";
import * as metadataTool from "./metadata";
import * as notificationsTool from "./notifications";
import * as userTool from "./user";

export function registerAllTools(server: McpServer): void {
  userTool.register(server);
  friendsTool.register(server);
  groupsTool.register(server);
  expensesTool.register(server);
  commentsTool.register(server);
  notificationsTool.register(server);
  metadataTool.register(server);
}
