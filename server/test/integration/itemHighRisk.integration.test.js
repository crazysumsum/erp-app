/**
 * T20 嘅 Item／SKU 高風險操作（永久刪除、複製、SKU Code 特批修改、條碼
 * 釋放），對一個真的、已經 migrate 過的 MySQL 驗收。設計說明見
 * docs/items_management/design_spec.md §6.2、§6.3、§8.4。
 *
 * 「未引用」嘅範圍決定同 T16／T18 一致：Phase 1 冇庫存／採購／銷售表，永久
 * 刪除只檢查 Item／SKU aggregate 自身係咪 draft（design_spec §8.4：「永久刪除
 * Draft 只需檢查 Item aggregate 自身」），唔做真正嘅下游引用查詢。
 *
 * SKU Code 修改／條碼釋放用 `jwt-device-password`，要真嘅 ECDSA 簽章先過得
 * 到——用 test-support/testDevice.js（同 roleManagement.integration.test.js
 * 共用嗰個 helper），唔係假簽章：呢個測試要驗嘅正正係簽章驗證接縫本身。
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

const PASSWORD = "Integration-Test-Pass-1!";

async function seedUser(db, { username, roleId }) {
  const passwordHash = await hashPassword(PASSWORD);
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
  await db.execute("DELETE FROM user_devices WHERE user_id = ?", [userId]);
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

function post(url, token, body) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

/** 給 jwt-device-password 端點用：Authorization + 設備簽章 header 都要帶。 */
async function signedPost(baseUrl, path, device, token, body) {
  const bodyText = JSON.stringify(body);
  const headers = await device.headers({ method: "POST", path, body: bodyText, token });
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${token}` },
    body: bodyText
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

async function withManager(t, application) {
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const role = await seedRole(db, { permissionNames: ["item.view", "item.mgmt"] });
  const actor = await seedUser(db, { username: `it-item-hr-${randomUUID().slice(0, 8)}`, roleId: role.roleId });
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: ["item.view", "item.mgmt"] });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await role.cleanup();
  });

  return { db, token, actorId: actor.userId, roleName: role.roleName };
}

/** 同上，但另外種埋一台已核准設備，簽發帶 `did` 嘅 token，俾
 * jwt-device-password 端點用。 */
async function withDeviceManager(t, application) {
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const role = await seedRole(db, { permissionNames: ["item.view", "item.mgmt"] });
  const actor = await seedUser(db, { username: `it-item-hrd-${randomUUID().slice(0, 8)}`, roleId: role.roleId });
  const device = await createTestDevice();
  await seedApprovedDevice(db, { userId: actor.userId, device });
  const token = await issueToken(actor.userId, {
    roles: [role.roleName],
    permissions: ["item.view", "item.mgmt"],
    did: device.deviceId
  });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await role.cleanup();
  });

  return { db, token, device, actorId: actor.userId };
}

async function seedCatalog(db) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);

  const [category] = await db.query(
    "INSERT INTO item_categories (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    [`it-cat-${suffix}`, nowMs, nowMs]
  );
  const [brand] = await db.query(
    "INSERT INTO item_brands (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    [`it-brand-${suffix}`, nowMs, nowMs]
  );
  const [uom] = await db.query(
    "INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    [`ITH${suffix}`, "Integration Test Unit", nowMs, nowMs]
  );

  return {
    categoryId: category.insertId,
    brandId: brand.insertId,
    uomId: uom.insertId,
    async cleanup() {
      await db.execute("DELETE FROM item_uoms WHERE id = ?", [uom.insertId]);
      await db.execute("DELETE FROM item_brands WHERE id = ?", [brand.insertId]);
      await db.execute("DELETE FROM item_categories WHERE id = ?", [category.insertId]);
    }
  };
}

/** 一個 Item 連任意數量嘅完整 SKU（一個 Base UOM，冇條碼），跳過 create
 * API，專注測高風險操作本身。 */
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
    const [skuUom] = await db.query(
      `INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, is_default_sale, created_at, updated_at)
       VALUES (?, ?, 1, 1, 1, ?, ?)`,
      [skuId, catalog.uomId, nowMs, nowMs]
    );
    skus.push({ id: skuId, skuUomId: skuUom.insertId, code: `IT-SKU-${suffix}-${index}` });
  }

  return {
    itemId,
    skuId: skus[0].id,
    skuUomId: skus[0].skuUomId,
    skus,
    async cleanup() {
      const ids = skus.map((s) => s.id);
      if (ids.length > 0) {
        const placeholders = ids.map(() => "?").join(",");
        await db.execute(`DELETE FROM item_sku_barcodes WHERE sku_id IN (${placeholders})`, ids);
        await db.execute(`DELETE FROM item_sku_uoms WHERE sku_id IN (${placeholders})`, ids);
        await db.execute(
          `DELETE FROM item_audit_logs WHERE target_type = 'sku' AND target_id IN (${placeholders})`,
          ids
        );
        await db.execute(`DELETE FROM item_skus WHERE item_id = ?`, [itemId]);
      }
      await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'item' AND target_id = ?", [itemId]);
      await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
    }
  };
}

async function seedBarcode(db, { skuId, skuUomId, barcode, isPrimary = false }) {
  const nowMs = Date.now();
  const [row] = await db.query(
    `INSERT INTO item_sku_barcodes
       (sku_id, sku_uom_id, barcode, normalized_barcode, barcode_type, is_primary, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'internal', ?, ?, ?)`,
    [skuId, skuUomId, barcode, barcode, isPrimary ? 1 : 0, nowMs, nowMs]
  );
  return row.insertId;
}

// --- POST /api/v1/items/:id/delete ------------------------------------------

test("刪除 Item：Draft Item 連同其 Draft SKU、UOM 一齊消失，audit 記低", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "draft", skuStatuses: ["draft"] });
  t.after(async () => {
    await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'item' AND target_id = ?", [fixture.itemId]);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/delete`, token, {
    reason: "整合測試：刪除草稿商品",
    version: 1,
    password: PASSWORD
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.id, fixture.itemId);

  const [[itemGone]] = await db.query("SELECT COUNT(*) AS c FROM items WHERE id = ?", [fixture.itemId]);
  assert.equal(itemGone.c, 0);
  const [[skuGone]] = await db.query("SELECT COUNT(*) AS c FROM item_skus WHERE item_id = ?", [fixture.itemId]);
  assert.equal(skuGone.c, 0);
  const [[uomGone]] = await db.query("SELECT COUNT(*) AS c FROM item_sku_uoms WHERE sku_id = ?", [fixture.skuId]);
  assert.equal(uomGone.c, 0);

  const [auditRows] = await db.query(
    "SELECT detail FROM item_audit_logs WHERE target_type='item' AND target_id=? AND action='item.delete'",
    [fixture.itemId]
  );
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].detail.deletedSkuCount, 1);
});

