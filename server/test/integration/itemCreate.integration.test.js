/**
 * T14 嘅 Item＋SKU 原子建檔端點，對一個真的、已經 migrate 過的 MySQL 驗收。
 * 設計說明見 docs/items_management/design_spec.md §4.1、§4.3、§6.2、§6.9。
 *
 * 呢度要驗嘅係假連線頂唔到嘅嘢：真正嘅 transaction rollback（唔係「呼叫咗
 * ROLLBACK」，係「查返 DB 真係咩都冇存到」）、SKU Code／Barcode 嘅 unique key
 * 喺真 DB 底下真係擋到、idempotency 經真正嘅 HTTP round trip 真係得返一個
 * response。範圍決定（T14 只做 Standard Item）見
 * docs/items_management/tasks.md 嘅 T14／T23 條目。
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

// createItem 有 idempotency（見 createItemHandler.js），少咗 Idempotency-Key
// header 一律 400 IDEMPOTENCY_KEY_REQUIRED，喺 handler 完全冇機會執行——每次
// 呼叫預設帶一個新 key，測 idempotency 本身嗰個 test 先自己傳同一個 key 覆蓋。
function post(url, token, body, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: JSON.stringify(body)
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

/** 分類、品牌、UOM 三張 catalog 表，跟返 FK 依賴反向刪除。 */
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
    [`IT${suffix}`, "Integration Test Unit", nowMs, nowMs]
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

/** 建立咗嘅 Item（連同佢嘅 SKU／UOM／Barcode／Audit）事後清理。 */
async function cleanupCreatedItem(db, itemId) {
  if (!itemId) return;
  const [skuRows] = await db.query("SELECT id FROM item_skus WHERE item_id = ?", [itemId]);
  for (const { id: skuId } of skuRows) {
    await db.execute("DELETE FROM item_sku_barcodes WHERE sku_id = ?", [skuId]);
    await db.execute("DELETE FROM item_sku_uoms WHERE sku_id = ?", [skuId]);
    await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'sku' AND target_id = ?", [skuId]);
  }
  await db.execute("DELETE FROM item_skus WHERE item_id = ?", [itemId]);
  await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'item' AND target_id = ?", [itemId]);
  await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
}

async function withManager(t, application) {
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const role = await seedRole(db, { permissionNames: ["item.view", "item.mgmt"] });
  const actor = await seedUser(db, { username: `it-item-create-${randomUUID().slice(0, 8)}`, roleId: role.roleId });
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: ["item.view", "item.mgmt"] });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await role.cleanup();
  });

  return { db, token, actorId: actor.userId, roleName: role.roleName };
}

function basePayload(catalog, overrides = {}) {
  const suffix = randomUUID().slice(0, 10);
  return {
    item: {
      name: `維他命 C ${suffix}`,
      categoryId: catalog.categoryId,
      brandId: catalog.brandId,
      productType: "standard",
      ...overrides.item
    },
    skus: overrides.skus ?? [
      {
        skuCode: `SKU-${suffix}`,
        skuName: `維他命 C ${suffix} 90 粒裝`,
        sellable: true,
        suggestedPriceAmount: "128.0000",
        uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
        barcodes: [],
        ...overrides.sku
      }
    ],
    ...(overrides.activate !== undefined ? { activate: overrides.activate } : {}),
    ...(overrides.activationReason !== undefined ? { activationReason: overrides.activationReason } : {})
  };
}

// --- POST /api/v1/items/create ----------------------------------------------

