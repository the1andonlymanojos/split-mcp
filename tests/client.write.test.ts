/**
 * Mutating integration tests. These actually create and delete real groups
 * on the authenticated user's account, so they're gated behind an explicit
 * opt-in env var.
 *
 * Run with:
 *   SPLITWISE_TEST_TOKEN=... SPLITWISE_TEST_WRITE=1 bun test tests/client.write.test.ts
 *
 * The lifecycle test always tries to clean up after itself, but if it bails
 * out mid-flight you may be left with a `mcp-test <timestamp>` group in
 * your Splitwise account — safe to delete manually.
 */

import { describe, expect } from "bun:test";

import { testIfWrite, dump, makeClient, WRITE_ENABLED, TOKEN } from "./helpers";

describe("SplitwiseClient (mutating)", () => {
  if (!TOKEN || !WRITE_ENABLED) {
    console.log(
      "(skipping write tests — set SPLITWISE_TEST_TOKEN and SPLITWISE_TEST_WRITE=1 to run)"
    );
  }

  testIfWrite(
    "group lifecycle: create → add self → get → delete → undelete → delete",
    async () => {
      const client = makeClient();

      const me = await client.getCurrentUser();
      const selfId = me.data.user?.id;
      if (!selfId) throw new Error("Could not resolve current user id");

      const groupName = `mcp-test ${new Date().toISOString()}`;

      // 1. create
      const created = await client.createGroup({
        name: groupName,
        group_type: "other",
        simplify_by_default: false,
        users__0__user_id: selfId,
      });
      dump("create_group", created);
      expect(created.status).toBe(200);
      const groupId = created.data.group?.id;
      expect(typeof groupId).toBe("number");
      if (!groupId) throw new Error("create_group did not return an id");

      try {
        // 2. read back
        const fetched = await client.getGroup(groupId);
        dump(`get_group/${groupId}`, fetched);
        expect(fetched.status).toBe(200);
        expect(fetched.data.group?.name).toBe(groupName);

        // 3. add self (no-op if already a member, but exercises the endpoint)
        const added = await client.addUserToGroup({
          group_id: groupId,
          user_id: selfId,
        });
        dump("add_user_to_group", added);
        expect(added.status).toBe(200);
      } finally {
        // 4. delete
        const deleted = await client.deleteGroup(groupId);
        dump(`delete_group/${groupId}`, deleted);
        expect(deleted.status).toBe(200);
        expect(deleted.data.success).toBe(true);

        // 5. undelete
        const undeleted = await client.undeleteGroup(groupId);
        dump(`undelete_group/${groupId}`, undeleted);
        expect(undeleted.status).toBe(200);
        expect(undeleted.data.success).toBe(true);

        // 6. delete again to leave the account clean
        const finalDelete = await client.deleteGroup(groupId);
        dump(`delete_group/${groupId} (cleanup)`, finalDelete);
        expect(finalDelete.status).toBe(200);
      }
    },
    30_000
  );

  testIfWrite("POST /update_user (no-op round-trip)", async () => {
    const client = makeClient();

    const me = await client.getCurrentUser();
    const user = me.data.user;
    if (!user) throw new Error("Could not resolve current user");

    // Send the user's existing name back — this is a no-op but still
    // verifies the endpoint accepts our payload shape.
    const res = await client.updateUser(user.id, {
      first_name: user.first_name,
      last_name: user.last_name ?? undefined,
    });
    dump(`update_user/${user.id}`, res);

    expect(res.status).toBe(200);
  });
});
