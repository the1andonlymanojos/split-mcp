/**
 * Expense-related MCP tools.
 *
 * Covers `/get_expense/:id`, `/get_expenses`, `/create_expense`,
 * `/update_expense/:id`, `/delete_expense/:id`, `/undelete_expense/:id`.
 *
 * We deliberately only let callers identify share participants by Splitwise
 * `user_id`. The API also supports identifying users by email + first_name +
 * last_name, but that's noisy to surface as a tool and easy to get wrong — if
 * you need to bring a brand-new user into a Splitwise expense, add them via
 * `create_friend` or `add_user_to_group` first, then reference them here by
 * their returned id.
 *
 * `payment: true` flips a row from "expense" to "payment between users",
 * which is how Splitwise represents "Alice paid Bob $10" transactions.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type {
  CreateExpensePayload,
  RepeatInterval,
} from "../../splitwise/client";
import { asToolText, withSplitwiseClient } from "./_shared";

const REPEAT_INTERVALS = [
  "never",
  "weekly",
  "fortnightly",
  "monthly",
  "yearly",
] as const satisfies readonly RepeatInterval[];

/** Shape of a single share — identified purely by `user_id`. */
const shareSchema = z.object({
  user_id: z
    .number()
    .int()
    .positive()
    .describe("Splitwise user id participating in this expense"),
  paid_share: z
    .string()
    .describe(
      "Amount this user paid, as a decimal string with up to 2 decimal places (e.g. '25.00')."
    ),
  owed_share: z
    .string()
    .describe(
      "Amount this user owes, as a decimal string with up to 2 decimal places (e.g. '12.50')."
    ),
});

/** Common expense fields shared by create and update. */
const commonExpenseFields = {
  cost: z
    .string()
    .describe("Total cost as a decimal string (e.g. '25.00')."),
  description: z.string().min(1).describe("Short description of the expense."),
  details: z.string().optional().describe("Longer notes about the expense."),
  date: z
    .string()
    .optional()
    .describe(
      "ISO 8601 date/time of the expense (e.g. '2026-04-24T13:00:00Z'). Defaults to now."
    ),
  currency_code: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 currency code, e.g. 'USD'. Defaults to user's default currency."),
  category_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Splitwise category id (see `get_categories`)."),
  repeat_interval: z
    .enum(REPEAT_INTERVALS)
    .optional()
    .describe("How often this expense recurs. Defaults to 'never'."),
  payment: z
    .boolean()
    .optional()
    .describe("Set to `true` to record this as a payment between users rather than an expense."),
};

/**
 * Build a Splitwise flattened payload from the cleaner `shares` array. Returns
 * a new object so callers don't mutate their args.
 */
function flattenShares(
  base: Record<string, unknown>,
  shares: z.infer<typeof shareSchema>[] | undefined
): CreateExpensePayload {
  const out = { ...base } as Record<string, unknown>;
  (shares ?? []).forEach((s, i) => {
    out[`users__${i}__user_id`] = s.user_id;
    out[`users__${i}__paid_share`] = s.paid_share;
    out[`users__${i}__owed_share`] = s.owed_share;
  });
  return out as CreateExpensePayload;
}

