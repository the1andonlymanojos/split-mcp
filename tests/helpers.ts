/**
 * Shared helpers for integration tests that hit the real Splitwise API.
 *
 * Tests are gated on two env vars (Bun auto-loads `.env` so just drop them
 * there):
 *
 *   SPLITWISE_TEST_TOKEN  — OAuth bearer token for a real Splitwise user.
 *                           Grab one by running the server (`bun run dev`),
 *                           completing the OAuth flow, and copying the token
 *                           out of the `/mcp` request headers (or the server
 *                           logs).
 *
 *   SPLITWISE_TEST_WRITE  — set to `1` to opt into mutating tests
 *                           (create_group / delete_group / update_user etc).
 *                           Read-only tests run whenever TOKEN is set.
 */

import { test, describe } from "bun:test";

import { SplitwiseClient } from "../src/splitwise/client";

export const TOKEN = Bun.env.SPLITWISE_TEST_TOKEN;
export const WRITE_ENABLED = Bun.env.SPLITWISE_TEST_WRITE === "1";

/** `test` when the token is set, `test.skip` otherwise. */
export const testIfToken = TOKEN ? test : test.skip;

/** `describe` when the token is set, `describe.skip` otherwise. */
export const describeIfToken = TOKEN ? describe : describe.skip;

/** `test` when both TOKEN and WRITE flag are set, `test.skip` otherwise. */
export const testIfWrite = TOKEN && WRITE_ENABLED ? test : test.skip;

/**
 * Build a client from the env token. Throws if missing so individual tests
 * fail loudly rather than silently hitting the API unauthenticated.
 */
export function makeClient(): SplitwiseClient {
  if (!TOKEN) {
    throw new Error(
      "SPLITWISE_TEST_TOKEN is not set. Add it to .env to run integration tests."
    );
  }
  return new SplitwiseClient(TOKEN);
}

/** Pretty-print a labelled payload so `bun test` output is observable. */
export function dump(label: string, value: unknown): void {
  console.log(`\n── ${label} ──`);
  console.log(JSON.stringify(value, null, 2));
}
