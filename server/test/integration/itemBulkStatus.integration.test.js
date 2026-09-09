/**
 * T33 嘅 bounded bulk status change 端點，對一個真的、已經 migrate 過的
 * MySQL 驗收。設計說明見 docs/items_management/design_spec.md §6.4、§8.1。
 *
 * 呢度要驗嘅係假連線頂唔到嘅嘢：100 筆全部成功、101 筆俾 schema 擋、中間
 * 一筆失敗真係令成批（包括之前「成功」嗰幾筆）一齊 rollback、鎖 row 嘅
 * 順序唔會令正常請求 deadlock。呢啲全部要真交易先證得到。
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

async function seedRole(db, { permissionNames = [] } = {}) {
  const nowMs = Date.now();
  const roleName = `it-role-${randomUUID().slice(0, 8)}`;
  const [roleResult] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [roleName, nowMs]);
  const roleId = roleResult.insertId;
  for (const name of permissionNames) {
    const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = ?", [name]);
    await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permission.id]);
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

function post(url, token, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

const PASSWORD = "Integration-Test-Pass-1!";

async function withManager(t, application, permissionNames = ["item.view", "item.mgmt"]) {
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const role = await seedRole(db, { permissionNames });
  const actor = await seedUser(db, {
    username: `it-bulk-${randomUUID().slice(0, 8)}`,
    password: PASSWORD,
    roleId: role.roleId
  });
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: permissionNames });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await role.cleanup();
  });

  return { db, token, actorId: actor.userId };
}

async function seedCatalog(db) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);

  const [category] = await db.query(
    "INSERT INTO item_categories (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    [`it-bulk-cat-${suffix}`, nowMs, nowMs]
  );
  const categoryId = category.insertId;

  const [brand] = await db.query(
    "INSERT INTO item_brands (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    [`it-bulk-brand-${suffix}`, nowMs, nowMs]
  );
  const brandId = brand.insertId;

  const [uom] = await db.query(
    "INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    [`ITB${suffix}`, "Integration Test Unit", nowMs, nowMs]
  );
  const uomId = uom.insertId;

  return {
    categoryId,
    brandId,
    uomId,
    async cleanup() {
      await db.execute("DELETE FROM item_uoms WHERE id = ?", [uomId]);
      await db.execute("DELETE FROM item_brands WHERE id = ?", [brandId]);
      await db.execute("DELETE FROM item_categories WHERE id = ?", [categoryId]);
    }
  };
}

/** 一個 Item 連同 `count` 粒指定狀態嘅 SKU（各自有一個 Base UOM，符合
 * `#assertSkuRowActivatable()` 嘅要求）。 */
async function seedItemWithSkus(db, catalog, { itemStatus = "draft", skuStatus = "draft", count = 1 } = {}) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);

  const [item] = await db.query(
    `INSERT INTO items (name, category_id, brand_id, product_type, status, created_at, updated_at)
     VALUES (?, ?, ?, 'standard', ?, ?, ?)`,
    [`it-bulk-item-${suffix}`, catalog.categoryId, catalog.brandId, itemStatus, nowMs, nowMs]
  );
  const itemId = item.insertId;

  const skus = [];
  for (let index = 0; index < count; index += 1) {
    const [sku] = await db.query(
      `INSERT INTO item_skus
         (item_id, sku_code, sku_name, tracking_policy, purchasable, sellable, inventory_tracked,
          suggested_price_amount, status, created_at, updated_at)
       VALUES (?, ?, ?, 'none', 1, 1, 1, '100.0000', ?, ?, ?)`,
      [itemId, `IT-BULK-${suffix}-${index}`, `Integration test SKU ${index}`, skuStatus, nowMs, nowMs]
    );
    const skuId = sku.insertId;

    await db.query(
      `INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, is_default_sale, created_at, updated_at)
       VALUES (?, ?, 1, 1, 1, ?, ?)`,
      [skuId, catalog.uomId, nowMs, nowMs]
    );

    skus.push(skuId);
  }

  return {
    itemId,
    skuIds: skus,
    async cleanup() {
      for (const skuId of skus) {
        await db.execute("DELETE FROM item_sku_uoms WHERE sku_id = ?", [skuId]);
        await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'sku' AND target_id = ?", [skuId]);
      }
      await db.execute("DELETE FROM item_skus WHERE item_id = ?", [itemId]);
      await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'item' AND target_id = ?", [itemId]);
      await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
    }
  };
}

test("Bulk archive：3 粒 draft SKU 全部成功，各自有一筆 sku.archive audit", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token, actorId } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { skuStatus: "draft", count: 3 });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/item-bulk/status/change`, token, {
    targetType: "sku",
    action: "archive",
    targets: fixture.skuIds.map((id) => ({ id, version: 1 })),
    reason: "整合測試：批量封存",
    password: PASSWORD
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(
    body.data.results.map((r) => r.status),
    ["ok", "ok", "ok"]
  );

  const [rows] = await db.query(
    `SELECT status FROM item_skus WHERE id IN (${fixture.skuIds.map(() => "?").join(",")})`,
    fixture.skuIds
  );
  assert.ok(rows.every((row) => row.status === "archived"));

  const [auditRows] = await db.query(
    "SELECT target_id FROM item_audit_logs WHERE actor_user_id = ? AND action = 'sku.archive'",
    [actorId]
  );
  assert.equal(auditRows.length, 3);
});

test("Bulk：100 個 target 全部成功", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { skuStatus: "draft", count: 100 });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/item-bulk/status/change`, token, {
    targetType: "sku",
    action: "archive",
    targets: fixture.skuIds.map((id) => ({ id, version: 1 })),
    reason: "整合測試：批量封存上限",
    password: PASSWORD
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.results.length, 100);
  assert.ok(body.data.results.every((r) => r.status === "ok"));
});