test("刪除 Item：非草稿狀態：409 ITEM_DELETE_REQUIRES_DRAFT，乜都冇刪", { skip }, async (t) => {
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
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/delete`, token, {
    reason: "整合測試：唔應該刪到",
    version: 1,
    password: PASSWORD
  });

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "ITEM_DELETE_REQUIRES_DRAFT");

  const [[stillThere]] = await db.query("SELECT COUNT(*) AS c FROM items WHERE id = ?", [fixture.itemId]);
  assert.equal(stillThere.c, 1);
});

test("刪除 Item：version 唔啱：409 VERSION_CONFLICT", { skip }, async (t) => {
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
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/delete`, token, {
    reason: "整合測試：stale version",
    version: 999,
    password: PASSWORD
  });

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "VERSION_CONFLICT");
});

test("刪除 Item：密碼錯：403 PASSWORD_INVALID", { skip }, async (t) => {
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
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/delete`, token, {
    reason: "整合測試：密碼錯",
    version: 1,
    password: "wrong-password"
  });

  assert.equal(status, 403, JSON.stringify(body));
  assert.equal(body.error.code, "PASSWORD_INVALID");
});

// --- POST /api/v1/items/:id/copy --------------------------------------------

test("複製 Item：新 Item 係 Draft，UOM 複製埋，Barcode 完全冇複製", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active"] });
  await seedBarcode(db, { skuId: fixture.skuId, skuUomId: fixture.skuUomId, barcode: `IT-BC-${randomUUID().slice(0, 8)}`, isPrimary: true });
  let newItemId = null;
  t.after(async () => {
    if (newItemId !== null) {
      await db.execute("DELETE FROM item_sku_barcodes WHERE sku_id IN (SELECT id FROM item_skus WHERE item_id = ?)", [newItemId]);
      await db.execute("DELETE FROM item_sku_uoms WHERE sku_id IN (SELECT id FROM item_skus WHERE item_id = ?)", [newItemId]);
      await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'sku' AND target_id IN (SELECT id FROM item_skus WHERE item_id = ?)", [newItemId]);
      await db.execute("DELETE FROM item_skus WHERE item_id = ?", [newItemId]);
      await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'item' AND target_id = ?", [newItemId]);
      await db.execute("DELETE FROM items WHERE id = ?", [newItemId]);
    }
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const newCode = `IT-COPY-${randomUUID().slice(0, 8)}`;
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/copy`, token, {
    skus: [{ sourceSkuId: fixture.skuId, skuCode: newCode }]
  });

  assert.equal(status, 201, JSON.stringify(body));
  newItemId = body.data.id;
  assert.notEqual(newItemId, fixture.itemId);
  assert.equal(body.data.status, "draft");
  assert.equal(body.data.version, 1);
  assert.equal(body.data.skus.length, 1);
  assert.equal(body.data.skus[0].skuCode, newCode);
  assert.equal(body.data.skus[0].status, "draft");

  const [[newSkuRow]] = await db.query("SELECT id FROM item_skus WHERE item_id = ?", [newItemId]);
  const [uomRows] = await db.query("SELECT uom_id FROM item_sku_uoms WHERE sku_id = ?", [newSkuRow.id]);
  assert.equal(uomRows.length, 1);
  assert.equal(uomRows[0].uom_id, catalog.uomId);
  const [barcodeRows] = await db.query("SELECT id FROM item_sku_barcodes WHERE sku_id = ?", [newSkuRow.id]);
  assert.equal(barcodeRows.length, 0, "複製唔應該帶埋 barcode 過去");

  const [auditRows] = await db.query(
    "SELECT detail FROM item_audit_logs WHERE target_type='item' AND target_id=? AND action='item.copy'",
    [newItemId]
  );
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].detail.copiedFromItemId, fixture.itemId);
});