export function register(server: McpServer): void {
  server.tool(
    "get_expense",
    "Get a single Splitwise expense by id, including its shares (per-user paid/owed amounts), category, and repayments.",
    { id: z.number().int().positive().describe("Splitwise expense id") },
    withSplitwiseClient(async ({ id }: { id: number }, client) => {
      const { status, data } = await client.getExpense(id);
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      if (!data.expense) {
        return asToolText({ error: "expense_not_found", id });
      }
      return asToolText(data.expense);
    })
  );

  server.tool(
    "get_expenses",
    "List Splitwise expenses for the current user, optionally scoped to a " +
      "group or a friend. Supports date-range and pagination filters. " +
      "`group_id` takes precedence over `friend_id`.",
    {
      group_id: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Only return expenses in this group. `0` means 'not in a group'."),
      friend_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Only return expenses between the current user and this friend."),
      dated_after: z
        .string()
        .optional()
        .describe("ISO 8601 date/time; only expenses dated after this are returned."),
      dated_before: z.string().optional(),
      updated_after: z.string().optional(),
      updated_before: z.string().optional(),
      limit: z.number().int().positive().max(200).optional().describe("Default 20."),
      offset: z.number().int().nonnegative().optional(),
    },
    withSplitwiseClient(async (args, client) => {
      const { status, data } = await client.getExpenses(args);
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({
        count: data.expenses.length,
        expenses: data.expenses,
      });
    })
  );

  server.tool(
    "create_expense",
    "Create a Splitwise expense (or payment if `payment: true`). Two ways " +
      "to split:\n" +
      "  • Equal split: supply `group_id` (non-zero) and `split_equally: true`. " +
      "The caller is assumed to be the payer. No `shares` needed.\n" +
      "  • By shares: supply a `shares` array. Every participant must be " +
      "identified by `user_id` with explicit `paid_share` and `owed_share` " +
      "strings. The `paid_share` values must sum to `cost`, and so must " +
      "the `owed_share` values.\n" +
      "Use `group_id: 0` (and `shares`) for an expense that isn't tied to a group.",
    {
      ...commonExpenseFields,
      group_id: z
        .number()
        .int()
        .nonnegative()
        .describe("Group to put the expense in, or `0` for no group."),
      split_equally: z
        .boolean()
        .optional()
        .describe("Only valid with a non-zero `group_id`. Splits the cost equally across all members."),
      shares: z
        .array(shareSchema)
        .optional()
        .describe("Per-user paid/owed shares. Required unless `split_equally` is true."),
    },
    withSplitwiseClient(async (args, client) => {
      const { shares, split_equally, ...rest } = args;

      if (!split_equally && (!shares || shares.length === 0)) {
        return asToolText({
          error: "invalid_args",
          message:
            "Provide either `split_equally: true` (with a non-zero group_id) or a non-empty `shares` array.",
        });
      }
      if (split_equally && (!args.group_id || args.group_id === 0)) {
        return asToolText({
          error: "invalid_args",
          message: "`split_equally` requires a non-zero `group_id`.",
        });
      }

      const base: Record<string, unknown> = { ...rest };
      if (split_equally) base.split_equally = true;
      const payload = flattenShares(base, split_equally ? undefined : shares);

      const { status, data } = await client.createExpense(payload);
      const errs = data.errors as Record<string, unknown> | undefined;
      const hasErrors = !!errs && Object.keys(errs).length > 0;
      if (status !== 200 || hasErrors) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({
        count: data.expenses.length,
        expenses: data.expenses,
      });
    })
  );

  server.tool(
    "update_expense",
    "Update a Splitwise expense by id. Only supply fields you want to " +
      "change. **Important**: if you provide `shares`, it fully overwrites " +
      "the existing shares — include every participant, not just the ones " +
      "you're changing.",
    {
      id: z.number().int().positive().describe("Splitwise expense id"),
      cost: z.string().optional(),
      description: z.string().min(1).optional(),
      details: z.string().optional(),
      date: z.string().optional(),
      currency_code: z.string().length(3).optional(),
      category_id: z.number().int().positive().optional(),
      repeat_interval: z.enum(REPEAT_INTERVALS).optional(),
      payment: z.boolean().optional(),
      group_id: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Move the expense to this group. `0` means 'not in a group'."),
      shares: z
        .array(shareSchema)
        .optional()
        .describe(
          "New, complete set of per-user shares. Overwrites the existing shares in full."
        ),
    },
    withSplitwiseClient(async (args, client) => {
      const { id, shares, ...rest } = args;
      const payload = flattenShares(rest, shares);
      const { status, data } = await client.updateExpense(id, payload);
      const errs = data.errors as Record<string, unknown> | undefined;
      const hasErrors = !!errs && Object.keys(errs).length > 0;
      if (status !== 200 || hasErrors) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({
        count: data.expenses.length,
        expenses: data.expenses,
      });
    })
  );

  server.tool(
    "delete_expense",
    "Delete a Splitwise expense by id. Soft-delete — use `undelete_expense` to restore.",
    { id: z.number().int().positive().describe("Splitwise expense id") },
    withSplitwiseClient(async ({ id }: { id: number }, client) => {
      const { status, data } = await client.deleteExpense(id);
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({ id, success: data.success, errors: data.errors });
    })
  );

  server.tool(
    "undelete_expense",
    "Restore a previously deleted Splitwise expense by id.",
    { id: z.number().int().positive().describe("Splitwise expense id") },
    withSplitwiseClient(async ({ id }: { id: number }, client) => {
      const { status, data } = await client.undeleteExpense(id);
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({ id, success: data.success, errors: data.errors });
    })
  );
}
