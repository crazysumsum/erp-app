/**
 * T16 嘅 Item／SKU aggregate 更新端點，對一個真的、已經 migrate 過的 MySQL
 * 驗收。設計說明見 docs/items_management/design_spec.md §4.2、§4.6、§6.2、
 * §6.3、§6.9、§8.4。
 *
 * 呢度要驗嘅係假連線頂唔到嘅嘢：`WHERE version = ?` 嘅 compare-and-set 喺
 * 真 DB 底下真係唔會覆蓋人哋、UOM／Barcode 刪晒重插之後真係得返提交嗰set、
 * `SKU_CHILD_MISMATCH` 真係擋到跨 SKU 冒用 child id。範圍決定（未有交易／
 * 庫存表可以查，所以「關鍵變更」呢期淨係要求 reason，未去到「已有交易就
 * 擋」嗰層）見 docs/items_management/tasks.md 嘅 T16 條目。
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

async function seedUser(db, { username, roleId }) {
  const passwordHash = await hashPassword("unused-password!");
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

async function withManager(t, application) {
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const role = await seedRole(db, { permissionNames: ["item.view", "item.mgmt"] });
  const actor = await seedUser(db, { username: `it-item-upd-${randomUUID().slice(0, 8)}`, roleId: role.roleId });
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: ["item.view", "item.mgmt"] });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await role.cleanup();
  });

  return { db, token, actorId: actor.userId, roleName: role.roleName };
}

/** 分類、品牌、兩個 UOM（俾「換 Base UOM」呢類測試用），跟返 FK 依賴反向刪除。 */
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

  const [uomA] = await db.query(
    "INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    [`ITA${suffix}`, "Integration Test Unit A", nowMs, nowMs]
  );
  const [uomB] = await db.query(
    "INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    [`ITB${suffix}`, "Integration Test Unit B", nowMs, nowMs]
  );

  return {
    categoryId,
    brandId,
    uomId: uomA.insertId,
    uomIdB: uomB.insertId,
    async cleanup() {
      await db.execute("DELETE FROM item_uoms WHERE id IN (?, ?)", [uomA.insertId, uomB.insertId]);
      await db.execute("DELETE FROM item_brands WHERE id = ?", [brandId]);
      await db.execute("DELETE FROM item_categories WHERE id = ?", [categoryId]);
    }
  };
}

/** 直接寫入一個完整嘅 Item＋SKU＋一個 Base UOM＋一個條碼，跳過 create API，
 * 專注測 update 本身。回傳 ids 同一個 cleanup()。 */
async function seedItemWithSku(db, catalog, { itemStatus = "active", skuStatus = "active" } = {}) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);

  const [item] = await db.query(
    `INSERT INTO items (name, category_id, brand_id, product_type, status, created_at, updated_at)
     VALUES (?, ?, ?, 'standard', ?, ?, ?)`,
    [`it-item-${suffix}`, catalog.categoryId, catalog.brandId, itemStatus, nowMs, nowMs]
  );
  const itemId = item.insertId;

  const [sku] = await db.query(
    `INSERT INTO item_skus
       (item_id, sku_code, sku_name, tracking_policy, purchasable, sellable, inventory_tracked,
        suggested_price_amount, status, created_at, updated_at)
     VALUES (?, ?, ?, 'none', 1, 1, 1, '100.0000', ?, ?, ?)`,
    [itemId, `IT-SKU-${suffix}`, "Integration test SKU", skuStatus, nowMs, nowMs]
  );
  const skuId = sku.insertId;

  const [skuUom] = await db.query(
    `INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, is_default_sale, created_at, updated_at)
     VALUES (?, ?, 1, 1, 1, ?, ?)`,
    [skuId, catalog.uomId, nowMs, nowMs]
  );
  const skuUomId = skuUom.insertId;

  const barcodeValue = `IT-BC-${suffix}`;
  const [barcode] = await db.query(
    `INSERT INTO item_sku_barcodes
       (sku_id, sku_uom_id, barcode, normalized_barcode, barcode_type, is_primary, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'internal', 1, ?, ?)`,
    [skuId, skuUomId, barcodeValue, barcodeValue, nowMs, nowMs]
  );
  const barcodeId = barcode.insertId;

  return {
    itemId,
    skuId,
    skuUomId,
    barcodeId,
    barcodeValue,
    async cleanup() {
      await db.execute("DELETE FROM item_sku_barcodes WHERE sku_id = ?", [skuId]);
      await db.execute("DELETE FROM item_sku_uoms WHERE sku_id = ?", [skuId]);
      await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'sku' AND target_id = ?", [skuId]);
      await db.execute("DELETE FROM item_skus WHERE id = ?", [skuId]);
      await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'item' AND target_id = ?", [itemId]);
      await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
    }
  };
}

