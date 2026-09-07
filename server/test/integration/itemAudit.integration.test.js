/**
 * T11 的稽核查詢端點，對一個真的、已經 migrate 過的 MySQL 驗收。設計說明見
 * docs/items_management/design_spec.md §6.7、§8.7。
 *
 * `ItemAuditLogService.record()` 已經由 T05–T09 的 Catalog 寫入路徑（建立、
 * 修改、狀態變更、刪除 Category／Brand／UOM）在 itemCatalog.integration
 * .test.js 裡間接驗過內容正確；這裡驗的是「讀」那一半：只有 item.view 先
 * 睇得到（跟 user audit 的「user.mgmt 或 role.mgmt 任一」不同，Item audit
 * 淨係得一種「睇」嘅權限）、分頁與篩選（含 user audit 冇嘅 targetType）、
 * 以及跟其他管理端點一致的 PERMISSION_STALE 重讀。
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
  await db.execute("DELETE FROM item_audit_logs WHERE actor_user_id = ?", [userId]);
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
    await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [
      roleId,
      permission.id
    ]);
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

async function listItemAuditLogs(url, token, query = {}) {
  const params = new URLSearchParams(
    Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined))
  );
  const response = await fetch(`${url}/api/v1/item-audit/logs?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return { status: response.status, body: await response.json() };
}

test("持有 item.view 可以讀 item audit，手動種的一列會出現在結果裡", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-1!";

  const limitedRole = await seedRole(db, { permissionNames: ["item.view"] });
  const actor = await seedUser(db, {
    username: `it-item-audit-${randomUUID().slice(0, 8)}`,
    password,
    roleId: limitedRole.roleId
  });

  // 直接種一列稽核記錄，不透過任何寫入端點——這支端點只負責「讀」。
  const targetLabel = `manual-target-${randomUUID().slice(0, 8)}`;
  const occurredAt = Date.now();
  await db.execute(
    `INSERT INTO item_audit_logs
       (occurred_at, actor_user_id, actor_username, action, target_type, target_id,
        target_label, reason, detail, request_id, ip)
     VALUES (?, ?, ?, 'category.delete', 'category', ?, ?, '整合測試種的資料', ?, '', '')`,
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
    await db.execute("DELETE FROM item_audit_logs WHERE target_label = ?", [targetLabel]);
    await cleanupUser(db, actor.userId);
    await limitedRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: [limitedRole.roleName],
    permissions: ["item.view"]
  });

  const { status, body } = await listItemAuditLogs(url, token, { target: targetLabel });
  assert.equal(status, 200);
  assert.equal(body.data.total, 1);
  assert.equal(body.data.page, 1);

  const [entry] = body.data.items;
  assert.equal(entry.action, "category.delete");
  assert.equal(entry.targetType, "category");
  assert.equal(entry.targetLabel, targetLabel);
  assert.equal(entry.actorUsername, actor.username);
  assert.equal(entry.actorUserId, actor.userId);
  assert.equal(entry.occurredAt, occurredAt);
  assert.equal(entry.reason, "整合測試種的資料");
  assert.deepEqual(entry.detail, { note: "seeded" });
});

test("只有 item.mgmt 而沒有 item.view 一律 403（跟 Catalog 讀 API 同一條規則，沒有 permission inheritance）", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-2!";

  const bareRole = await seedRole(db, { permissionNames: ["item.mgmt"] });
  const actor = await seedUser(db, {
    username: `it-item-audit-${randomUUID().slice(0, 8)}`,
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
    permissions: ["item.mgmt"]
  });

  const { status } = await listItemAuditLogs(url, token);
  assert.equal(status, 403);
});

test("token 宣稱的權限與資料庫現況不符時回 403 PERMISSION_STALE", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-3!";

  const limitedRole = await seedRole(db, { permissionNames: ["item.view"] });
  const actor = await seedUser(db, {
    username: `it-item-audit-${randomUUID().slice(0, 8)}`,
    password,
    roleId: limitedRole.roleId
  });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await limitedRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  // Claims 要滿足 authorizationPolicies 嗰道靜態檢查（要有 item.view）先會
  // 行到 service 入面嘅 assertActorFresh，所以呢度宣稱 item.view＋item.mgmt
  // 兩個，但資料庫裡呢個角色實際上只有 item.view——一多一少就係「token 簽發
  // 之後，操作者的權限被改過」嗰個情況。
  const staleToken = await issueToken(actor.userId, {
    roles: [limitedRole.roleName],
    permissions: ["item.view", "item.mgmt"]
  });

  const { status, body } = await listItemAuditLogs(url, staleToken);
  assert.equal(status, 403);
  assert.equal(body.error.code, "PERMISSION_STALE");
});

test("pageSize、action 與 targetType 篩選會收窄結果", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-4!";

  const limitedRole = await seedRole(db, { permissionNames: ["item.view"] });
  const actor = await seedUser(db, {
    username: `it-item-audit-${randomUUID().slice(0, 8)}`,
    password,
    roleId: limitedRole.roleId
  });

  const marker = `filter-marker-${randomUUID().slice(0, 8)}`;
  const rows = [
    ["category.create", "category"],
    ["brand.create", "brand"]
  ];
  for (const [action, targetType] of rows) {
    await db.execute(
      `INSERT INTO item_audit_logs
         (occurred_at, actor_user_id, actor_username, action, target_type, target_id,
          target_label, reason, detail, request_id, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', NULL, '', '')`,
      [Date.now(), actor.userId, actor.username, action, targetType, 888888, marker]
    );
  }

  t.after(async () => {
    await db.execute("DELETE FROM item_audit_logs WHERE target_label = ?", [marker]);
    await cleanupUser(db, actor.userId);
    await limitedRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: [limitedRole.roleName],
    permissions: ["item.view"]
  });

  const byAction = await listItemAuditLogs(url, token, { target: marker, action: "brand.create" });
  assert.equal(byAction.status, 200);
  assert.equal(byAction.body.data.total, 1);
  assert.equal(byAction.body.data.items[0].action, "brand.create");

  const byTargetType = await listItemAuditLogs(url, token, { target: marker, targetType: "category" });
  assert.equal(byTargetType.status, 200);
  assert.equal(byTargetType.body.data.total, 1);
  assert.equal(byTargetType.body.data.items[0].targetType, "category");

  const both = await listItemAuditLogs(url, token, { target: marker });
  assert.equal(both.status, 200);
  assert.equal(both.body.data.total, 2);
});

test("from／to 依時間範圍篩選，actor 依 actor_username 篩選", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-5!";

  const limitedRole = await seedRole(db, { permissionNames: ["item.view"] });
  const actor = await seedUser(db, {
    username: `it-item-audit-${randomUUID().slice(0, 8)}`,
    password,
    roleId: limitedRole.roleId
  });

  const marker = `range-marker-${randomUUID().slice(0, 8)}`;
  const insideRangeAt = Date.now();
  const outsideRangeAt = insideRangeAt - 60 * 60 * 1000;

  await db.execute(
    `INSERT INTO item_audit_logs
       (occurred_at, actor_user_id, actor_username, action, target_type, target_id,
        target_label, reason, detail, request_id, ip)
     VALUES (?, ?, ?, 'category.update', 'category', ?, ?, '', NULL, '', '')`,
    [insideRangeAt, actor.userId, actor.username, 777777, marker]
  );
  await db.execute(
    `INSERT INTO item_audit_logs
       (occurred_at, actor_user_id, actor_username, action, target_type, target_id,
        target_label, reason, detail, request_id, ip)
     VALUES (?, ?, ?, 'category.update', 'category', ?, ?, '', NULL, '', '')`,
    [outsideRangeAt, actor.userId, actor.username, 777778, marker]
  );

  t.after(async () => {
    await db.execute("DELETE FROM item_audit_logs WHERE target_label = ?", [marker]);
    await cleanupUser(db, actor.userId);
    await limitedRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: [limitedRole.roleName],
    permissions: ["item.view"]
  });

  const byTime = await listItemAuditLogs(url, token, {
    target: marker,
    from: insideRangeAt - 1000,
    to: insideRangeAt + 1000
  });
  assert.equal(byTime.status, 200);
  assert.equal(byTime.body.data.total, 1);
  assert.equal(byTime.body.data.items[0].occurredAt, insideRangeAt);

  const byActor = await listItemAuditLogs(url, token, { target: marker, actor: actor.username });
  assert.equal(byActor.status, 200);
  assert.equal(byActor.body.data.total, 2);

  const byWrongActor = await listItemAuditLogs(url, token, {
    target: marker,
    actor: `not-${actor.username}`
  });
  assert.equal(byWrongActor.status, 200);
  assert.equal(byWrongActor.body.data.total, 0);
});
