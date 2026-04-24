/**
 * Read-only integration tests against the real Splitwise API.
 *
 * Run with:
 *   SPLITWISE_TEST_TOKEN=... bun test tests/client.read.test.ts
 *
 * Or just `bun test` once the token is in `.env`.
 */

import { expect, test } from "bun:test";

import { describeIfToken, dump, makeClient } from "./helpers";

describeIfToken("SplitwiseClient (read-only)", () => {
  const client = makeClient();

  test("GET /get_current_user", async () => {
    const res = await client.getCurrentUser();
    dump("get_current_user", res);

    expect(res.status).toBe(200);
    expect(res.data.user).toBeDefined();
    expect(typeof res.data.user?.id).toBe("number");
  });

  test("GET /get_user/{self}", async () => {
    const me = await client.getCurrentUser();
    const selfId = me.data.user?.id;
    if (!selfId) throw new Error("Could not resolve current user id");

    const res = await client.getUser(selfId);
    dump(`get_user/${selfId}`, res);

    expect(res.status).toBe(200);
    expect(res.data.user?.id).toBe(selfId);
  });

  test("GET /get_friends", async () => {
    const res = await client.getFriends();
    dump("get_friends", res);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.friends)).toBe(true);
  });

  test("GET /get_groups", async () => {
    const res = await client.getGroups();
    dump("get_groups", res);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.groups)).toBe(true);
  });

  test("GET /get_currencies", async () => {
    const res = await client.getCurrencies();
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.currencies)).toBe(true);
    expect(res.data.currencies.length).toBeGreaterThan(0);
  });

  test("GET /get_categories", async () => {
    const res = await client.getCategories();
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.categories)).toBe(true);
    expect(res.data.categories.length).toBeGreaterThan(0);
    expect(Array.isArray(res.data.categories[0]?.subcategories)).toBe(true);
  });

  test("GET /get_expenses (limit=5)", async () => {
    const res = await client.getExpenses({ limit: 5 });
    dump("get_expenses", res);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.expenses)).toBe(true);
  });

  test("GET /get_notifications (limit=5)", async () => {
    const res = await client.getNotifications({ limit: 5 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.notifications)).toBe(true);
  });

  test("GET /get_group/{id} for first real group (if any)", async () => {
    const list = await client.getGroups();
    // Splitwise returns a synthetic group with id 0 for "no group"; skip it.
    const firstRealId = list.data.groups?.find((g) => g.id !== 0)?.id;
    if (!firstRealId) {
      console.log("(no real groups on this account, skipping get_group test)");
      return;
    }

    const res = await client.getGroup(firstRealId);
    dump(`get_group/${firstRealId}`, res);

    expect(res.status).toBe(200);
    expect(res.data.group?.id).toBe(firstRealId);
  });
});