// --- POST /api/v1/items/:id/update ------------------------------------------

test("更新 Item：改名同分類，version 遞增，audit 記低 before/after", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/update`, token, {
    name: "更新後嘅名稱",
    shortName: "",
    manufacturer: "",
    defaultTrackingPolicy: "none",
    categoryId: catalog.categoryId,
    brandId: catalog.brandId,
    version: 1
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.name, "更新後嘅名稱");
  assert.equal(body.data.version, 2);

  const [auditRows] = await db.query(
    "SELECT detail FROM item_audit_logs WHERE target_type='item' AND target_id=? AND action='item.update'",
    [fixture.itemId]
  );
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].detail.name.after, "更新後嘅名稱");
});

test("更新 Item：version 唔啱：409 VERSION_CONFLICT，唔寫資料唔寫 audit", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/items/${fixture.itemId}/update`, token, {
    name: "唔應該成功",
    version: 999
  });

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "VERSION_CONFLICT");

  const [[row]] = await db.query("SELECT name, version FROM items WHERE id = ?", [fixture.itemId]);
  assert.notEqual(row.name, "唔應該成功");
  assert.equal(row.version, 1);

  const [auditRows] = await db.query(
    "SELECT id FROM item_audit_logs WHERE target_type='item' AND target_id=? AND action='item.update'",
    [fixture.itemId]
  );
  assert.equal(auditRows.length, 0);
});