test("複製 Item：skus 陣列帶錯嘅 sourceSkuId：400 SKU_CHILD_MISMATCH", { skip }, async (t) => {
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
  const { status, body } = await post(`${url}/api/v1/items/${fixtureA.itemId}/copy`, token, {
    skus: [{ sourceSkuId: fixtureB.skuId, skuCode: "IT-COPY-MISMATCH" }]
  });

  assert.equal(status, 400, JSON.stringify(body));
  assert.equal(body.error.code, "SKU_CHILD_MISMATCH");
});

test("複製 Item：新 Code 撞咗現有 SKU：409 SKU_CODE_TAKEN", { skip }, async (t) => {
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
  const { status, body } = await post(`${url}/api/v1/items/${fixtureA.itemId}/copy`, token, {
    skus: [{ sourceSkuId: fixtureA.skuId, skuCode: fixtureB.skus[0].code }]
  });

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "SKU_CODE_TAKEN");
});

// --- POST /api/v1/skus/:id/delete --------------------------------------------

test("刪除 SKU：Draft SKU，Item 仲有第二個 SKU，成功刪除", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "draft", skuStatuses: ["draft", "draft"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/skus/${fixture.skus[0].id}/delete`, token, {
    reason: "整合測試：刪除多餘 SKU",
    version: 1,
    password: PASSWORD
  });

  assert.equal(status, 200, JSON.stringify(body));
  const [[gone]] = await db.query("SELECT COUNT(*) AS c FROM item_skus WHERE id = ?", [fixture.skus[0].id]);
  assert.equal(gone.c, 0);
  const [[remaining]] = await db.query("SELECT COUNT(*) AS c FROM item_skus WHERE id = ?", [fixture.skus[1].id]);
  assert.equal(remaining.c, 1);
});

test("刪除 SKU：係 Item 最後一個 SKU：409 SKU_IS_LAST_IN_ITEM", { skip }, async (t) => {
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
  const { status, body } = await post(`${url}/api/v1/skus/${fixture.skuId}/delete`, token, {
    reason: "整合測試：最後一個",
    version: 1,
    password: PASSWORD
  });

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "SKU_IS_LAST_IN_ITEM");

  const [[stillThere]] = await db.query("SELECT COUNT(*) AS c FROM item_skus WHERE id = ?", [fixture.skuId]);
  assert.equal(stillThere.c, 1);
});

test("刪除 SKU：非草稿狀態：409 SKU_DELETE_REQUIRES_DRAFT", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active", "draft"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/skus/${fixture.skus[0].id}/delete`, token, {
    reason: "整合測試：唔係草稿",
    version: 1,
    password: PASSWORD
  });

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "SKU_DELETE_REQUIRES_DRAFT");
});

