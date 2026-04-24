/**
 * Group-related MCP tools.
 *
 * Exposes list / read / create / delete / undelete plus "add a member"
 * over Splitwise's `/get_groups`, `/get_group/:id`, `/create_group`,
 * `/delete_group/:id`, `/undelete_group/:id`, and `/add_user_to_group`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CreateGroupPayload, SplitwiseGroupType } from "../../splitwise/client";
import { asToolText, forceRefreshField, withSplitwiseClient } from "./_shared";

const GROUP_TYPES = [
  "home",
  "trip",
  "couple",
  "other",
  "apartment",
  "house",
] as const satisfies readonly SplitwiseGroupType[];

export function register(server: McpServer): void {
  server.tool(
    "get_groups",
    "List the current user's Splitwise groups. Each group includes its " +
      "id, name, type, members (id, name, email, balance), and " +
      "original/simplified debts. Avatars, cover photos, and whiteboard " +
      "metadata are omitted. Cached for ~60s; pass `force_refresh: true` " +
      "to bypass.",
    { ...forceRefreshField },
    withSplitwiseClient(async (args, client) => {
      const { status, data } = await client.getGroups({
        forceRefresh: args.force_refresh,
      });
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({
        count: data.groups.length,
        groups: data.groups,
      });
    })
  );

  server.tool(
    "get_group",
    "Get one Splitwise group by id, including its members and debts. " +
      "Cached for ~60s; pass `force_refresh: true` to bypass.",
    {
      id: z.number().int().positive().describe("Splitwise group id"),
      ...forceRefreshField,
    },
    withSplitwiseClient(async ({ id, force_refresh }, client) => {
      const { status, data } = await client.getGroup(id, {
        forceRefresh: force_refresh,
      });
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      if (!data.group) {
        return asToolText({ error: "group_not_found", id });
      }
      return asToolText(data.group);
    })
  );

  server.tool(
    "create_group",
    "Create a new Splitwise group. The current user is implicitly a " +
      "member; additional members are optional and identified either by " +
      "their Splitwise user id or by email (+ first name).",
    {
      name: z.string().min(1).describe("Group name"),
      group_type: z
        .enum(GROUP_TYPES)
        .optional()
        .describe("Group type. Defaults to 'other' on Splitwise's side."),
      simplify_by_default: z.boolean().optional(),
      users: z
        .array(
          z
            .object({
              user_id: z.number().int().positive().optional(),
              first_name: z.string().optional(),
              last_name: z.string().optional(),
              email: z.string().email().optional(),
            })
            .refine(
              (u) => u.user_id !== undefined || u.email !== undefined,
              "Each user must have either `user_id` or `email`."
            )
        )
        .optional()
        .describe(
          "Additional members to add. Each must specify user_id OR email."
        ),
    },
    withSplitwiseClient(async (args, client) => {
      const payload: CreateGroupPayload = {
        name: args.name,
        ...(args.group_type ? { group_type: args.group_type } : {}),
        ...(args.simplify_by_default !== undefined
          ? { simplify_by_default: args.simplify_by_default }
          : {}),
      };
      (args.users ?? []).forEach((u, i) => {
        if (u.user_id !== undefined) {
          (payload as Record<string, unknown>)[`users__${i}__user_id`] = u.user_id;
        }
        if (u.first_name !== undefined) {
          (payload as Record<string, unknown>)[`users__${i}__first_name`] = u.first_name;
        }
        if (u.last_name !== undefined) {
          (payload as Record<string, unknown>)[`users__${i}__last_name`] = u.last_name;
        }
        if (u.email !== undefined) {
          (payload as Record<string, unknown>)[`users__${i}__email`] = u.email;
        }
      });

      const { status, data } = await client.createGroup(payload);
      if (status !== 200 || !data.group) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText(data.group);
    })
  );

  server.tool(
    "delete_group",
    "Delete a Splitwise group by id. Soft-delete — use `undelete_group` " +
      "to restore.",
    { id: z.number().int().positive().describe("Splitwise group id") },
    withSplitwiseClient(async ({ id }: { id: number }, client) => {
      const { status, data } = await client.deleteGroup(id);
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({ id, success: data.success, errors: data.errors });
    })
  );

  server.tool(
    "undelete_group",
    "Restore a previously deleted Splitwise group by id.",
    { id: z.number().int().positive().describe("Splitwise group id") },
    withSplitwiseClient(async ({ id }: { id: number }, client) => {
      const { status, data } = await client.undeleteGroup(id);
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({ id, success: data.success, errors: data.errors });
    })
  );

  server.tool(
    "add_user_to_group",
    "Add a user to an existing Splitwise group. Identify the user by " +
      "`user_id` (existing Splitwise user) OR by `email` (+ first name, " +
      "which invites them).",
    {
      group_id: z.number().int().positive(),
      user_id: z.number().int().positive().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().email().optional(),
    },
    withSplitwiseClient(async (args, client) => {
      if (args.user_id === undefined && args.email === undefined) {
        return asToolText({
          error: "invalid_args",
          message: "Provide either `user_id` or `email`.",
        });
      }
      const payload =
        args.user_id !== undefined
          ? { group_id: args.group_id, user_id: args.user_id }
          : {
              group_id: args.group_id,
              first_name: args.first_name ?? "",
              last_name: args.last_name,
              email: args.email!,
            };

      const { status, data } = await client.addUserToGroup(payload);
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText(data);
    })
  );

  server.tool(
    "remove_user_from_group",
    "Remove a user from a Splitwise group. Will fail (with `success: " +
      "false`) if the user still has a non-zero balance in the group.",
    {
      group_id: z.number().int().positive(),
      user_id: z.number().int().positive(),
    },
    withSplitwiseClient(async (args, client) => {
      const { status, data } = await client.removeUserFromGroup(args);
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({
        group_id: args.group_id,
        user_id: args.user_id,
        success: data.success,
        errors: data.errors,
      });
    })
  );
}
