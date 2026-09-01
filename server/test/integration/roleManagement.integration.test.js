/**
 * Phase 3 的角色管理端點，對一個真的、已經 migrate 過的 MySQL 驗收。設計說明
 * 見 docs/user-management.md §3、§7 Phase 3 的驗收條件。
 *
 * Token 直接用 jwt service 簽發，理由與 userManagement.integration.test.js
 * 相同——這裡要驗的是角色管理端點本身，不是登入或設備簽章。
 *
 * Phase 4 把 permissions/assign 升級成 jwt-device-password 之後，這支也需要
 * 一台「已核准」的設備——理由與作法跟 userManagement.integration.test.js 一樣。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";
import { createTestDevice } from "../../test-support/testDevice.js";

const skip =
  process.env.DB_INTEGRATION_TESTS === "1"
    ? false
    : "set DB_INTEGRATION_TESTS=1 against a real, migrated MySQL to run this suite (see README's CI section)";

async function startApplication() {
  const source = defaultConfigurationSource();
  return createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } }
  });
}

async function seedUser(db, { username, password, roleId }) {
  const passwordHash = await hashPassword(password);
  const nowMs = Date.now();

  const [userResult] = await db.execute(
    `INSERT INTO users (username, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [username, passwordHash, "Integration Test User", nowMs, nowMs]
  );
  const userId = userResult.insertId;

  if (roleId) {
    await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
  }

  return { userId, username };
}

async function cleanupUser(db, userId) {
  await db.execute("DELETE FROM user_audit_logs WHERE actor_user_id = ? OR target_id = ?", [
    userId,
    userId
  ]);
  await db.execute("DELETE FROM user_roles WHERE user_id = ?", [userId]);
  await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  await db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(userId)]);
}

/** 建一個只有指定權限的測試角色，回傳 { roleId, roleName, cleanup() }。 */
async function seedRole(db, { permissionNames = [] } = {}) {
  const nowMs = Date.now();
  const roleName = `it-role-${randomUUID().slice(0, 8)}`;
  const [roleResult] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [
    roleName,
    nowMs
  ]);
  const roleId = roleResult.insertId;

  for (const name of permissionNames) {
    const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = ?", [name]);
    await db.execute(
      "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
      [roleId, permission.id]
    );
  }

  return {
    roleId,
    roleName,
    async cleanup() {
      await db.execute("DELETE FROM user_audit_logs WHERE target_id = ? AND target_type = 'role'", [
        roleId
      ]);
      await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
      await db.execute("DELETE FROM user_roles WHERE role_id = ?", [roleId]);
      await db.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    }
  };
}

async function permissionId(db, name) {
  const [[row]] = await db.query("SELECT id FROM permissions WHERE name = ?", [name]);
  return row.id;
}

async function systemAdminRoleId(db) {
  const [[row]] = await db.query("SELECT id FROM roles WHERE name = 'system-admin'");
  return row.id;
}

/** 直接把一台設備種成 approved，略過申請／審批流程——理由見檔案開頭的說明。 */
async function seedApprovedDevice(db, { userId, device }) {
  const nowMs = Date.now();
  await db.execute(
    `INSERT INTO user_devices
       (user_id, device_id, public_key, label, status, requested_at, requested_ip, requested_ua, reviewed_at)
     VALUES (?, ?, ?, '', 'approved', ?, '', '', ?)`,
    [userId, device.deviceId, device.publicKeyDer, nowMs, nowMs]
  );
}

function tokenIssuer(application) {
  const jwt = application.services.require("jwt");
  const tokenRevocation = application.services.require("tokenRevocation");
  const time = application.services.require("time");

  return async (userId, { roles, permissions, did }) => {
    const version = await tokenRevocation.currentVersion(String(userId));
    const authTime = Math.floor(time.nowMs() / 1000);
    const claims = { roles, permissions };
    if (did) {
      claims.did = did;
    }
    return jwt.issue(claims, { subject: String(userId), version, authTime });
  };
}

const ADMIN_PERMISSIONS = ["user.mgmt", "role.mgmt", "device.mgmt"];

