/**
 * T14／T23 嘅 Item＋SKU 原子建檔端點，對一個真的、已經 migrate 過的 MySQL
 * 驗收。設計說明見 docs/items_management/design_spec.md §4.1、§4.3、§4.4、
 * §6.2、§6.9。
 *
 * 呢度要驗嘅係假連線頂唔到嘅嘢：真正嘅 transaction rollback（唔係「呼叫咗
 * ROLLBACK」，係「查返 DB 真係咩都冇存到」）、SKU Code／Barcode／variant
 * signature 嘅 unique key 喺真 DB 底下真係擋到、idempotency 經真正嘅 HTTP
 * round trip 真係得返一個 response。
 *
 * Variant 相關測試直接種 attribute definition／option 落 DB（跳過
 * attribute CRUD API）：Attribute 嘅新增／修改 endpoint 係 T24 先建立，呢個
 * task（T23）淨係開放 `createItem()` 接受已經存在嘅 attribute／option 建
 * Variant Item，同 T16／T18／T20 遇到「下一個 task 先有嘅 CRUD」嗰陣一樣，
 * 直接用 SQL 種好啲要用嘅資料。
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

/** 一個 is_variant／single_option 嘅屬性連兩個選項，跳過 Attribute CRUD API
 * （T24 先有）直接種落 DB。 */
