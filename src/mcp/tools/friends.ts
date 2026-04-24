/**
 * Friends-related MCP tools.
 *
 * Backs `/get_friends`, `/get_friend/:id`, `/create_friend`,
 * `/create_friends`, `/delete_friend/:id`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { asToolText, forceRefreshField, withSplitwiseClient } from "./_shared";

export function register(server: McpServer): void {
  server.tool(
    "get_friends",
    "List the current user's Splitwise friends with their id, name, " +
      "email, registration status and outstanding balance (total and " +
      "per-group). Cached for ~60s; pass `force_refresh: true` to bypass.",
    { ...forceRefreshField },
    withSplitwiseClient(async (args, client) => {
      const { status, data } = await client.getFriends({
        forceRefresh: args.force_refresh,
      });
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({
        count: data.friends.length,
        friends: data.friends,
      });
    })
  );

  server.tool(
    "get_friend",
    "Get details about a single Splitwise friend (by their user id), " +
      "including balances with the current user. Cached for ~60s; pass " +
      "`force_refresh: true` to bypass.",
    {
      id: z
        .number()
        .int()
        .positive()
        .describe("User id of the friend (same as Splitwise user id)."),
      ...forceRefreshField,
    },
    withSplitwiseClient(async ({ id, force_refresh }, client) => {
      const { status, data } = await client.getFriend(id, {
        forceRefresh: force_refresh,
      });
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      if (!data.friend) {
        return asToolText({ error: "friend_not_found", id });
      }
      return asToolText(data.friend);
    })
  );

  server.tool(
    "create_friend",
    "Add a friend to the current user by email. If the target user does " +
      "not yet have a Splitwise account, you must supply `user_first_name` " +
      "(and optionally `user_last_name`) so Splitwise can create an " +
      "invited-user record.",
    {
      user_email: z.string().email(),
      user_first_name: z.string().optional(),
      user_last_name: z.string().optional(),
    },
    withSplitwiseClient(async (args, client) => {
      const { status, data } = await client.createFriend(args);
      if (status !== 200 || !data.friend) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText(data.friend);
    })
  );

  server.tool(
    "create_friends",
    "Bulk-add friends. Each user must have `email`; `first_name` is " +
      "required for users that don't already exist on Splitwise.",
    {
      users: z
        .array(
          z.object({
            email: z.string().email(),
            first_name: z.string().optional(),
            last_name: z.string().optional(),
          })
        )
        .min(1),
    },
    withSplitwiseClient(async (args, client) => {
      const { status, data } = await client.createFriends(args.users);
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({
        count: data.users.length,
        users: data.users,
        errors: data.errors,
      });
    })
  );

  server.tool(
    "delete_friend",
    "Break off a friendship with the given user. Splitwise returns 200 " +
      "even on failure — inspect the `success` field.",
    {
      id: z
        .number()
        .int()
        .positive()
        .describe("User id of the friend to remove."),
    },
    withSplitwiseClient(async ({ id }: { id: number }, client) => {
      const { status, data } = await client.deleteFriend(id);
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({ id, success: data.success, errors: data.errors });
    })
  );
}