function authed(token, body) {
  return {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

/** 給 jwt-device-password 端點用：Authorization + 設備簽章 header 都要帶。 */
async function signedAuthed(device, token, { path, body }) {
  const bodyText = JSON.stringify(body);
  const headers = await device.headers({ method: "POST", path, body: bodyText, token });
  return { method: "POST", headers: { ...headers, Authorization: `Bearer ${token}` }, body: bodyText };
}

test("system-admin refuses every write path: update, delete, permissions/assign", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-1!";

  const actor = await seedUser(db, {
    username: `it-actor-${randomUUID().slice(0, 8)}`,
    password,
    roleId: await systemAdminRoleId(db)
  });
  const device = await createTestDevice();
  await seedApprovedDevice(db, { userId: actor.userId, device });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: ["system-admin"],
    permissions: ADMIN_PERMISSIONS,
    did: device.deviceId
  });
  const adminRoleId = await systemAdminRoleId(db);

  // 改名／改描述共用同一支端點，這裡各打一次，涵蓋 §1.4 第一道列的兩種情況。
  const rename = await fetch(
    `${url}/api/v1/roles/${adminRoleId}/update`,
    authed(token, { name: "renamed-admin", description: "" })
  );
  assert.equal(rename.status, 409);
  assert.equal((await rename.json()).error.code, "ROLE_PROTECTED");

  const redescribe = await fetch(
    `${url}/api/v1/roles/${adminRoleId}/update`,
    authed(token, { name: "system-admin", description: "改描述也一樣被擋" })
  );
  assert.equal(redescribe.status, 409);
  assert.equal((await redescribe.json()).error.code, "ROLE_PROTECTED");

  const del = await fetch(
    `${url}/api/v1/roles/${adminRoleId}/delete`,
    authed(token, { reason: "測試角色保護", password })
  );
  assert.equal(del.status, 409);
  assert.equal((await del.json()).error.code, "ROLE_PROTECTED");

  const assignPath = `/api/v1/roles/${adminRoleId}/permissions/assign`;
  const assign = await fetch(
    `${url}${assignPath}`,
    await signedAuthed(device, token, {
      path: assignPath,
      body: {
        permissionIds: [await permissionId(db, "user.mgmt")],
        expectedPermissionIds: [
          await permissionId(db, "user.mgmt"),
          await permissionId(db, "role.mgmt"),
          await permissionId(db, "device.mgmt")
        ],
        reason: "測試角色保護",
        password
      }
    })
  );
  assert.equal(assign.status, 409);
  assert.equal((await assign.json()).error.code, "ROLE_PROTECTED");

  const [[stillThere]] = await db.query("SELECT name FROM roles WHERE id = ?", [adminRoleId]);
  assert.equal(stillThere.name, "system-admin");
});

test("an actor holding only role.mgmt cannot grant a role the user.mgmt permission", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-2!";

  const limitedRole = await seedRole(db, { permissionNames: ["role.mgmt"] });
  const targetRole = await seedRole(db, {});
  const actor = await seedUser(db, {
    username: `it-limited-${randomUUID().slice(0, 8)}`,
    password,
    roleId: limitedRole.roleId
  });
  const device = await createTestDevice();
  await seedApprovedDevice(db, { userId: actor.userId, device });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await targetRole.cleanup();
    await limitedRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: [limitedRole.roleName],
    permissions: ["role.mgmt"],
    did: device.deviceId
  });

  const escalatePath = `/api/v1/roles/${targetRole.roleId}/permissions/assign`;
  const response = await fetch(
    `${url}${escalatePath}`,
    await signedAuthed(device, token, {
      path: escalatePath,
      body: {
        permissionIds: [await permissionId(db, "user.mgmt")],
        expectedPermissionIds: [],
        reason: "試圖授予自己沒有的權限",
        password
      }
    })
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "PERMISSION_ESCALATION_DENIED");

  const [[held]] = await db.query(
    "SELECT COUNT(*) AS c FROM role_permissions WHERE role_id = ?",
    [targetRole.roleId]
  );
  assert.equal(held.c, 0, "the escalation must not have taken effect");
});

test("assigning permissions with a stale expected set returns ASSIGNMENT_STALE", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-3!";

  const role = await seedRole(db, { permissionNames: ["user.mgmt"] });
  const actor = await seedUser(db, {
    username: `it-actor-${randomUUID().slice(0, 8)}`,
    password,
    roleId: await systemAdminRoleId(db)
  });
  const device = await createTestDevice();
  await seedApprovedDevice(db, { userId: actor.userId, device });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await role.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: ["system-admin"],
    permissions: ADMIN_PERMISSIONS,
    did: device.deviceId
  });

  const stalePath = `/api/v1/roles/${role.roleId}/permissions/assign`;
  const response = await fetch(
    `${url}${stalePath}`,
    await signedAuthed(device, token, {
      path: stalePath,
      body: {
        permissionIds: [],
        expectedPermissionIds: [], // 畫面上看到的是空的，但這個角色實際上已經有 user.mgmt
        reason: "畫面資料過期",
        password
      }
    })
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "ASSIGNMENT_STALE");

  const [[held]] = await db.query(
    "SELECT COUNT(*) AS c FROM role_permissions WHERE role_id = ?",
    [role.roleId]
  );
  assert.equal(held.c, 1, "the mismatched write must not have happened");
});

