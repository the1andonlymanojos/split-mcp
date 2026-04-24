/**
 * Shared helpers for MCP tool handlers.
 */

import { z } from "zod";

import { SplitwiseClient } from "../../splitwise/client";

/**
 * Zod fragment for the `force_refresh` flag exposed by every cached read
 * tool. Pass `true` right after a mutation (or any time you know the cache
 * is stale) to bypass Redis for this single call. Default `false`.
 */
export const forceRefreshField = {
  force_refresh: z
    .boolean()
    .optional()
    .describe(
      "Bypass the server-side Redis cache and fetch a fresh copy from " +
        "Splitwise. Use after mutations made outside this MCP (e.g. in the " +
        "Splitwise app) when you need to see up-to-the-second data."
    ),
};

/** Convert anything into a text-content MCP tool result. */
export function asToolText(obj: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2),
      },
    ],
  };
}

/**
 * Wrap a tool handler so it receives a `SplitwiseClient` already bound to
 * the caller's token. If the request comes in without a token (shouldn't
 * happen when going through `/mcp`, but we're defensive), we return a
 * friendly "not authenticated" message instead of crashing.
 */
export function withSplitwiseClient<TArgs>(
  handler: (args: TArgs, client: SplitwiseClient) => Promise<ReturnType<typeof asToolText>>
) {
  return async (
    args: TArgs,
    ctx: { requestInfo?: { headers?: Record<string, string | string[] | undefined> } }
  ) => {
    const client = SplitwiseClient.fromRequestInfo(ctx.requestInfo);
    if (!client) return asToolText("Not authenticated.");
    return handler(args, client);
  };
}
