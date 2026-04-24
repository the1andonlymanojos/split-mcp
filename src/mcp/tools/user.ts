/**
 * User-facing MCP tools backed by Splitwise /get_current_user, /get_user
 * and /update_user.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { asToolText, forceRefreshField, withSplitwiseClient } from "./_shared";

export function register(server: McpServer): void {
  server.tool(
    "whoami",
    "Returns the Splitwise user's name and id. Cached for ~5 min.",
    { ...forceRefreshField },
    withSplitwiseClient(async (args, client) => {
      const { status, data } = await client.getCurrentUser({
        forceRefresh: args.force_refresh,
      });
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      const user = data.user;
      return asToolText(
        user
          ? `You are ${user.full_name} (id ${user.id}).`
          : "Unexpected Splitwise response."
      );
    })
  );

  server.tool(
    "get_current_user",
    "Get information about the current Splitwise user (id, name, email). " +
      "Cached for ~5 min; pass `force_refresh: true` to bypass.",
    { ...forceRefreshField },
    withSplitwiseClient(async (args, client) => {
      const { status, data } = await client.getCurrentUser({
        forceRefresh: args.force_refresh,
      });
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText(data);
    })
  );

  server.tool(
    "get_user",
    "Get information about another Splitwise user by id. Cached for ~5 " +
      "min; pass `force_refresh: true` to bypass.",
    {
      id: z.number().int().positive().describe("Splitwise user id"),
      ...forceRefreshField,
    },
    withSplitwiseClient(async ({ id, force_refresh }, client) => {
      const { status, data } = await client.getUser(id, {
        forceRefresh: force_refresh,
      });
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText(data);
    })
  );

  server.tool(
    "update_current_user",
    "Update fields on the current Splitwise user. Only provided fields " +
      "are changed. Use with care: `email` and `password` mutate login " +
      "credentials.",
    {
      first_name: z.string().min(1).optional(),
      last_name: z.string().optional(),
      email: z.string().email().optional(),
      locale: z
        .string()
        .optional()
        .describe("BCP-47 locale, e.g. 'en', 'en-US'"),
      default_currency: z
        .string()
        .length(3)
        .optional()
        .describe("ISO 4217 currency code, e.g. 'USD', 'INR'"),
    },
    withSplitwiseClient(async (args, client) => {
      const me = await client.getCurrentUser();
      const selfId = me.data.user?.id;
      if (!selfId) {
        return asToolText({
          error: "could_not_resolve_current_user",
          status: me.status,
          data: me.data,
        });
      }
      const { status, data } = await client.updateUser(selfId, args);
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText(data);
    })
  );
}