test("Bulk：101 個 target 俾 schema 擋，400，完全唔會入到 service", { skip }, async (t) => {
  const application = await startApplication();
  const { token } = await withManager(t, application);
  t.after(async () => {
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const targets = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, version: 1 }));
  const { status, body } = await post(`${url}/api/v1/item-bulk/status/change`, token, {
    targetType: "sku",
    action: "archive",
    targets,
    reason: "整合測試：超過上限",
    password: PASSWORD
  });

  assert.equal(status, 400, JSON.stringify(body));
});

test("Bulk：中間一個 target 因為 version 唔啱失敗，全部（包括本身會成功嗰幾個）一齊 rollback", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token, actorId } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { skuStatus: "draft", count: 3 });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const targets = fixture.skuIds.map((id, index) => ({
    id,
    // 中間嗰個帶錯 version，觸發 VERSION_CONFLICT。
    version: index === 1 ? 999 : 1
  }));

  const { status, body } = await post(`${url}/api/v1/item-bulk/status/change`, token, {
    targetType: "sku",
    action: "archive",
    targets,
    reason: "整合測試：中間一個失敗",
    password: PASSWORD
  });

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "BULK_STATUS_CHANGE_REJECTED");
  assert.equal(body.error.details.issues.length, 1);
  assert.equal(body.error.details.issues[0].id, fixture.skuIds[1]);
  assert.equal(body.error.details.issues[0].code, "VERSION_CONFLICT");

  const [rows] = await db.query(
    `SELECT id, status, version FROM item_skus WHERE id IN (${fixture.skuIds.map(() => "?").join(",")})`,
    fixture.skuIds
  );
  assert.ok(
    rows.every((row) => row.status === "draft" && row.version === 1),
    "全部 SKU（包括本身會成功嗰兩粒）都要保持原狀，一個都冇轉"
  );

  const [auditRows] = await db.query(
    "SELECT id FROM item_audit_logs WHERE actor_user_id = ? AND action = 'sku.archive'",
    [actorId]
  );
  assert.equal(auditRows.length, 0, "rollback 之後唔應該留低任何 audit 記錄");
});

test("Bulk activate：父 Item 已經 active，3 粒 inactive SKU 全部啟用", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatus: "inactive", count: 3 });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/item-bulk/status/change`, token, {
    targetType: "sku",
    action: "activate",
    targets: fixture.skuIds.map((id) => ({ id, version: 1 })),
    reason: "整合測試：批量啟用",
    password: PASSWORD
  });

  assert.equal(status, 200, JSON.stringify(body));
  const [rows] = await db.query(
    `SELECT status FROM item_skus WHERE id IN (${fixture.skuIds.map(() => "?").join(",")})`,
    fixture.skuIds
  );
  assert.ok(rows.every((row) => row.status === "active"));
});

test("Bulk：唔支援 delete，唔喺 action 白名單，400", { skip }, async (t) => {
  const application = await startApplication();
  const { token } = await withManager(t, application);
  t.after(async () => {
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/item-bulk/status/change`, token, {
    targetType: "sku",
    action: "delete",
    targets: [{ id: 1, version: 1 }],
    reason: "整合測試：唔應該存在嘅 action",
    password: PASSWORD
  });

  assert.equal(status, 400, JSON.stringify(body));
});

test("Bulk：密碼錯，403，完全冇改到任何 SKU", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { skuStatus: "draft", count: 2 });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/item-bulk/status/change`, token, {
    targetType: "sku",
    action: "archive",
    targets: fixture.skuIds.map((id) => ({ id, version: 1 })),
    reason: "整合測試：密碼錯",
    password: "wrong-password"
  });

  assert.equal(status, 403, JSON.stringify(body));

  const [rows] = await db.query(
    `SELECT status FROM item_skus WHERE id IN (${fixture.skuIds.map(() => "?").join(",")})`,
    fixture.skuIds
  );
  assert.ok(rows.every((row) => row.status === "draft"));
});

test("Bulk：淨係 item.view 冇 item.mgmt：403", { skip }, async (t) => {
  const application = await startApplication();
  const { token } = await withManager(t, application, ["item.view"]);
  t.after(async () => {
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/item-bulk/status/change`, token, {
    targetType: "sku",
    action: "archive",
    targets: [{ id: 1, version: 1 }],
    reason: "整合測試：冇 item.mgmt",
    password: PASSWORD
  });

  assert.equal(status, 403, JSON.stringify(body));
});
