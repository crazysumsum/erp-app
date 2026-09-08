/**
 * T18 嘅 Item／SKU 生命週期端點（activate／deactivate／discontinue／archive／
 * restore），對一個真的、已經 migrate 過的 MySQL 驗收。設計說明見
 * docs/items_management/design_spec.md §4.2、§6.2、§6.3、DEC-024。
 *
 * 呢度要驗嘅係假連線頂唔到嘅嘢：Item 停用／停產／封存真係喺同一交易將受影響
 * 嘅 SKU 一齊轉狀態（DEC-024）、任一步失敗真係成個 rollback、
 * compare-and-set 嘅 `WHERE version = ? AND status IN (...)` 喺真 DB 底下
 * 真係分得清版本衝突同狀態衝突。引用檢查（庫存／在途）呢期未有下游表可以
 * 查，archive 未做呢個檢查——範圍決定同 T16 對 `uomChangeBlocked()` 嘅判斷
 * 一致，見 docs/items_management/tasks.md 的 T18 條目。
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

async function withManager(t, application) {
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const role = await seedRole(db, { permissionNames: ["item.view", "item.mgmt"] });
  const actor = await seedUser(db, {
    username: `it-item-lc-${randomUUID().slice(0, 8)}`,
    password: PASSWORD,
    roleId: role.roleId
  });
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: ["item.view", "item.mgmt"] });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await role.cleanup();
  });

  return { db, token, actorId: actor.userId, roleName: role.roleName };
}

/** 分類、品牌、一個 UOM——跟返 FK 依賴反向刪除。 */
async function seedCatalog(db) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);

  const [category] = await db.query(
    "INSERT INTO item_categories (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    [`it-cat-${suffix}`, nowMs, nowMs]
  );
  const categoryId = category.insertId;

  const [brand] = await db.query(
    "INSERT INTO item_brands (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    [`it-brand-${suffix}`, nowMs, nowMs]
  );
  const brandId = brand.insertId;

  const [uom] = await db.query(
    "INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    [`ITL${suffix}`, "Integration Test Unit", nowMs, nowMs]
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

/** 一個 Item 連同任意數量、任意狀態嘅完整可啟用 SKU（一個 Base UOM，
 * 有建議售價）。跳過 create API，直接寫入，專注測生命週期本身。 */
async function seedItemWithSkus(db, catalog, { itemStatus = "draft", skuStatuses = ["draft"] } = {}) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);

  const [item] = await db.query(
    `INSERT INTO items (name, category_id, brand_id, product_type, status, created_at, updated_at)
     VALUES (?, ?, ?, 'standard', ?, ?, ?)`,
    [`it-item-${suffix}`, catalog.categoryId, catalog.brandId, itemStatus, nowMs, nowMs]
  );
  const itemId = item.insertId;

  const skus = [];
  for (const [index, skuStatus] of skuStatuses.entries()) {
    const [sku] = await db.query(
      `INSERT INTO item_skus
         (item_id, sku_code, sku_name, tracking_policy, purchasable, sellable, inventory_tracked,
          suggested_price_amount, status, created_at, updated_at)
       VALUES (?, ?, ?, 'none', 1, 1, 1, '100.0000', ?, ?, ?)`,
      [itemId, `IT-SKU-${suffix}-${index}`, `Integration test SKU ${index}`, skuStatus, nowMs, nowMs]
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
    skuId: skus[0],
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

// --- POST /api/v1/items/:id/activate ----------------------------------------

test("啟用 Item：Draft Item＋Draft SKU，帶 skuIds 一齊啟用，Item 同 SKU 一齊轉 active，各記一筆 audit", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "draft", skuStatuses: ["draft"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/activate`, token, {
    skuIds: [fixture.skuId],
    reason: "整合測試：直接啟用",
    version: 1
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.status, "active");
  assert.equal(body.data.version, 2);
  assert.equal(body.data.skus[0].status, "active");

  const [itemAudit] = await db.query(
    "SELECT detail FROM item_audit_logs WHERE target_type='item' AND target_id=? AND action='item.activate'",
    [fixture.itemId]
  );
  assert.equal(itemAudit.length, 1);
  assert.equal(itemAudit[0].detail.status.before, "draft");
  assert.equal(itemAudit[0].detail.status.after, "active");

  const [skuAudit] = await db.query(
    "SELECT detail FROM item_audit_logs WHERE target_type='sku' AND target_id=? AND action='sku.activate'",
    [fixture.skuId]
  );
  assert.equal(skuAudit.length, 1);
  assert.equal(skuAudit[0].detail.cascadedFromItem, undefined, "直接啟用唔係 cascade，冇呢個 flag");
});

test("啟用 Item：Draft Item 冇帶任何 skuIds：400 ITEM_ACTIVATION_REQUIRES_SKU，乜都冇寫", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "draft", skuStatuses: ["draft"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/activate`, token, {
    skuIds: [],
    reason: "整合測試：冇帶 SKU",
    version: 1
  });

  assert.equal(status, 400, JSON.stringify(body));
  assert.equal(body.error.code, "ITEM_ACTIVATION_REQUIRES_SKU");

  const [[itemRow]] = await db.query("SELECT status, version FROM items WHERE id = ?", [fixture.itemId]);
  assert.equal(itemRow.status, "draft");
  assert.equal(itemRow.version, 1);
});

test("啟用 Item：已經 active 嘅 Item 再啟用多一個 Inactive SKU，Item 本身唔轉、唔記 item.activate audit", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active", "inactive"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const [, secondSkuId] = fixture.skuIds;
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/activate`, token, {
    skuIds: [secondSkuId],
    reason: "整合測試：加啟另一個 SKU",
    version: 1
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.status, "active");
  assert.equal(body.data.version, 1, "Item 本身冇轉狀態，version 唔應該遞增");

  const [itemAudit] = await db.query(
    "SELECT id FROM item_audit_logs WHERE target_type='item' AND target_id=? AND action='item.activate'",
    [fixture.itemId]
  );
  assert.equal(itemAudit.length, 0);

  const [[skuRow]] = await db.query("SELECT status FROM item_skus WHERE id = ?", [secondSkuId]);
  assert.equal(skuRow.status, "active");
});

test("啟用 Item：skuIds 帶另一個 Item 嘅 SKU id：404 SKU_NOT_FOUND", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixtureA = await seedItemWithSkus(db, catalog, { itemStatus: "draft", skuStatuses: ["draft"] });
  const fixtureB = await seedItemWithSkus(db, catalog, { itemStatus: "draft", skuStatuses: ["draft"] });
  t.after(async () => {
    await fixtureA.cleanup();
    await fixtureB.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/items/${fixtureA.itemId}/activate`, token, {
    skuIds: [fixtureB.skuId],
    reason: "整合測試：跨 Item SKU",
    version: 1
  });

  assert.equal(status, 404, JSON.stringify(body));
  assert.equal(body.error.code, "SKU_NOT_FOUND");
});