test("更新 Item：唔存在嘅 id：404 ITEM_NOT_FOUND", { skip }, async (t) => {
  const application = await startApplication();
  const { token } = await withManager(t, application);
  t.after(async () => application.shutdown("integration_test_complete"));

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/items/999999999/update`, token, {
    name: "冇呢個 Item",
    version: 1
  });

  assert.equal(status, 404, JSON.stringify(body));
  assert.equal(body.error.code, "ITEM_NOT_FOUND");
});

// --- POST /api/v1/skus/:id/update --------------------------------------------

function baseSkuPayload(fixture, catalog, overrides = {}) {
  return {
    skuName: "Integration test SKU",
    trackingPolicy: "none",
    purchasable: true,
    sellable: true,
    inventoryTracked: true,
    suggestedPriceAmount: "100.0000",
    uoms: [{ id: fixture.skuUomId, uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
    barcodes: [{ id: fixture.barcodeId, barcode: fixture.barcodeValue, barcodeType: "internal", uomId: catalog.uomId, isPrimary: true }],
    version: 1,
    ...overrides
  };
}

test("TC-007 更新 SKU：淨係改 RRP，唔使填 reason，audit 保存前後 amount／HKD／tax_not_applicable", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(
    `${url}/api/v1/skus/${fixture.skuId}/update`,
    token,
    baseSkuPayload(fixture, catalog, { suggestedPriceAmount: "150.0000" })
  );

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.suggestedRetailPrice.amount, "150.0000");
  assert.equal(body.data.version, 2);

  const [auditRows] = await db.query(
    "SELECT detail, reason FROM item_audit_logs WHERE target_type='sku' AND target_id=? AND action='sku.update'",
    [fixture.skuId]
  );
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].detail.suggestedRetailPrice.before.amount, "100.0000");
  assert.equal(auditRows[0].detail.suggestedRetailPrice.after.amount, "150.0000");
  assert.equal(auditRows[0].detail.suggestedRetailPrice.after.currency, "HKD");
  assert.equal(auditRows[0].detail.suggestedRetailPrice.after.taxBasis, "tax_not_applicable");
});

test("更新 SKU：改追蹤政策（關鍵變更）冇填 reason：400 CRITICAL_CHANGE_REASON_REQUIRED，UOM／Barcode 完全冇被刪重插", {
  skip
}, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(
    `${url}/api/v1/skus/${fixture.skuId}/update`,
    token,
    baseSkuPayload(fixture, catalog, { trackingPolicy: "batch", shelfLifeDays: undefined })
  );

  assert.equal(status, 400, JSON.stringify(body));
  assert.equal(body.error.code, "CRITICAL_CHANGE_REASON_REQUIRED");

  const [[skuRow]] = await db.query("SELECT tracking_policy, version FROM item_skus WHERE id = ?", [fixture.skuId]);
  assert.equal(skuRow.tracking_policy, "none");
  assert.equal(skuRow.version, 1);

  const [[uomRow]] = await db.query("SELECT id FROM item_sku_uoms WHERE id = ?", [fixture.skuUomId]);
  assert.ok(uomRow, "原本嘅 UOM 行唔應該俾刪咗重插（連 id 都要維持）");
});

test("更新 SKU：改追蹤政策連同 reason：成功，audit 記低 reason 同 criticalUomOrTrackingChange", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(
    `${url}/api/v1/skus/${fixture.skuId}/update`,
    token,
    baseSkuPayload(fixture, catalog, {
      trackingPolicy: "batch_expiry",
      shelfLifeDays: 365,
      reason: "改追蹤政策以配合新採購流程"
    })
  );

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.trackingPolicy, "batch_expiry");

  const [auditRows] = await db.query(
    "SELECT detail, reason FROM item_audit_logs WHERE target_type='sku' AND target_id=? AND action='sku.update'",
    [fixture.skuId]
  );
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].reason, "改追蹤政策以配合新採購流程");
  assert.equal(auditRows[0].detail.criticalUomOrTrackingChange, true);
});

test("更新 SKU：換 Base UOM（換去另一個 uomId）都算關鍵變更，一樣要 reason", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = baseSkuPayload(fixture, catalog, {
    uoms: [{ uomId: catalog.uomIdB, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
    barcodes: []
  });
  const { status, body } = await post(`${url}/api/v1/skus/${fixture.skuId}/update`, token, payload);

  assert.equal(status, 400, JSON.stringify(body));
  assert.equal(body.error.code, "CRITICAL_CHANGE_REASON_REQUIRED");
});

test("更新 SKU：UOM 陣列帶另一個 SKU 嘅 child id：400 SKU_CHILD_MISMATCH", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixtureA = await seedItemWithSku(db, catalog);
  const fixtureB = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixtureA.cleanup();
    await fixtureB.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = baseSkuPayload(fixtureA, catalog, {
    uoms: [{ id: fixtureB.skuUomId, uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }]
  });
  const { status, body } = await post(`${url}/api/v1/skus/${fixtureA.skuId}/update`, token, payload);

  assert.equal(status, 400, JSON.stringify(body));
  assert.equal(body.error.code, "SKU_CHILD_MISMATCH");
});

test("更新 SKU：Barcode 陣列帶另一個 SKU 嘅 child id：400 SKU_CHILD_MISMATCH", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixtureA = await seedItemWithSku(db, catalog);
  const fixtureB = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixtureA.cleanup();
    await fixtureB.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = baseSkuPayload(fixtureA, catalog, {
    barcodes: [{ id: fixtureB.barcodeId, barcode: "IT-MISMATCH", barcodeType: "internal", uomId: catalog.uomId, isPrimary: true }]
  });
  const { status, body } = await post(`${url}/api/v1/skus/${fixtureA.skuId}/update`, token, payload);

  assert.equal(status, 400, JSON.stringify(body));
  assert.equal(body.error.code, "SKU_CHILD_MISMATCH");
});

test("更新 SKU：撞另一個 SKU 已用緊嘅條碼：409 BARCODE_TAKEN", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixtureA = await seedItemWithSku(db, catalog);
  const fixtureB = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixtureA.cleanup();
    await fixtureB.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = baseSkuPayload(fixtureA, catalog, {
    barcodes: [{ barcode: fixtureB.barcodeValue, barcodeType: "internal", uomId: catalog.uomId, isPrimary: true }]
  });
  const { status, body } = await post(`${url}/api/v1/skus/${fixtureA.skuId}/update`, token, payload);

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "BARCODE_TAKEN");
});

test("更新 SKU：version 唔啱：409 VERSION_CONFLICT，UOM／Barcode 完全冇被刪重插", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(
    `${url}/api/v1/skus/${fixture.skuId}/update`,
    token,
    baseSkuPayload(fixture, catalog, { version: 999 })
  );

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "VERSION_CONFLICT");

  const [[uomRow]] = await db.query("SELECT id FROM item_sku_uoms WHERE id = ?", [fixture.skuUomId]);
  assert.ok(uomRow, "version 衝突嗰陣完全唔應該碰 UOM／Barcode 子表");
});

test("更新 SKU：淨係 item.view 冇 item.mgmt：403，PERMISSION_STALE", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog);
  const viewRole = await seedRole(db, { permissionNames: ["item.view"] });
  const actor = await seedUser(db, { username: `it-item-upd-view-${randomUUID().slice(0, 8)}`, roleId: viewRole.roleId });
  const token = await issueToken(actor.userId, { roles: [viewRole.roleName], permissions: ["item.view"] });
  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await viewRole.cleanup();
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status } = await post(`${url}/api/v1/skus/${fixture.skuId}/update`, token, baseSkuPayload(fixture, catalog));
  assert.equal(status, 403);

  const staleToken = await issueToken(actor.userId, {
    roles: [viewRole.roleName],
    permissions: ["item.view", "item.mgmt"]
  });
  const staleResult = await post(
    `${url}/api/v1/skus/${fixture.skuId}/update`,
    staleToken,
    baseSkuPayload(fixture, catalog)
  );
  assert.equal(staleResult.status, 403, JSON.stringify(staleResult.body));
  assert.equal(staleResult.body.error.code, "PERMISSION_STALE");
});
