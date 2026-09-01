import assert from "node:assert/strict";
import test from "node:test";
import {
  assertActorFresh,
  loadPermissionNamesForUser,
  loadRoleNamesForUser
} from "../src/modules/authorization/directoryLookups.js";

/**
 * `UserAdminService` 與 `RoleAdminService` 的單元測試都用各自的替身資料庫走過
 * 這段邏輯（等於間接測過了），這裡另外直接測，是因為這個檔案本身要單獨對得起
 * 「兩個呼叫端共用同一份，不是各自抄一份」這件事——分岔的成本現在由這裡的
 * 測試接住，不必等到某個服務的測試順便測到。
 */

function fakeConnection({ users = [], userRoles = {}, permissions = {} } = {}) {
  return {
    query: async (sql, params) => {
      if (sql.includes("SELECT username FROM users WHERE id = ? AND status = 'active'")) {
        const user = users.find((u) => u.id === params[0] && u.status === "active");
        return [user ? [{ username: user.username }] : []];
      }
      if (sql.includes("FROM roles r JOIN user_roles ur")) {
        return [(userRoles[params[0]] ?? []).map((name) => ({ name })).sort((a, b) => a.name.localeCompare(b.name))];
      }
      if (sql.includes("JOIN user_roles ur ON ur.role_id = rp.role_id")) {
        return [(permissions[params[0]] ?? []).map((name) => ({ name })).sort((a, b) => a.name.localeCompare(b.name))];
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    }
  };
}

test("loadRoleNamesForUser returns sorted role names", async () => {
  const connection = fakeConnection({ userRoles: { 5: ["staff", "auditor"] } });
  assert.deepEqual(await loadRoleNamesForUser(connection, 5), ["auditor", "staff"]);
});

test("loadRoleNamesForUser returns an empty array for a user with no roles", async () => {
  const connection = fakeConnection();
  assert.deepEqual(await loadRoleNamesForUser(connection, 5), []);
});

test("loadPermissionNamesForUser returns sorted permission names", async () => {
  const connection = fakeConnection({ permissions: { 5: ["user.mgmt", "device.mgmt"] } });
  assert.deepEqual(await loadPermissionNamesForUser(connection, 5), ["device.mgmt", "user.mgmt"]);
});

test("assertActorFresh returns the actor's current roles and permissions on a match", async () => {
  const connection = fakeConnection({
    users: [{ id: 5, username: "sam", status: "active" }],
    userRoles: { 5: ["system-admin"] },
    permissions: { 5: ["user.mgmt", "role.mgmt"] }
  });

  const actor = await assertActorFresh(connection, {
    actorId: 5,
    claimedRoles: ["system-admin"],
    claimedPermissions: ["role.mgmt", "user.mgmt"]
  });

  assert.deepEqual(actor, {
    id: 5,
    username: "sam",
    roles: ["system-admin"],
    permissions: ["role.mgmt", "user.mgmt"]
  });
});

test("assertActorFresh rejects when claims no longer match the database", async () => {
  const connection = fakeConnection({
    users: [{ id: 5, username: "sam", status: "active" }],
    userRoles: { 5: ["system-admin"] },
    permissions: { 5: ["user.mgmt"] }
  });

  await assert.rejects(
    () =>
      assertActorFresh(connection, {
        actorId: 5,
        claimedRoles: ["system-admin"],
        claimedPermissions: ["user.mgmt", "role.mgmt"]
      }),
    { code: "PERMISSION_STALE" }
  );
});

test("assertActorFresh treats a missing or inactive actor as holding nothing", async () => {
  const connection = fakeConnection({ users: [] });

  await assert.rejects(
    () =>
      assertActorFresh(connection, {
        actorId: 999,
        claimedRoles: ["system-admin"],
        claimedPermissions: ["user.mgmt"]
      }),
    { code: "PERMISSION_STALE" }
  );
});