// --- POST /api/v1/skus/:id/code/change --------------------------------------

test("SKU Code 特批修改：成功改名，version 遞增，audit 記低 before/after", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token, device } = await withDeviceManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const newCode = `IT-RENAMED-${randomUUID().slice(0, 8)}`;
  const path = `/api/v1/skus/${fixture.skuId}/code/change`;
  const { status, body } = await signedPost(url, path, device, token, {
    skuCode: newCode,
    reason: "整合測試：特批改 Code",
    version: 1,
    password: PASSWORD
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.skuCode, newCode);
  assert.equal(body.data.version, 2);

  const [auditRows] = await db.query(
    "SELECT detail FROM item_audit_logs WHERE target_type='sku' AND target_id=? AND action='sku.code.change'",
    [fixture.skuId]
  );
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].detail.skuCode.before, fixture.skus[0].code);
  assert.equal(auditRows[0].detail.skuCode.after, newCode);
});

test("SKU Code 特批修改：新 Code 撞咗另一個 SKU：409 SKU_CODE_TAKEN", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token, device } = await withDeviceManager(t, application);
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
  const path = `/api/v1/skus/${fixtureA.skuId}/code/change`;
  const { status, body } = await signedPost(url, path, device, token, {
    skuCode: fixtureB.skus[0].code,
    reason: "整合測試：撞 code",
    version: 1,
    password: PASSWORD
  });

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "SKU_CODE_TAKEN");
});

test("SKU Code 特批修改：密碼錯：403 PASSWORD_INVALID", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token, device } = await withDeviceManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "draft", skuStatuses: ["draft"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const path = `/api/v1/skus/${fixture.skuId}/code/change`;
  const { status, body } = await signedPost(url, path, device, token, {
    skuCode: "IT-SHOULD-NOT-APPLY",
    reason: "整合測試：密碼錯",
    version: 1,
    password: "wrong-password"
  });

  assert.equal(status, 403, JSON.stringify(body));
  assert.equal(body.error.code, "PASSWORD_INVALID");
});

