/**
 * Metadata MCP tools: `/get_currencies` and `/get_categories`.
 *
 * Both endpoints are authless on Splitwise's side but we still require an
 * authenticated MCP session for consistency with every other tool.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { asToolText, forceRefreshField, withSplitwiseClient } from "./_shared";

export function register(server: McpServer): void {
  server.tool(
    "get_currencies",
    "List all currencies supported by Splitwise. Mostly ISO 4217 codes " +
      "(e.g. 'USD'), occasionally colloquial codes (e.g. 'BTC'). Cached " +
      "for 24h (this list almost never changes); pass `force_refresh: " +
      "true` to bypass.",
    { ...forceRefreshField },
    withSplitwiseClient(async (args, client) => {
      const { status, data } = await client.getCurrencies({
        forceRefresh: args.force_refresh,
      });
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({
        count: data.currencies.length,
        currencies: data.currencies,
      });
    })
  );

  server.tool(
    "get_categories",
    "List all expense categories Splitwise supports. Returns parent " +
      "categories with their subcategories. When creating an expense, " +
      "`category_id` must be a subcategory id — use the 'Other' " +
      "subcategory if you only want the parent. Cached for 24h; pass " +
      "`force_refresh: true` to bypass.",
    { ...forceRefreshField },
    withSplitwiseClient(async (args, client) => {
      const { status, data } = await client.getCategories({
        forceRefresh: args.force_refresh,
      });
      if (status !== 200) {
        return asToolText({ error: "splitwise_error", status, data });
      }
      return asToolText({
        count: data.categories.length,
        categories: data.categories,
      });
    })
  );
}
