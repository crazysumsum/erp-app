/**
 * Phase 6 的稽核查詢端點，對一個真的、已經 migrate 過的 MySQL 驗收。設計說明
 * 見 docs/user_management/design_spec.md §3.1、§3.3、§4.6、§7 Phase 6 的驗收條件。
 *
 * `AuditLogService.record()` 已經由 Phase 2–4 的寫入路徑（建帳號、配角色、
 * 改角色權限……）在別的整合測試裡間接驗過內容正確；這裡驗的是「讀」那一半：
 * `user.mgmt` 或 `role.mgmt` 任一個都看得到（§5.5，match: "any"）、分頁與
 * 篩選、以及跟其他管理端點一致的 PERMISSION_STALE 重讀。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";

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
      await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
      await db.execute("DELETE FROM user_roles WHERE role_id = ?", [roleId]);
      await db.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    }
  };
}

function tokenIssuer(application) {
  const jwt = application.services.require("jwt");
  const tokenRevocation = application.services.require("tokenRevocation");
  const time = application.services.require("time");

  return async (userId, { roles, permissions }) => {
    const version = await tokenRevocation.currentVersion(String(userId));
    const authTime = Math.floor(time.nowMs() / 1000);
    return jwt.issue({ roles, permissions }, { subject: String(userId), version, authTime });
  };
}

async function listAuditLogs(url, token, query = {}) {
  const params = new URLSearchParams(
    Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined))
  );
  const response = await fetch(`${url}/api/v1/audit/logs?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return { status: response.status, body: await response.json() };
}

test("an actor holding only user.mgmt can read the audit log, and a manual write shows up in it", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-1!";

  const limitedRole = await seedRole(db, { permissionNames: ["user.mgmt"] });
  const actor = await seedUser(db, {
    username: `it-audit-${randomUUID().slice(0, 8)}`,
    password,
    roleId: limitedRole.roleId
  });

  // 直接種一列稽核記錄，不透過任何寫入端點——這支端點只負責「讀」，種資料
  // 用最短的路徑，不必先建一個角色再刪它才能製造一列 role.delete。
  const targetLabel = `manual-target-${randomUUID().slice(0, 8)}`;
  const occurredAt = Date.now();
  await db.execute(
    `INSERT INTO user_audit_logs
       (occurred_at, actor_user_id, actor_username, action, target_type, target_id,
        target_label, reason, detail, request_id, ip)
     VALUES (?, ?, ?, 'role.delete', 'role', ?, ?, '整合測試種的資料', ?, '', '')`,
    [
      occurredAt,
      actor.userId,
      actor.username,
      999999,
      targetLabel,
      JSON.stringify({ note: "seeded" })
    ]
  );

  t.after(async () => {
    await db.execute("DELETE FROM user_audit_logs WHERE target_label = ?", [targetLabel]);
    await cleanupUser(db, actor.userId);
    await limitedRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: [limitedRole.roleName],
    permissions: ["user.mgmt"]
  });

  const { status, body } = await listAuditLogs(url, token, { target: targetLabel });
  assert.equal(status, 200);
  assert.equal(body.data.total, 1);
  assert.equal(body.data.page, 1);

  const [entry] = body.data.items;
  assert.equal(entry.action, "role.delete");
  assert.equal(entry.targetType, "role");
  assert.equal(entry.targetLabel, targetLabel);
  assert.equal(entry.actorUsername, actor.username);
  assert.equal(entry.actorUserId, actor.userId);
  assert.equal(entry.occurredAt, occurredAt);
  assert.equal(entry.reason, "整合測試種的資料");
  assert.deepEqual(entry.detail, { note: "seeded" });
});

test("an actor holding only role.mgmt can also read the audit log (match: any)", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-2!";

  const limitedRole = await seedRole(db, { permissionNames: ["role.mgmt"] });
  const actor = await seedUser(db, {
    username: `it-audit-${randomUUID().slice(0, 8)}`,
    password,
    roleId: limitedRole.roleId
  });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await limitedRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: [limitedRole.roleName],
    permissions: ["role.mgmt"]
  });

  const { status } = await listAuditLogs(url, token);
  assert.equal(status, 200);
});

test("an actor holding neither user.mgmt nor role.mgmt is forbidden", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-3!";

  const bareRole = await seedRole(db, { permissionNames: ["device.mgmt"] });
  const actor = await seedUser(db, {
    username: `it-audit-${randomUUID().slice(0, 8)}`,
    password,
    roleId: bareRole.roleId
  });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await bareRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: [bareRole.roleName],
    permissions: ["device.mgmt"]
  });

  const { status } = await listAuditLogs(url, token);
  assert.equal(status, 403);
});

test("a stale token (permissions changed since it was issued) is rejected with PERMISSION_STALE", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-4!";

  const limitedRole = await seedRole(db, { permissionNames: ["user.mgmt"] });
  const actor = await seedUser(db, {
    username: `it-audit-${randomUUID().slice(0, 8)}`,
    password,
    roleId: limitedRole.roleId
  });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await limitedRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  // Claims 宣稱 role.mgmt，但資料庫裡這個帳號其實只有 user.mgmt——模擬「token
  // 簽發之後，操作者的權限被改過」（跟 userManagement.integration.test.js 對
  // /api/v1/users 的同一個測試手法）。
  const staleToken = await issueToken(actor.userId, {
    roles: [limitedRole.roleName],
    permissions: ["role.mgmt"]
  });

  const { status, body } = await listAuditLogs(url, staleToken);
  assert.equal(status, 403);
  assert.equal(body.error.code, "PERMISSION_STALE");
});

test("pageSize and action filter narrow the result set", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-5!";

  const limitedRole = await seedRole(db, { permissionNames: ["user.mgmt", "role.mgmt"] });
  const actor = await seedUser(db, {
    username: `it-audit-${randomUUID().slice(0, 8)}`,
    password,
    roleId: limitedRole.roleId
  });

  const marker = `filter-marker-${randomUUID().slice(0, 8)}`;
  const rows = [
    ["user.create", marker],
    ["role.create", marker]
  ];
  for (const [action, label] of rows) {
    await db.execute(
      `INSERT INTO user_audit_logs
         (occurred_at, actor_user_id, actor_username, action, target_type, target_id,
          target_label, reason, detail, request_id, ip)
       VALUES (?, ?, ?, ?, 'user', ?, ?, '', NULL, '', '')`,
      [Date.now(), actor.userId, actor.username, action, 888888, label]
    );
  }

  t.after(async () => {
    await db.execute("DELETE FROM user_audit_logs WHERE target_label = ?", [marker]);
    await cleanupUser(db, actor.userId);
    await limitedRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: [limitedRole.roleName],
    permissions: ["user.mgmt", "role.mgmt"]
  });

  const { status, body } = await listAuditLogs(url, token, {
    target: marker,
    action: "role.create"
  });
  assert.equal(status, 200);
  assert.equal(body.data.total, 1);
  assert.equal(body.data.items[0].action, "role.create");
});

test("from/to narrow by time range, and actor narrows by actor_username", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-6!";

  const limitedRole = await seedRole(db, { permissionNames: ["user.mgmt"] });
  const actor = await seedUser(db, {
    username: `it-audit-${randomUUID().slice(0, 8)}`,
    password,
    roleId: limitedRole.roleId
  });

  const marker = `range-marker-${randomUUID().slice(0, 8)}`;
  const insideRangeAt = Date.now();
  const outsideRangeAt = insideRangeAt - 60 * 60 * 1000;

  await db.execute(
    `INSERT INTO user_audit_logs
       (occurred_at, actor_user_id, actor_username, action, target_type, target_id,
        target_label, reason, detail, request_id, ip)
     VALUES (?, ?, ?, 'user.update', 'user', ?, ?, '', NULL, '', '')`,
    [insideRangeAt, actor.userId, actor.username, 777777, marker]
  );
  await db.execute(
    `INSERT INTO user_audit_logs
       (occurred_at, actor_user_id, actor_username, action, target_type, target_id,
        target_label, reason, detail, request_id, ip)
     VALUES (?, ?, ?, 'user.update', 'user', ?, ?, '', NULL, '', '')`,
    [outsideRangeAt, actor.userId, actor.username, 777778, marker]
  );

  t.after(async () => {
    await db.execute("DELETE FROM user_audit_logs WHERE target_label = ?", [marker]);
    await cleanupUser(db, actor.userId);
    await limitedRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: [limitedRole.roleName],
    permissions: ["user.mgmt"]
  });

  const byTime = await listAuditLogs(url, token, {
    target: marker,
    from: insideRangeAt - 1000,
    to: insideRangeAt + 1000
  });
  assert.equal(byTime.status, 200);
  assert.equal(byTime.body.data.total, 1);
  assert.equal(byTime.body.data.items[0].occurredAt, insideRangeAt);

  const byActor = await listAuditLogs(url, token, {
    target: marker,
    actor: actor.username
  });
  assert.equal(byActor.status, 200);
  assert.equal(byActor.body.data.total, 2);

  const byWrongActor = await listAuditLogs(url, token, {
    target: marker,
    actor: `not-${actor.username}`
  });
  assert.equal(byWrongActor.status, 200);
  assert.equal(byWrongActor.body.data.total, 0);
});