async function seedVariantAttribute(db, { optionLabels = ["紅", "藍"] } = {}) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);

  const [attribute] = await db.query(
    `INSERT INTO item_attribute_definitions
       (code, name, data_type, is_variant, is_filterable, status, created_at, updated_at)
     VALUES (?, ?, 'single_option', 1, 0, 'active', ?, ?)`,
    [`it-attr-${suffix}`, `Integration Test Colour ${suffix}`, nowMs, nowMs]
  );
  const attributeId = attribute.insertId;

  const optionIds = [];
  for (const label of optionLabels) {
    const [option] = await db.query(
      `INSERT INTO item_attribute_options (attribute_id, value, label, sort_order, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      [attributeId, label, label, optionIds.length, nowMs, nowMs]
    );
    optionIds.push(option.insertId);
  }

  return {
    attributeId,
    optionIds,
    async cleanup() {
      await db.execute("DELETE FROM item_attribute_options WHERE attribute_id = ?", [attributeId]);
      await db.execute("DELETE FROM item_attribute_definitions WHERE id = ?", [attributeId]);
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

// --- Variant Item（T23） -----------------------------------------------------

test("Variant Item：兩個 SKU 用唔同規格組合，一齊建成，各自有唔同嘅 variant_signature", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const attribute = await seedVariantAttribute(db);
  const created = { itemId: null };
  t.after(async () => {
    await cleanupCreatedItem(db, created.itemId);
    await attribute.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const suffix = randomUUID().slice(0, 8);
  const payload = basePayload(catalog, {
    item: { productType: "variant" },
    skus: [
      {
        skuCode: `SKU-RED-${suffix}`,
        skuName: "紅色",
        suggestedPriceAmount: "128.0000",
        uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
        barcodes: [],
        variantValues: [{ attributeId: attribute.attributeId, optionId: attribute.optionIds[0] }]
      },
      {
        skuCode: `SKU-BLUE-${suffix}`,
        skuName: "藍色",
        suggestedPriceAmount: "128.0000",
        uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
        barcodes: [],
        variantValues: [{ attributeId: attribute.attributeId, optionId: attribute.optionIds[1] }]
      }
    ]
  });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 201, JSON.stringify(body));
  created.itemId = body.data.id;
  assert.equal(body.data.skus.length, 2);

  const [skuRows] = await db.query(
    "SELECT id, sku_code, variant_signature FROM item_skus WHERE item_id = ? ORDER BY id",
    [created.itemId]
  );
  assert.equal(skuRows.length, 2);
  assert.match(skuRows[0].variant_signature, /^[0-9a-f]{64}$/);
  assert.match(skuRows[1].variant_signature, /^[0-9a-f]{64}$/);
  assert.notEqual(skuRows[0].variant_signature, skuRows[1].variant_signature);

  const [attributeValueRows] = await db.query(
    "SELECT sku_id, attribute_id, option_id FROM item_sku_attribute_values WHERE sku_id IN (?, ?) ORDER BY sku_id",
    [skuRows[0].id, skuRows[1].id]
  );
  assert.equal(attributeValueRows.length, 2);
  assert.equal(attributeValueRows[0].attribute_id, attribute.attributeId);
  assert.equal(attributeValueRows[0].option_id, attribute.optionIds[0]);
  assert.equal(attributeValueRows[1].option_id, attribute.optionIds[1]);
});

test("Variant Item：兩個 SKU 用完全相同嘅規格組合：409 VARIANT_COMBINATION_TAKEN，成個交易 rollback", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const attribute = await seedVariantAttribute(db);
  t.after(async () => {
    await attribute.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const suffix = randomUUID().slice(0, 8);
  const variantValues = [{ attributeId: attribute.attributeId, optionId: attribute.optionIds[0] }];
  const payload = basePayload(catalog, {
    item: { productType: "variant" },
    skus: [
      {
        skuCode: `SKU-A-${suffix}`,
        skuName: "A",
        suggestedPriceAmount: "128.0000",
        uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
        barcodes: [],
        variantValues
      },
      {
        skuCode: `SKU-B-${suffix}`,
        skuName: "B",
        suggestedPriceAmount: "128.0000",
        uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
        barcodes: [],
        variantValues
      }
    ]
  });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "VARIANT_COMBINATION_TAKEN");

  const [itemRows] = await db.query("SELECT id FROM items WHERE name = ?", [payload.item.name]);
  assert.equal(itemRows.length, 0, "撞咗規格組合，連第一粒已經插入嘅 SKU 都要 rollback");
});

test("Standard Item 嘅 SKU 帶 variantValues：400 STANDARD_SKU_HAS_VARIANT_VALUES", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const attribute = await seedVariantAttribute(db);
  t.after(async () => {
    await attribute.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = basePayload(catalog, {
    sku: { variantValues: [{ attributeId: attribute.attributeId, optionId: attribute.optionIds[0] }] }
  });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 400, JSON.stringify(body));
  assert.equal(body.error.code, "STANDARD_SKU_HAS_VARIANT_VALUES");

  const [itemRows] = await db.query("SELECT id FROM items WHERE name = ?", [payload.item.name]);
  assert.equal(itemRows.length, 0);
});

test("Variant Item 嘅 SKU 冇帶 variantValues：400 VARIANT_VALUES_REQUIRED", { skip }, async (t) => {
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
  assert.equal(body.error.code, "VARIANT_VALUES_REQUIRED");
});

test("Variant Item：attributeId 唔存在：404 ATTRIBUTE_NOT_FOUND", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  t.after(async () => {
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = basePayload(catalog, {
    item: { productType: "variant" },
    sku: { variantValues: [{ attributeId: 999999999, optionId: 1 }] }
  });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 404, JSON.stringify(body));
  assert.equal(body.error.code, "ATTRIBUTE_NOT_FOUND");
});

test("Variant Item：optionId 唔存在：404 ATTRIBUTE_OPTION_NOT_FOUND", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const attribute = await seedVariantAttribute(db);
  t.after(async () => {
    await attribute.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = basePayload(catalog, {
    item: { productType: "variant" },
    sku: { variantValues: [{ attributeId: attribute.attributeId, optionId: 999999999 }] }
  });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 404, JSON.stringify(body));
  assert.equal(body.error.code, "ATTRIBUTE_OPTION_NOT_FOUND");
});

test("Variant Item：attribute 唔係 is_variant：400 ATTRIBUTE_VALUE_INVALID", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const [descriptiveAttribute] = await db.query(
    `INSERT INTO item_attribute_definitions
       (code, name, data_type, is_variant, is_filterable, status, created_at, updated_at)
     VALUES (?, ?, 'single_option', 0, 0, 'active', ?, ?)`,
    [`it-attr-desc-${suffix}`, `Integration Test Descriptive ${suffix}`, nowMs, nowMs]
  );
  const attributeId = descriptiveAttribute.insertId;
  const [option] = await db.query(
    `INSERT INTO item_attribute_options (attribute_id, value, label, sort_order, status, created_at, updated_at)
     VALUES (?, 'A', 'A', 0, 'active', ?, ?)`,
    [attributeId, nowMs, nowMs]
  );
  t.after(async () => {
    await db.execute("DELETE FROM item_attribute_options WHERE attribute_id = ?", [attributeId]);
    await db.execute("DELETE FROM item_attribute_definitions WHERE id = ?", [attributeId]);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const payload = basePayload(catalog, {
    item: { productType: "variant" },
    sku: { variantValues: [{ attributeId, optionId: option.insertId }] }
  });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 400, JSON.stringify(body));
  assert.equal(body.error.code, "ATTRIBUTE_VALUE_INVALID");
});

test("Variant Item：連同 activate:true 一齊建，Item 同全部 SKU 一次過變 active", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const attribute = await seedVariantAttribute(db);
  const created = { itemId: null };
  t.after(async () => {
    await cleanupCreatedItem(db, created.itemId);
    await attribute.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const suffix = randomUUID().slice(0, 8);
  const payload = basePayload(catalog, {
    item: { productType: "variant" },
    activate: true,
    activationReason: "整合測試：Variant 直接上架",
    skus: [
      {
        skuCode: `SKU-RED-${suffix}`,
        skuName: "紅色",
        suggestedPriceAmount: "128.0000",
        uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
        barcodes: [],
        variantValues: [{ attributeId: attribute.attributeId, optionId: attribute.optionIds[0] }]
      },
      {
        skuCode: `SKU-BLUE-${suffix}`,
        skuName: "藍色",
        suggestedPriceAmount: "128.0000",
        uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
        barcodes: [],
        variantValues: [{ attributeId: attribute.attributeId, optionId: attribute.optionIds[1] }]
      }
    ]
  });
  const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

  assert.equal(status, 201, JSON.stringify(body));
  created.itemId = body.data.id;
  assert.equal(body.data.status, "active");
  assert.ok(body.data.skus.every((sku) => sku.status === "active"));
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

test("建立 Item：SKU Code 空白、控制字元或超過 190 字元一律 400 SKU_CODE_INVALID，唔留殘資料", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  t.after(async () => {
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  for (const skuCode of [" \t ", "SKU\u0000CONTROL", "X".repeat(191)]) {
    const payload = basePayload(catalog, { sku: { skuCode } });
    const { status, body } = await post(`${url}/api/v1/items/create`, token, payload);

    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(body.error.code, "SKU_CODE_INVALID");
    const [itemRows] = await db.query("SELECT id FROM items WHERE name = ?", [payload.item.name]);
    assert.equal(itemRows.length, 0, "無效 SKU Code 不可留下 Item");
  }
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

// --- TASK-038：POST /skus/create ------------------------------------------

test("TC-003 既有 Variant Item 可以新增唯一 SKU；審計與 idempotency 同一交易生效", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const attribute = await seedVariantAttribute(db);
  const created = { itemId: null };
  t.after(async () => {
    await cleanupCreatedItem(db, created.itemId);
    await attribute.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const suffix = randomUUID().slice(0, 8);
  const itemPayload = basePayload(catalog, {
    item: { productType: "variant" },
    sku: {
      skuCode: `SKU-RED-${suffix}`,
      skuName: "紅色",
      suggestedPriceAmount: "128.0000",
      uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
      barcodes: [],
      variantValues: [{ attributeId: attribute.attributeId, optionId: attribute.optionIds[0] }]
    }
  });
  const itemResult = await post(`${url}/api/v1/items/create`, token, itemPayload);
  assert.equal(itemResult.status, 201, JSON.stringify(itemResult.body));
  created.itemId = itemResult.body.data.id;

  const skuPayload = {
    itemId: created.itemId,
    skuCode: `SKU-BLUE-${suffix}`,
    skuName: "藍色",
    sellable: true,
    suggestedPriceAmount: "128.0000",
    uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
    barcodes: [],
    variantValues: [{ attributeId: attribute.attributeId, optionId: attribute.optionIds[1] }]
  };
  const key = randomUUID();
  const first = await post(`${url}/api/v1/skus/create`, token, skuPayload, { "Idempotency-Key": key });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.data.skuCode, skuPayload.skuCode);
  assert.equal(first.body.data.status, "draft");

  const second = await post(`${url}/api/v1/skus/create`, token, skuPayload, { "Idempotency-Key": key });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.data.id, first.body.data.id);

  const [[createdSku]] = await db.query(
    "SELECT variant_signature FROM item_skus WHERE id = ? AND item_id = ?",
    [first.body.data.id, created.itemId]
  );
  assert.match(createdSku.variant_signature, /^[0-9a-f]{64}$/);
  const [auditRows] = await db.query(
    "SELECT action FROM item_audit_logs WHERE target_type = 'sku' AND target_id = ?",
    [first.body.data.id]
  );
  assert.deepEqual(auditRows.map((row) => row.action), ["sku.create"]);
});

test("新增既有 Variant SKU 時拒絕空白或控制字元 SKU Code，且不寫入資料", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const attribute = await seedVariantAttribute(db);
  const created = { itemId: null };
  t.after(async () => {
    await cleanupCreatedItem(db, created.itemId);
    await attribute.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const suffix = randomUUID().slice(0, 8);
  const itemResult = await post(
    `${url}/api/v1/items/create`,
    token,
    basePayload(catalog, {
      item: { productType: "variant" },
      sku: {
        skuCode: `SKU-RED-${suffix}`,
        skuName: "紅色",
        suggestedPriceAmount: "128.0000",
        uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
        barcodes: [],
        variantValues: [{ attributeId: attribute.attributeId, optionId: attribute.optionIds[0] }]
      }
    })
  );
  assert.equal(itemResult.status, 201, JSON.stringify(itemResult.body));
  created.itemId = itemResult.body.data.id;

  for (const skuCode of [" \t ", "SKU\u0000CONTROL", "X".repeat(191)]) {
    const result = await post(`${url}/api/v1/skus/create`, token, {
      itemId: created.itemId,
      skuCode,
      skuName: "不合法 SKU",
      variantValues: [{ attributeId: attribute.attributeId, optionId: attribute.optionIds[1] }]
    });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(result.body.error.code, "SKU_CODE_INVALID");
  }

  const blankNameResult = await post(`${url}/api/v1/skus/create`, token, {
    itemId: created.itemId,
    skuCode: `SKU-BLANK-NAME-${suffix}`,
    skuName: " \t ",
    variantValues: [{ attributeId: attribute.attributeId, optionId: attribute.optionIds[1] }]
  });
  assert.equal(blankNameResult.status, 400, JSON.stringify(blankNameResult.body));

  const [skuRows] = await db.query("SELECT id FROM item_skus WHERE item_id = ?", [created.itemId]);
  assert.equal(skuRows.length, 1, "無效 SKU Code 不可留下 SKU 或 audit");
});

test("既有 Variant Item 拒絕重複規格組合，既有 Standard Item 不可新增 SKU", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const attribute = await seedVariantAttribute(db);
  const created = { variantItemId: null, standardItemId: null };
  t.after(async () => {
    await cleanupCreatedItem(db, created.variantItemId);
    await cleanupCreatedItem(db, created.standardItemId);
    await attribute.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const suffix = randomUUID().slice(0, 8);
  const variantResult = await post(
    `${url}/api/v1/items/create`,
    token,
    basePayload(catalog, {
      item: { productType: "variant" },
      sku: {
        skuCode: `SKU-RED-${suffix}`,
        skuName: "紅色",
        suggestedPriceAmount: "128.0000",
        uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
        barcodes: [],
        variantValues: [{ attributeId: attribute.attributeId, optionId: attribute.optionIds[0] }]
      }
    })
  );
  assert.equal(variantResult.status, 201, JSON.stringify(variantResult.body));
  created.variantItemId = variantResult.body.data.id;

  const duplicateResult = await post(`${url}/api/v1/skus/create`, token, {
    itemId: created.variantItemId,
    skuCode: `SKU-DUPLICATE-${suffix}`,
    skuName: "重複紅色",
    sellable: true,
    suggestedPriceAmount: "128.0000",
    uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
    barcodes: [],
    variantValues: [{ attributeId: attribute.attributeId, optionId: attribute.optionIds[0] }]
  });
  assert.equal(duplicateResult.status, 409, JSON.stringify(duplicateResult.body));
  assert.equal(duplicateResult.body.error.code, "VARIANT_COMBINATION_TAKEN");

  const standardResult = await post(`${url}/api/v1/items/create`, token, basePayload(catalog));
  assert.equal(standardResult.status, 201, JSON.stringify(standardResult.body));
  created.standardItemId = standardResult.body.data.id;

  const standardAddResult = await post(`${url}/api/v1/skus/create`, token, {
    itemId: created.standardItemId,
    skuCode: `SKU-STANDARD-EXTRA-${suffix}`,
    skuName: "額外 SKU",
    sellable: true,
    suggestedPriceAmount: "128.0000",
    uoms: [{ uomId: catalog.uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
    barcodes: [],
    variantValues: []
  });
  assert.equal(standardAddResult.status, 409, JSON.stringify(standardAddResult.body));
  assert.equal(standardAddResult.body.error.code, "STANDARD_ITEM_SKU_LIMIT");
});

// --- T32：POST /items/duplicates/check --------------------------------------

test("疑似重複：名稱完全一樣（唔理大小寫）＋同分類同品牌，回返 candidate 連埋 SKU codes", { skip }, async (t) => {
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
  const existingName = `維他命 D 疑似重複測試 ${randomUUID().slice(0, 8)}`;
  const created1 = await post(`${url}/api/v1/items/create`, token, basePayload(catalog, { item: { name: existingName } }));
  assert.equal(created1.status, 201, JSON.stringify(created1.body));
  created.itemId = created1.body.data.id;

  const result = await post(`${url}/api/v1/items/duplicates/check`, token, {
    name: existingName.toUpperCase(),
    categoryId: catalog.categoryId,
    brandId: catalog.brandId
  });

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.candidates.length, 1);
  const [candidate] = result.body.data.candidates;
  assert.equal(candidate.id, created.itemId);
  assert.equal(candidate.name, existingName);
  const [[categoryRow]] = await db.query("SELECT name FROM item_categories WHERE id = ?", [catalog.categoryId]);
  assert.equal(candidate.categoryName, categoryRow.name);
  assert.equal(candidate.skuCount, 1);
  assert.equal(candidate.skuCodes.length, 1);
});

test("疑似重複：名稱唔同就唔會撞", { skip }, async (t) => {
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
  const created1 = await post(`${url}/api/v1/items/create`, token, basePayload(catalog));
  assert.equal(created1.status, 201, JSON.stringify(created1.body));
  created.itemId = created1.body.data.id;

  const result = await post(`${url}/api/v1/items/duplicates/check`, token, {
    name: `完全冇關係嘅名稱 ${randomUUID().slice(0, 8)}`,
    categoryId: catalog.categoryId,
    brandId: catalog.brandId
  });

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.data.candidates, []);
});

test("疑似重複：淨係提供 name，冇 category／brand 都揀得到（唔篩呢兩個）", { skip }, async (t) => {
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
  const existingName = `疑似重複冇篩選測試 ${randomUUID().slice(0, 8)}`;
  const created1 = await post(`${url}/api/v1/items/create`, token, basePayload(catalog, { item: { name: existingName } }));
  assert.equal(created1.status, 201, JSON.stringify(created1.body));
  created.itemId = created1.body.data.id;

  const result = await post(`${url}/api/v1/items/duplicates/check`, token, { name: existingName });

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.candidates.length, 1);
  assert.equal(result.body.data.candidates[0].id, created.itemId);
});

test("疑似重複：唔阻擋建立——確認咗有重複之後仍然可以建立新 Item", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const created = { itemIds: [] };
  t.after(async () => {
    for (const itemId of created.itemIds) {
      await cleanupCreatedItem(db, itemId);
    }
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const sharedName = `疑似重複但仍可以建立 ${randomUUID().slice(0, 8)}`;
  const payload = basePayload(catalog, { item: { name: sharedName } });

  const first = await post(`${url}/api/v1/items/create`, token, payload);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  created.itemIds.push(first.body.data.id);

  const duplicateCheck = await post(`${url}/api/v1/items/duplicates/check`, token, {
    name: sharedName,
    categoryId: catalog.categoryId,
    brandId: catalog.brandId
  });
  assert.equal(duplicateCheck.body.data.candidates.length, 1, "應該已經偵測到第一個 Item 係疑似重複");

  const secondSuffix = randomUUID().slice(0, 10);
  const second = await post(`${url}/api/v1/items/create`, token, {
    ...payload,
    skus: [{ ...payload.skus[0], skuCode: `SKU-${secondSuffix}` }]
  });
  assert.equal(second.status, 201, JSON.stringify(second.body), "疑似重複只係警告，唔應該阻擋合法建立");
  created.itemIds.push(second.body.data.id);
});

test("疑似重複：淨係 item.view 冇 item.mgmt：403", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const viewRole = await seedRole(db, { permissionNames: ["item.view"] });
  const actor = await seedUser(db, { username: `it-item-dup-view-${randomUUID().slice(0, 8)}`, roleId: viewRole.roleId });
  const token = await issueToken(actor.userId, { roles: [viewRole.roleName], permissions: ["item.view"] });
  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await viewRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const result = await post(`${url}/api/v1/items/duplicates/check`, token, { name: "任何名稱" });

  assert.equal(result.status, 403, JSON.stringify(result.body));
});