test("啟用 Item：已封存嘅 Item：409 STATUS_TRANSITION_INVALID", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "archived", skuStatuses: ["archived"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/activate`, token, {
    skuIds: [fixture.skuId],
    reason: "整合測試：封存後想啟用",
    version: 1
  });

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "STATUS_TRANSITION_INVALID");
});

// --- POST /api/v1/items/:id/deactivate --------------------------------------

test("停用 Item：Active Item＋兩個 Active SKU，同交易全部轉 inactive，SKU audit 記低 cascadedFromItem", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active", "active"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/deactivate`, token, {
    reason: "整合測試：停用",
    version: 1
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.status, "inactive");

  const [skuRows] = await db.query("SELECT status FROM item_skus WHERE item_id = ?", [fixture.itemId]);
  assert.ok(skuRows.every((row) => row.status === "inactive"));

  const skuIdPlaceholders = fixture.skuIds.map(() => "?").join(",");
  const [skuAudit] = await db.query(
    `SELECT detail FROM item_audit_logs WHERE target_type='sku' AND target_id IN (${skuIdPlaceholders}) AND action='sku.deactivate'`,
    fixture.skuIds
  );
  assert.equal(skuAudit.length, 2);
  assert.ok(skuAudit.every((row) => row.detail.cascadedFromItem === true));
});

test("停用 Item：version 唔啱：409 VERSION_CONFLICT，Item 同 SKU 完全冇轉", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/deactivate`, token, {
    reason: "整合測試：stale version",
    version: 999
  });

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "VERSION_CONFLICT");

  const [[itemRow]] = await db.query("SELECT status FROM items WHERE id = ?", [fixture.itemId]);
  assert.equal(itemRow.status, "active");
  const [[skuRow]] = await db.query("SELECT status FROM item_skus WHERE id = ?", [fixture.skuId]);
  assert.equal(skuRow.status, "active");
});

// --- POST /api/v1/items/:id/discontinue -------------------------------------

test("停產 Item：Active Item＋Active SKU，SKU 強制停止採購，sellable 保留現狀清貨", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/discontinue`, token, {
    reason: "整合測試：停產",
    version: 1,
    password: PASSWORD
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.status, "discontinued");

  const [[skuRow]] = await db.query("SELECT status, purchasable, sellable FROM item_skus WHERE id = ?", [
    fixture.skuId
  ]);
  assert.equal(skuRow.status, "discontinued");
  assert.equal(skuRow.purchasable, 0);
  assert.equal(skuRow.sellable, 1, "sellable 保留現狀，唔強制關");
});

