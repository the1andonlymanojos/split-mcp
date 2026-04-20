/**
 * Shared helpers for MCP tool handlers.
 */

import { SplitwiseClient } from "../../splitwise/client";

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