test("建立 Standard Item＋SKU（唔啟用）：狀態係 draft，UOM／Barcode 一齊寫入，audit 記低 item.create 同 sku.create", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const created = { itemId: null };
  // node:test 嘅 t.after() 係跟登記順序執行（唔係 LIFO），所以呢個 hook 一定要
  // 喺 seedCatalog() 之後、其他 t.after() 之前登記，先保證刪 Item／SKU（會用到
  // catalog 嘅 FK）一定行喺 catalog.cleanup() 之前。
  t.after(async () => {
    await cleanupCreatedItem(db, created.itemId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = basePayload(catalog, {
    sku: { barcodes: [{ barcode: "IT-BARCODE-1", barcodeType: "internal", uomId: catalog.uomId, isPrimary: true }] }
  });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 201, JSON.stringify(body));
  created.itemId = body.data.id;
  assert.equal(body.data.status, "draft");
  assert.equal(body.data.skus.length, 1);
  assert.equal(body.data.skus[0].status, "draft");
  assert.equal(body.data.skus[0].skuCode, payload.skus[0].skuCode);

  const [skuUomRows] = await db.query("SELECT is_base FROM item_sku_uoms WHERE sku_id = ?", [
    body.data.skus[0].id
  ]);
  assert.equal(skuUomRows.length, 1);
  assert.equal(Boolean(skuUomRows[0].is_base), true);

  const [barcodeRows] = await db.query("SELECT normalized_barcode FROM item_sku_barcodes WHERE sku_id = ?", [
    body.data.skus[0].id
  ]);
  assert.equal(barcodeRows.length, 1);
  assert.equal(barcodeRows[0].normalized_barcode, "IT-BARCODE-1");

  const [auditRows] = await db.query(
    "SELECT action, target_type, target_id FROM item_audit_logs WHERE (target_type = 'item' AND target_id = ?) OR (target_type = 'sku' AND target_id = ?) ORDER BY id",
    [created.itemId, body.data.skus[0].id]
  );
  assert.deepEqual(
    auditRows.map((row) => row.action),
    ["item.create", "sku.create"]
  );
});

test("建立並直接 activate：Item／SKU 同交易變 active，version 變 2", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const created = { itemId: null };
  t.after(async () => {
    await cleanupCreatedItem(db, created.itemId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = basePayload(catalog, { activate: true, activationReason: "完成初次建檔並上架" });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 201, JSON.stringify(body));
  created.itemId = body.data.id;
  assert.equal(body.data.status, "active");
  assert.equal(body.data.version, 2);
  assert.equal(body.data.skus[0].status, "active");
  assert.equal(body.data.skus[0].version, 2);
});

test("activate:true 但缺 activationReason：400，完全冇碰資料庫", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  t.after(async () => {
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = basePayload(catalog, { activate: true });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 400, JSON.stringify(body));
  assert.equal(body.error.code, "ACTIVATION_REASON_REQUIRED");
});

test("activate:true 但唔夠完整（冇 Base UOM）：422 ITEM_NOT_ACTIVATABLE，成個 aggregate 冇存落 DB", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  t.after(async () => {
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = basePayload(catalog, {
    activate: true,
    activationReason: "測試 rollback",
    sku: { uoms: [] }
  });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "ITEM_NOT_ACTIVATABLE");
  assert.ok(body.error.details.issues.some((issue) => issue.code === "BASE_UOM_REQUIRED"));

  const [itemRows] = await db.query("SELECT id FROM items WHERE name = ?", [payload.item.name]);
  assert.equal(itemRows.length, 0, "assertSkuActivatable 拋出之後成個交易要 rollback，唔應該有任何殘留");
});

test("productType: variant：400 ITEM_VARIANT_NOT_SUPPORTED（T14 範圍決定，見 tasks.md）", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  t.after(async () => {
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = basePayload(catalog, { item: { productType: "variant" } });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 400, JSON.stringify(body));
  assert.equal(body.error.code, "ITEM_VARIANT_NOT_SUPPORTED");

  const [itemRows] = await db.query("SELECT id FROM items WHERE name = ?", [payload.item.name]);
  assert.equal(itemRows.length, 0);
});

test("Standard Item 送兩個 SKU：409 STANDARD_ITEM_SKU_LIMIT", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  t.after(async () => {
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const suffix = randomUUID().slice(0, 8);
  const payload = basePayload(catalog, {
    skus: [
      { skuCode: `SKU-A-${suffix}`, skuName: "A", uoms: [], barcodes: [] },
      { skuCode: `SKU-B-${suffix}`, skuName: "B", uoms: [], barcodes: [] }
    ]
  });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "STANDARD_ITEM_SKU_LIMIT");

  const [itemRows] = await db.query("SELECT id FROM items WHERE name = ?", [payload.item.name]);
  assert.equal(itemRows.length, 0);
});

test("SKU Code 唔分大小寫全域唯一：撞咗已存在嘅 code 就 409 SKU_CODE_TAKEN，新嗰個 Item 完全冇殘留", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const created = { itemId: null };
  t.after(async () => {
    await cleanupCreatedItem(db, created.itemId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const firstPayload = basePayload(catalog);
  const first = await post(`${url}/api/v1/items/create`, token, firstPayload);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  created.itemId = first.body.data.id;

  const secondPayload = basePayload(catalog, {
    sku: { skuCode: firstPayload.skus[0].skuCode.toLowerCase() }
  });
  const second = await post(`${url}/api/v1/items/create`, token, secondPayload);

  assert.equal(second.status, 409, JSON.stringify(second.body));
  assert.equal(second.body.error.code, "SKU_CODE_TAKEN");

  const [itemRows] = await db.query("SELECT id FROM items WHERE name = ?", [secondPayload.item.name]);
  assert.equal(itemRows.length, 0, "第二次撞 SKU Code 失敗嗰個 Item 唔應該有任何殘留");
});

test("Barcode 全域唯一：撞咗已存在嘅條碼就 409 BARCODE_TAKEN", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const created = { itemId: null };
  t.after(async () => {
    await cleanupCreatedItem(db, created.itemId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const sharedBarcode = `IT-DUP-${randomUUID().slice(0, 8)}`;
  const firstPayload = basePayload(catalog, {
    sku: { barcodes: [{ barcode: sharedBarcode, barcodeType: "internal", uomId: catalog.uomId, isPrimary: true }] }
  });
  const first = await post(`${url}/api/v1/items/create`, token, firstPayload);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  created.itemId = first.body.data.id;

  const secondPayload = basePayload(catalog, {
    sku: { barcodes: [{ barcode: sharedBarcode, barcodeType: "internal", uomId: catalog.uomId, isPrimary: true }] }
  });
  const second = await post(`${url}/api/v1/items/create`, token, secondPayload);

  assert.equal(second.status, 409, JSON.stringify(second.body));
  assert.equal(second.body.error.code, "BARCODE_TAKEN");

  const [itemRows] = await db.query("SELECT id FROM items WHERE name = ?", [secondPayload.item.name]);
  assert.equal(itemRows.length, 0);
});

test("categoryId／brandId／uomId 唔存在：分別回 404，唔碰資料庫留低殘留", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  t.after(async () => {
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const missingCategory = basePayload(catalog, { item: { categoryId: 999999999 } });
  const categoryResult = await post(`${url}/api/v1/items/create`, token, missingCategory);
  assert.equal(categoryResult.status, 404, JSON.stringify(categoryResult.body));
  assert.equal(categoryResult.body.error.code, "CATEGORY_NOT_FOUND");

  const missingBrand = basePayload(catalog, { item: { brandId: 999999999 } });
  const brandResult = await post(`${url}/api/v1/items/create`, token, missingBrand);
  assert.equal(brandResult.status, 404, JSON.stringify(brandResult.body));
  assert.equal(brandResult.body.error.code, "BRAND_NOT_FOUND");

  const missingUom = basePayload(catalog, {
    sku: { uoms: [{ uomId: 999999999, toBaseFactor: 1, isBase: true }] }
  });
  const uomResult = await post(`${url}/api/v1/items/create`, token, missingUom);
  assert.equal(uomResult.status, 404, JSON.stringify(uomResult.body));
  assert.equal(uomResult.body.error.code, "UOM_NOT_FOUND");

  const [itemRows] = await db.query("SELECT id FROM items WHERE name IN (?, ?, ?)", [
    missingCategory.item.name,
    missingBrand.item.name,
    missingUom.item.name
  ]);
  assert.equal(itemRows.length, 0);
});

test("SKU 嘅 UOM 結構性錯誤：重複同一個 uomId、或者多過一個 Base，一律 400 UOM_CONVERSION_INVALID", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  t.after(async () => {
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const duplicateUom = basePayload(catalog, {
    sku: {
      uoms: [
        { uomId: catalog.uomId, toBaseFactor: 1, isBase: true },
        { uomId: catalog.uomId, toBaseFactor: 12 }
      ]
    }
  });
  const duplicateResult = await post(`${url}/api/v1/items/create`, token, duplicateUom);
  assert.equal(duplicateResult.status, 400, JSON.stringify(duplicateResult.body));
  assert.equal(duplicateResult.body.error.code, "UOM_CONVERSION_INVALID");
});

test("Barcode 嘅 uomId 唔屬於呢個 SKU 提交嘅任何 UOM：400 SKU_CHILD_MISMATCH", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  t.after(async () => {
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = basePayload(catalog, {
    sku: {
      uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true }],
      barcodes: [{ barcode: "IT-MISMATCH", barcodeType: "internal", uomId: 999999999, isPrimary: true }]
    }
  });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 400, JSON.stringify(body));
  assert.equal(body.error.code, "SKU_CHILD_MISMATCH");
});

test("同一個包裝單位有兩個 primary barcode：400 BARCODE_PRIMARY_DUPLICATED", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  t.after(async () => {
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = basePayload(catalog, {
    sku: {
      uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true }],
      barcodes: [
        { barcode: "IT-PRIMARY-1", barcodeType: "internal", uomId: catalog.uomId, isPrimary: true },
        { barcode: "IT-PRIMARY-2", barcodeType: "internal", uomId: catalog.uomId, isPrimary: true }
      ]
    }
  });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 400, JSON.stringify(body));
  assert.equal(body.error.code, "BARCODE_PRIMARY_DUPLICATED");
});

test("淨係 item.view 冇 item.mgmt：403，PERMISSION_STALE 喺 claim 過咗靜態 gate 之後先偵測到權限已改", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const catalog = await seedCatalog(db);
  const viewRole = await seedRole(db, { permissionNames: ["item.view"] });
  const actor = await seedUser(db, { username: `it-item-create-view-${randomUUID().slice(0, 8)}`, roleId: viewRole.roleId });
  const token = await issueToken(actor.userId, { roles: [viewRole.roleName], permissions: ["item.view"] });
  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await viewRole.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { status, body } = await post(`${url}/api/v1/items/create`, token, basePayload(catalog));

  assert.equal(status, 403, JSON.stringify(body));

  // PERMISSION_STALE：claim 咗 item.mgmt（滿足 handler 嘅靜態 authorizationPolicies
  // gate）但 DB 入面實際冇呢個權限——先入到 service 嘅 assertActorFresh() 先偵測到
  // 唔一致。同 T11 對呢個 gotcha 嘅說明一致。
  const staleToken = await issueToken(actor.userId, {
    roles: [viewRole.roleName],
    permissions: ["item.view", "item.mgmt"]
  });
  const staleResult = await post(`${url}/api/v1/items/create`, staleToken, basePayload(catalog));
  assert.equal(staleResult.status, 403, JSON.stringify(staleResult.body));
  assert.equal(staleResult.body.error.code, "PERMISSION_STALE");
});

test("Idempotency-Key：同一個 key 連撞兩次，第二次直接攞返第一次嘅 response，唔會建多一個 Item", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const created = { itemId: null };
  t.after(async () => {
    await cleanupCreatedItem(db, created.itemId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = basePayload(catalog);
  const key = randomUUID();

  const first = await post(`${url}/api/v1/items/create`, token, payload, { "Idempotency-Key": key });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  created.itemId = first.body.data.id;

  const second = await post(`${url}/api/v1/items/create`, token, payload, { "Idempotency-Key": key });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.data.id, created.itemId, "同一個 idempotency key 應該攞返同一次 response，唔係再執行一次 handler");

  const [itemRows] = await db.query("SELECT id FROM items WHERE name = ?", [payload.item.name]);
  assert.equal(itemRows.length, 1, "唔應該因為重送就建多一個 Item");
});
