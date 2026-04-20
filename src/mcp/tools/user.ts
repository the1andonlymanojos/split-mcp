/**
 * User-facing MCP tools backed by Splitwise /get_current_user and /get_user.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { asToolText, withSplitwiseClient } from "./_shared";

export function register(server: McpServer): void {
  server.tool(
    "whoami",
    "Returns the Splitwise user's name and id.",
    {},
    withSplitwiseClient(async (_args, client) => {
      const { status, data } = await client.getCurrentUser();
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      const user = data.user;
      return asToolText(
        user
          ? `You are ${user.first_name} ${user.last_name} (id ${user.id}).`
          : "Unexpected Splitwise response."
      );
    })
  );

  server.tool(
    "get_current_user",
    "Get full information about the current Splitwise user.",
    {},
    withSplitwiseClient(async (_args, client) => {
      const { data } = await client.getCurrentUser();
      return asToolText(data);
    })
  );

  server.tool(
    "get_user",
    "Get information about another Splitwise user by id.",
    { id: z.number().int().positive().describe("Splitwise user id") },
    withSplitwiseClient(async ({ id }: { id: number }, client) => {
      const { data } = await client.getUser(id);
      return asToolText(data);
    })
  );
}
