/**
 * Expense-comment MCP tools backed by `/get_comments`, `/create_comment`,
 * `/delete_comment/:id`. Splitwise only supports comments on expenses.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { asToolText, withSplitwiseClient } from "./_shared";

export function register(server: McpServer): void {
  server.tool(
    "get_comments",
    "List comments on a Splitwise expense.",
    {
      expense_id: z
        .number()
        .int()
        .positive()
        .describe("Splitwise expense id to fetch comments for"),
    },
    withSplitwiseClient(async ({ expense_id }: { expense_id: number }, client) => {
      const { status, data } = await client.getComments(expense_id);
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({
        count: data.comments.length,
        comments: data.comments,
      });
    })
  );

  server.tool(
    "create_comment",
    "Post a comment on a Splitwise expense.",
    {
      expense_id: z.number().int().positive(),
      content: z.string().min(1).describe("Comment text"),
    },
    withSplitwiseClient(async (args, client) => {
      const { status, data } = await client.createComment(
        args.expense_id,
        args.content
      );
      if (status !== 200 || !data.comment) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText(data.comment);
    })
  );

  server.tool(
    "delete_comment",
    "Delete a Splitwise expense comment by id. Returns the deleted comment.",
    { id: z.number().int().positive().describe("Splitwise comment id") },
    withSplitwiseClient(async ({ id }: { id: number }, client) => {
      const { status, data } = await client.deleteComment(id);
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText(data);
    })
  );
}
