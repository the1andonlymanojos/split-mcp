/**
 * Notifications MCP tool backed by `/get_notifications`.
 *
 * Splitwise's `type` field is an integer code; common values are documented
 * in the tool description below so downstream consumers don't have to
 * memorise the mapping.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { asToolText, withSplitwiseClient } from "./_shared";

export function register(server: McpServer): void {
  server.tool(
    "get_notifications",
    "List recent activity on the current user's Splitwise account, most " +
      "recent first. `type` codes:\n" +
      "  0 expense added, 1 expense updated, 2 expense deleted, 3 comment added,\n" +
      "  4 added to group, 5 removed from group, 6 group deleted, 7 group settings changed,\n" +
      "  8 added as friend, 9 removed as friend, 10 news, 11 debt simplification,\n" +
      "  12 group undeleted, 13 expense undeleted, 14/15 currency conversion.\n" +
      "`content` is HTML (uses <strong>, <strike>, <small>, <br>, and <font color>).",
    {
      updated_after: z
        .string()
        .optional()
        .describe("ISO 8601 date/time; only notifications after this are returned."),
      limit: z
        .number()
        .int()
        .nonnegative()
        .max(1000)
        .optional()
        .describe("Omit or pass 0 to get the server-imposed maximum."),
    },
    withSplitwiseClient(async (args, client) => {
      const { status, data } = await client.getNotifications(args);
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({
        count: data.notifications.length,
        notifications: data.notifications,
      });
    })
  );
}
