import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLastActiveAdminPreserved,
  assertNoPermissionEscalation,
  assertPermissionsCurrent,
  assertRoleNotProtected,
  newlyGrantedPermissions,
  wouldRemoveLastActiveAdmin
} from "../src/modules/authorization/adminGuard.js";

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected function to throw");
}

function code(fn) {
  return captureError(fn).code;
}

// --- 第一道：system-admin 不可改不可刪 --------------------------------------

test("assertRoleNotProtected refuses the protected role", () => {
  assert.equal(code(() => assertRoleNotProtected("system-admin")), "ROLE_PROTECTED");
});

test("assertRoleNotProtected allows any other role", () => {
  assert.doesNotThrow(() => assertRoleNotProtected("staff"));
});

// --- 第二道：授不出自己沒有的權限 ---------------------------------------------

test("newlyGrantedPermissions only returns what was added", () => {
  assert.deepEqual(
    newlyGrantedPermissions(["user.mgmt"], ["user.mgmt", "role.mgmt"]),
    ["role.mgmt"]
  );
});

test("newlyGrantedPermissions is empty when nothing new is added", () => {
  // 拔光角色（next 是空集合）不該算成「新增」了任何東西。
  assert.deepEqual(newlyGrantedPermissions(["user.mgmt", "role.mgmt"], []), []);
});

test("newlyGrantedPermissions ignores what was removed", () => {
  assert.deepEqual(newlyGrantedPermissions(["user.mgmt", "role.mgmt"], ["user.mgmt"]), []);
});

test("newlyGrantedPermissions de-duplicates", () => {
  // 兩個角色都帶 device.mgmt 的情況：next 由角色聯集算出，可能含重複。
  assert.deepEqual(
    newlyGrantedPermissions([], ["device.mgmt", "device.mgmt"]),
    ["device.mgmt"]
  );
});

test("assertNoPermissionEscalation allows granting a subset of the actor's own permissions", () => {
  assert.doesNotThrow(() =>
    assertNoPermissionEscalation({
      actorPermissions: ["user.mgmt", "role.mgmt", "device.mgmt"],
      grantedPermissions: ["device.mgmt"]
    })
  );
});

test("assertNoPermissionEscalation allows granting nothing", () => {
  assert.doesNotThrow(() =>
    assertNoPermissionEscalation({ actorPermissions: [], grantedPermissions: [] })
  );
});

test("assertNoPermissionEscalation denies a permission the actor does not hold", () => {
  const error = captureError(() =>
    assertNoPermissionEscalation({
      actorPermissions: ["user.mgmt"],
      grantedPermissions: ["role.mgmt"]
    })
  );
  assert.equal(error.code, "PERMISSION_ESCALATION_DENIED");
  assert.equal(error.statusCode, 403);
  assert.deepEqual(error.details.permissions, ["role.mgmt"]);
  // errorHandler.js only serializes publicDetails into the HTTP response body
  // (see framework/middleware/errorHandler.js); .details never leaves the
  // server. FormPanel.vue reads response.error.details to highlight the
  // offending field, so this must be set too, not just .details.
  assert.deepEqual(error.publicDetails, error.details);
});

test("assertNoPermissionEscalation denies self-assigning system-admin with only user.mgmt", () => {
  // 這是 §1.4 舉的那個具體例子：只有 user.mgmt 的人把 system-admin 指派給
  // 自己——system-admin 帶著 role.mgmt 與 device.mgmt，兩者都不在操作者的
  // 權限集合裡。
  const error = captureError(() =>
    assertNoPermissionEscalation({
      actorPermissions: ["user.mgmt"],
      grantedPermissions: ["user.mgmt", "role.mgmt", "device.mgmt"]
    })
  );
  assert.equal(error.code, "PERMISSION_ESCALATION_DENIED");
  assert.deepEqual(error.details.permissions.sort(), ["device.mgmt", "role.mgmt"]);
});