test("SKU Code 特批修改：冇帶設備簽章 header：400 DEVICE_SIGNATURE_REQUIRED", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withDeviceManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "draft", skuStatuses: ["draft"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/skus/${fixture.skuId}/code/change`, token, {
    skuCode: "IT-SHOULD-NOT-APPLY",
    reason: "整合測試：冇簽章",
    version: 1,
    password: PASSWORD
  });

  assert.equal(status, 400, JSON.stringify(body));
  assert.equal(body.error.code, "DEVICE_SIGNATURE_REQUIRED");
});

// --- POST /api/v1/skus/:id/barcodes/:barcodeId/release ----------------------

test("條碼釋放：成功移除指定條碼，其他條碼唔受影響，audit 記低原值", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token, device } = await withDeviceManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active"] });
  const barcodeToRelease = `IT-BC-REL-${randomUUID().slice(0, 8)}`;
  const barcodeToKeep = `IT-BC-KEEP-${randomUUID().slice(0, 8)}`;
  const releaseId = await seedBarcode(db, {
    skuId: fixture.skuId,
    skuUomId: fixture.skuUomId,
    barcode: barcodeToRelease,
    isPrimary: false
  });
  await seedBarcode(db, { skuId: fixture.skuId, skuUomId: fixture.skuUomId, barcode: barcodeToKeep, isPrimary: true });
  t.after(async () => {
    await db.execute("DELETE FROM item_sku_barcodes WHERE sku_id = ?", [fixture.skuId]);
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const path = `/api/v1/skus/${fixture.skuId}/barcodes/${releaseId}/release`;
  const { status, body } = await signedPost(url, path, device, token, {
    reason: "整合測試：釋放條碼",
    version: 1,
    password: PASSWORD
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.barcodes.length, 1);
  assert.equal(body.data.barcodes[0].barcode, barcodeToKeep);

  const [[gone]] = await db.query("SELECT COUNT(*) AS c FROM item_sku_barcodes WHERE id = ?", [releaseId]);
  assert.equal(gone.c, 0);

  const [auditRows] = await db.query(
    "SELECT detail FROM item_audit_logs WHERE target_type='sku' AND target_id=? AND action='barcode.release'",
    [fixture.skuId]
  );
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].detail.barcode, barcodeToRelease);
});

test("條碼釋放：barcodeId 唔屬呢個 SKU：404 BARCODE_NOT_FOUND", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token, device } = await withDeviceManager(t, application);
  const catalog = await seedCatalog(db);
  const fixtureA = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active"] });
  const fixtureB = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active"] });
  const barcodeOnB = await seedBarcode(db, {
    skuId: fixtureB.skuId,
    skuUomId: fixtureB.skuUomId,
    barcode: `IT-BC-XOWNER-${randomUUID().slice(0, 8)}`,
    isPrimary: true
  });
  t.after(async () => {
    await db.execute("DELETE FROM item_sku_barcodes WHERE sku_id = ?", [fixtureB.skuId]);
    await fixtureA.cleanup();
    await fixtureB.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const path = `/api/v1/skus/${fixtureA.skuId}/barcodes/${barcodeOnB}/release`;
  const { status, body } = await signedPost(url, path, device, token, {
    reason: "整合測試：跨 SKU 釋放",
    version: 1,
    password: PASSWORD
  });

  assert.equal(status, 404, JSON.stringify(body));
  assert.equal(body.error.code, "BARCODE_NOT_FOUND");
});

test("條碼釋放：version 唔啱：409 VERSION_CONFLICT，條碼冇被刪", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token, device } = await withDeviceManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active"] });
  const barcodeId = await seedBarcode(db, {
    skuId: fixture.skuId,
    skuUomId: fixture.skuUomId,
    barcode: `IT-BC-CONFLICT-${randomUUID().slice(0, 8)}`,
    isPrimary: true
  });
  t.after(async () => {
    await db.execute("DELETE FROM item_sku_barcodes WHERE sku_id = ?", [fixture.skuId]);
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const path = `/api/v1/skus/${fixture.skuId}/barcodes/${barcodeId}/release`;
  const { status, body } = await signedPost(url, path, device, token, {
    reason: "整合測試：stale version",
    version: 999,
    password: PASSWORD
  });

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "VERSION_CONFLICT");

  const [[stillThere]] = await db.query("SELECT COUNT(*) AS c FROM item_sku_barcodes WHERE id = ?", [barcodeId]);
  assert.equal(stillThere.c, 1);
});