test("停產 Item：密碼錯：403 PASSWORD_INVALID，Item 同 SKU 完全冇轉", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/discontinue`, token, {
    reason: "整合測試：密碼錯",
    version: 1,
    password: "wrong-password"
  });

  assert.equal(status, 403, JSON.stringify(body));
  assert.equal(body.error.code, "PASSWORD_INVALID");

  const [[itemRow]] = await db.query("SELECT status FROM items WHERE id = ?", [fixture.itemId]);
  assert.equal(itemRow.status, "active");
});

// --- POST /api/v1/items/:id/archive、/restore -------------------------------

test("封存 Item：Inactive Item＋Inactive SKU，同交易一齊轉 archived；恢復後 Item 變 inactive 但 SKU 仍然 archived", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "inactive", skuStatuses: ["inactive"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const archive = await post(`${url}/api/v1/items/${fixture.itemId}/archive`, token, {
    reason: "整合測試：封存",
    version: 1,
    password: PASSWORD
  });
  assert.equal(archive.status, 200, JSON.stringify(archive.body));
  assert.equal(archive.body.data.status, "archived");

  const [[skuAfterArchive]] = await db.query("SELECT status FROM item_skus WHERE id = ?", [fixture.skuId]);
  assert.equal(skuAfterArchive.status, "archived");

  const restore = await post(`${url}/api/v1/items/${fixture.itemId}/restore`, token, {
    reason: "整合測試：恢復",
    version: 2,
    password: PASSWORD
  });
  assert.equal(restore.status, 200, JSON.stringify(restore.body));
  assert.equal(restore.body.data.status, "inactive");

  const [[skuAfterRestore]] = await db.query("SELECT status FROM item_skus WHERE id = ?", [fixture.skuId]);
  assert.equal(skuAfterRestore.status, "archived", "restore Item 不自動 restore SKU（DEC-024）");
});

// --- POST /api/v1/skus/:id/activate、/deactivate ----------------------------

test("啟用 SKU：父 Item 未 Active：409 STATUS_TRANSITION_INVALID", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "draft", skuStatuses: ["draft"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/skus/${fixture.skuId}/activate`, token, {
    reason: "整合測試：父 Item 未啟用",
    version: 1
  });

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "STATUS_TRANSITION_INVALID");
});

test("啟用 SKU：父 Item 已 Active，單獨啟用一個 Inactive SKU", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["inactive"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/skus/${fixture.skuId}/activate`, token, {
    reason: "整合測試：獨立啟用 SKU",
    version: 1
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.status, "active");
});

test("停用 SKU：父 Item Active 情況下停用最後一個 Active SKU：409 LAST_ACTIVE_SKU", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/skus/${fixture.skuId}/deactivate`, token, {
    reason: "整合測試：停用最後一個",
    version: 1
  });

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "LAST_ACTIVE_SKU");

  const [[skuRow]] = await db.query("SELECT status FROM item_skus WHERE id = ?", [fixture.skuId]);
  assert.equal(skuRow.status, "active");
});

test("停用 SKU：仲有另一個 Active SKU，唔擋，成功停用", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active", "active"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/skus/${fixture.skuId}/deactivate`, token, {
    reason: "整合測試：仲有第二個 Active",
    version: 1
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.status, "inactive");
});

// --- POST /api/v1/skus/:id/discontinue、/archive、/restore ------------------

test("SKU 停產、封存、恢復：完整走一次，每步都有獨立 audit", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const discontinue = await post(`${url}/api/v1/skus/${fixture.skuId}/discontinue`, token, {
    reason: "整合測試：SKU 停產",
    version: 1,
    password: PASSWORD
  });
  assert.equal(discontinue.status, 200, JSON.stringify(discontinue.body));
  assert.equal(discontinue.body.data.status, "discontinued");
  assert.equal(discontinue.body.data.purchasable, false);

  const archive = await post(`${url}/api/v1/skus/${fixture.skuId}/archive`, token, {
    reason: "整合測試：SKU 封存",
    version: 2,
    password: PASSWORD
  });
  assert.equal(archive.status, 200, JSON.stringify(archive.body));
  assert.equal(archive.body.data.status, "archived");

  const restore = await post(`${url}/api/v1/skus/${fixture.skuId}/restore`, token, {
    reason: "整合測試：SKU 恢復",
    version: 3,
    password: PASSWORD
  });
  assert.equal(restore.status, 200, JSON.stringify(restore.body));
  assert.equal(restore.body.data.status, "inactive");

  const [auditRows] = await db.query(
    "SELECT action FROM item_audit_logs WHERE target_type='sku' AND target_id=? ORDER BY id",
    [fixture.skuId]
  );
  assert.deepEqual(
    auditRows.map((row) => row.action),
    ["sku.discontinue", "sku.archive", "sku.restore"]
  );
});

test("SKU 狀態動作：淨係 item.view 冇 item.mgmt：403", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active", "active"] });
  const viewRole = await seedRole(db, { permissionNames: ["item.view"] });
  const actor = await seedUser(db, {
    username: `it-item-lc-view-${randomUUID().slice(0, 8)}`,
    password: PASSWORD,
    roleId: viewRole.roleId
  });
  const token = await issueToken(actor.userId, { roles: [viewRole.roleName], permissions: ["item.view"] });
  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await viewRole.cleanup();
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status } = await post(`${url}/api/v1/skus/${fixture.skuId}/deactivate`, token, {
    reason: "整合測試：冇權限",
    version: 1
  });

  assert.equal(status, 403);

  const [[skuRow]] = await db.query("SELECT status FROM item_skus WHERE id = ?", [fixture.skuId]);
  assert.equal(skuRow.status, "active");
});