test("deleting a role held by users succeeds, and their user_roles rows disappear (CASCADE)", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-4!";

  const role = await seedRole(db, { permissionNames: ["user.mgmt"] });
  const actor = await seedUser(db, {
    username: `it-actor-${randomUUID().slice(0, 8)}`,
    password,
    roleId: await systemAdminRoleId(db)
  });
  const holder = await seedUser(db, {
    username: `it-holder-${randomUUID().slice(0, 8)}`,
    password,
    roleId: role.roleId
  });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await cleanupUser(db, holder.userId);
    // role 已經在測試裡被刪掉，role.cleanup() 的 DELETE FROM roles 會影響 0
    // 列，但 role_permissions／user_roles 那兩句本來就是安全的 no-op。
    await role.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: ["system-admin"],
    permissions: ADMIN_PERMISSIONS
  });

  const [[before]] = await db.query(
    "SELECT COUNT(*) AS c FROM user_roles WHERE user_id = ? AND role_id = ?",
    [holder.userId, role.roleId]
  );
  assert.equal(before.c, 1, "sanity check: the holder must actually hold the role before deletion");

  const response = await fetch(
    `${url}/api/v1/roles/${role.roleId}/delete`,
    authed(token, { reason: "刻意不擋，測 CASCADE 真的會清掉持有人的關聯", password })
  );

  assert.equal(response.status, 200, await response.text());

  const [[afterRole]] = await db.query("SELECT COUNT(*) AS c FROM roles WHERE id = ?", [
    role.roleId
  ]);
  assert.equal(afterRole.c, 0);

  const [[afterHolder]] = await db.query(
    "SELECT COUNT(*) AS c FROM user_roles WHERE user_id = ? AND role_id = ?",
    [holder.userId, role.roleId]
  );
  assert.equal(afterHolder.c, 0, "CASCADE must have removed the holder's user_roles row");

  const [[holderStillExists]] = await db.query("SELECT COUNT(*) AS c FROM users WHERE id = ?", [
    holder.userId
  ]);
  assert.equal(holderStillExists.c, 1, "deleting the role must not delete the user account itself");
});

test("create, list, assign permissions and update a role, with one audit row each", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-5!";

  const actor = await seedUser(db, {
    username: `it-actor-${randomUUID().slice(0, 8)}`,
    password,
    roleId: await systemAdminRoleId(db)
  });
  const device = await createTestDevice();
  await seedApprovedDevice(db, { userId: actor.userId, device });
  let createdRoleId = null;

  t.after(async () => {
    if (createdRoleId !== null) {
      await db.execute("DELETE FROM user_audit_logs WHERE target_id = ? AND target_type = 'role'", [
        createdRoleId
      ]);
      await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [createdRoleId]);
      await db.execute("DELETE FROM roles WHERE id = ?", [createdRoleId]);
    }
    await cleanupUser(db, actor.userId);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: ["system-admin"],
    permissions: ADMIN_PERMISSIONS,
    did: device.deviceId
  });

  const roleName = `it-role-${randomUUID().slice(0, 8)}`;
  const createResponse = await fetch(
    `${url}/api/v1/roles/create`,
    authed(token, { name: roleName, description: "整合測試建立的角色" })
  );
  const createBody = await createResponse.json();
  assert.equal(createResponse.status, 201, JSON.stringify(createBody));
  createdRoleId = createBody.data.id;

  const listResponse = await fetch(`${url}/api/v1/roles`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(listResponse.status, 200);
  const listed = (await listResponse.json()).data.items.find((role) => role.id === createdRoleId);
  assert.ok(listed, "the newly created role must appear in the list");
  assert.deepEqual(listed.permissions, []);
  assert.equal(listed.userCount, 0);

  const assignPath = `/api/v1/roles/${createdRoleId}/permissions/assign`;
  const assignResponse = await fetch(
    `${url}${assignPath}`,
    await signedAuthed(device, token, {
      path: assignPath,
      body: {
        permissionIds: [await permissionId(db, "user.mgmt")],
        expectedPermissionIds: [],
        reason: "整合測試：配權限",
        password
      }
    })
  );
  const assignBody = await assignResponse.json();
  assert.equal(assignResponse.status, 200, JSON.stringify(assignBody));
  assert.deepEqual(assignBody.data.permissions, ["user.mgmt"]);

  const updateResponse = await fetch(
    `${url}/api/v1/roles/${createdRoleId}/update`,
    authed(token, { name: roleName, description: "改過的描述" })
  );
  assert.equal(updateResponse.status, 200);

  const permissionsResponse = await fetch(`${url}/api/v1/permissions`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(permissionsResponse.status, 200);
  const permissionNames = (await permissionsResponse.json()).data.items.map((p) => p.name);
  // 只驗證目錄涵蓋這三個，不驗證「剛好只有」這三個：node --test 預設會跨檔案
  // 平行跑，這句可能剛好夾在另一個整合測試檔案（例如 authFlow）暫時種下的
  // 一次性權限中間，那不是這個端點的錯。
  for (const name of ["device.mgmt", "role.mgmt", "user.mgmt"]) {
    assert.ok(permissionNames.includes(name), `permission catalogue is missing ${name}`);
  }

  const [auditRows] = await db.query(
    "SELECT action FROM user_audit_logs WHERE target_id = ? AND target_type = 'role' ORDER BY id",
    [createdRoleId]
  );
  assert.deepEqual(
    auditRows.map((row) => row.action),
    ["role.create", "role.permissions", "role.update"]
  );
});