test("assertNoPermissionEscalation allows system-admin to grant anything", () => {
  assert.doesNotThrow(() =>
    assertNoPermissionEscalation({
      actorPermissions: ["user.mgmt", "role.mgmt", "device.mgmt"],
      grantedPermissions: ["user.mgmt", "role.mgmt", "device.mgmt"]
    })
  );
});

// --- 第三道：最後一個 system-admin -------------------------------------------

test("wouldRemoveLastActiveAdmin is false for someone who was never an admin", () => {
  assert.equal(
    wouldRemoveLastActiveAdmin({
      currentRoleNames: ["staff"],
      nextRoleNames: [],
      otherActiveAdminCount: 0
    }),
    false
  );
});

test("wouldRemoveLastActiveAdmin is false when the admin role is kept", () => {
  assert.equal(
    wouldRemoveLastActiveAdmin({
      currentRoleNames: ["system-admin"],
      nextRoleNames: ["system-admin", "staff"],
      otherActiveAdminCount: 0
    }),
    false
  );
});

test("wouldRemoveLastActiveAdmin is false when another active admin exists", () => {
  assert.equal(
    wouldRemoveLastActiveAdmin({
      currentRoleNames: ["system-admin"],
      nextRoleNames: [],
      otherActiveAdminCount: 1
    }),
    false
  );
});

test("wouldRemoveLastActiveAdmin is true for the last admin losing the role", () => {
  assert.equal(
    wouldRemoveLastActiveAdmin({
      currentRoleNames: ["system-admin"],
      nextRoleNames: ["staff"],
      otherActiveAdminCount: 0
    }),
    true
  );
});

test("assertLastActiveAdminPreserved throws LAST_ADMIN_PROTECTED for the last admin", () => {
  const error = captureError(() =>
    assertLastActiveAdminPreserved({
      currentRoleNames: ["system-admin"],
      nextRoleNames: [],
      otherActiveAdminCount: 0
    })
  );
  assert.equal(error.code, "LAST_ADMIN_PROTECTED");
  assert.equal(error.statusCode, 409);
});

test("assertLastActiveAdminPreserved allows it when a backup admin exists", () => {
  assert.doesNotThrow(() =>
    assertLastActiveAdminPreserved({
      currentRoleNames: ["system-admin"],
      nextRoleNames: [],
      otherActiveAdminCount: 1
    })
  );
});

// --- 第四道：操作者的權限是不是還跟 token 一樣 --------------------------------

test("assertPermissionsCurrent allows a match regardless of order", () => {
  assert.doesNotThrow(() =>
    assertPermissionsCurrent({
      claimedRoles: ["system-admin"],
      claimedPermissions: ["user.mgmt", "role.mgmt"],
      currentRoles: ["system-admin"],
      currentPermissions: ["role.mgmt", "user.mgmt"]
    })
  );
});

test("assertPermissionsCurrent rejects a revoked permission", () => {
  const error = captureError(() =>
    assertPermissionsCurrent({
      claimedRoles: ["system-admin"],
      claimedPermissions: ["user.mgmt", "role.mgmt"],
      currentRoles: ["system-admin"],
      currentPermissions: ["user.mgmt"]
    })
  );
  assert.equal(error.code, "PERMISSION_STALE");
  assert.equal(error.statusCode, 403);
});

test("assertPermissionsCurrent rejects an added permission too", () => {
  // 不是只有「少了」才算 stale——多了也代表 claims 跟現況對不上，claims 裡的
  // 集合已經不是操作者現在真正持有的那一組。
  assert.throws(() =>
    assertPermissionsCurrent({
      claimedRoles: [],
      claimedPermissions: ["user.mgmt"],
      currentRoles: [],
      currentPermissions: ["user.mgmt", "role.mgmt"]
    }),
    { code: "PERMISSION_STALE" }
  );
});

test("assertPermissionsCurrent rejects a role change even if permissions coincidentally match", () => {
  assert.throws(
    () =>
      assertPermissionsCurrent({
        claimedRoles: ["staff"],
        claimedPermissions: ["user.mgmt"],
        currentRoles: ["other-role"],
        currentPermissions: ["user.mgmt"]
      }),
    { code: "PERMISSION_STALE" }
  );
});
