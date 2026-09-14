/**
 * T12 的 Item／SKU 唯讀查詢端點，對一個真的、已經 migrate 過的 MySQL 驗收。
 * 設計說明見 docs/items_management/design_spec.md §6.2、§6.3、§8.8。
 *
 * 這裡要的是假連線給不了的東西：JOIN／EXISTS 子查詢的 SQL 本身是不是正確、
 * 一個 Item 有多個符合條件的 SKU 時 total 會不會被撐大、SKU 搜尋的
 * exact／prefix／contains 排序在真資料庫的 ORDER BY 底下是不是真的照那個
 * 順序回來——這些都是「SQL 語法本身對不對」的問題，假連線只能證明「我呼叫
 * 了 database.query()」，證明不了查詢真的做了預期的事。
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

function get(url, token) {
  return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (response) => ({
    status: response.status,
    body: await response.json()
  }));
}

/** 一組完整測試資料：分類、品牌、UOM、Item，回傳建立好嘅 id 同一個
 * cleanup()，跟返 FK 依賴反向刪除。 */
async function seedFixture(db) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);

  const [category] = await db.query(
    "INSERT INTO item_categories (name, created_at, updated_at) VALUES (?, ?, ?)",
    [`it-cat-${suffix}`, nowMs, nowMs]
  );
  const categoryId = category.insertId;

  const [brand] = await db.query(
    "INSERT INTO item_brands (name, created_at, updated_at) VALUES (?, ?, ?)",
    [`it-brand-${suffix}`, nowMs, nowMs]
  );
  const brandId = brand.insertId;

  const [uom] = await db.query(
    "INSERT INTO item_uoms (code, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [`IT${suffix}`, "Integration Test Unit", nowMs, nowMs]
  );
  const uomId = uom.insertId;

  const skuIds = [];
  const itemIds = [];

  return {
    categoryId,
    brandId,
    uomId,
    async seedItem({ name, productType = "standard", status = "draft" } = {}) {
      const [item] = await db.query(
        `INSERT INTO items (name, category_id, brand_id, product_type, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name ?? `it-item-${randomUUID().slice(0, 8)}`, categoryId, brandId, productType, status, nowMs, nowMs]
      );
      itemIds.push(item.insertId);
      return item.insertId;
    },
    async seedSku(itemId, { skuCode, skuName, suggestedPriceAmount = "100.0000", purchasable = 1, sellable = 1, status = "active" } = {}) {
      const [sku] = await db.query(
        `INSERT INTO item_skus
           (item_id, sku_code, sku_name, suggested_price_amount, purchasable, sellable, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemId,
          skuCode ?? `IT-SKU-${randomUUID().slice(0, 8)}`,
          skuName ?? "Integration test SKU",
          suggestedPriceAmount,
          purchasable,
          sellable,
          status,
          nowMs,
          nowMs
        ]
      );
      skuIds.push(sku.insertId);
      return sku.insertId;
    },
    async seedSkuUom(skuId, { isBase = 1, toBaseFactor = 1, isDefaultPurchase = 0, isDefaultSale = 0 } = {}) {
      const [skuUom] = await db.query(
        `INSERT INTO item_sku_uoms
           (sku_id, uom_id, to_base_factor, is_base, is_default_purchase, is_default_sale, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [skuId, uomId, toBaseFactor, isBase, isDefaultPurchase, isDefaultSale, nowMs, nowMs]
      );
      return skuUom.insertId;
    },
    async seedBarcode(skuId, skuUomId, { barcode, isPrimary = 1 } = {}) {
      const code = barcode ?? `IT-BC-${randomUUID().slice(0, 8)}`;
      await db.execute(
        `INSERT INTO item_sku_barcodes
           (sku_id, sku_uom_id, barcode, normalized_barcode, barcode_type, is_primary, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'internal', ?, ?, ?)`,
        [skuId, skuUomId, code, code, isPrimary, nowMs, nowMs]
      );
      return code;
    },
    async cleanup() {
      for (const skuId of skuIds) {
        await db.execute("DELETE FROM item_sku_barcodes WHERE sku_id = ?", [skuId]);
        await db.execute("DELETE FROM item_sku_uoms WHERE sku_id = ?", [skuId]);
      }
      for (const itemId of itemIds) {
        await db.execute("DELETE FROM item_skus WHERE item_id = ?", [itemId]);
        await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
      }
      await db.execute("DELETE FROM item_uoms WHERE id = ?", [uomId]);
      await db.execute("DELETE FROM item_brands WHERE id = ?", [brandId]);
      await db.execute("DELETE FROM item_categories WHERE id = ?", [categoryId]);
    }
  };
}

async function withViewer(t, application) {
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const role = await seedRole(db, { permissionNames: ["item.view"] });
  const actor = await seedUser(db, {
    username: `it-item-read-${randomUUID().slice(0, 8)}`,
    password: "unused-password!",
    roleId: role.roleId
  });
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: ["item.view"] });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await role.cleanup();
  });

  return { db, token };
}

// --- GET /api/v1/items -----------------------------------------------------

test("GET /items：q 搜 Item 名稱及其 SKU 的 Code／名稱／條碼，用 EXISTS 唔會因為一個 Item 有多個符合嘅 SKU 就撞大 total", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withViewer(t, application);
  const fixture = await seedFixture(db);
  t.after(async () => {
    await fixture.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const marker = `it-marker-${randomUUID().slice(0, 8)}`;
  const itemId = await fixture.seedItem({ name: `普通商品 ${marker}`, productType: "variant" });
  // 兩個 SKU 嘅名都夾住同一個 marker——如果用 JOIN 而唔係 EXISTS，呢個 Item
  // 會因為兩個 SKU 都命中而喺結果入面出現兩次，total 都會計多咗。
  const skuA = await fixture.seedSku(itemId, { skuName: `SKU A ${marker}` });
  const skuB = await fixture.seedSku(itemId, { skuName: `SKU B ${marker}` });
  const skuUomA = await fixture.seedSkuUom(skuA);
  const skuUomB = await fixture.seedSkuUom(skuB);
  await fixture.seedBarcode(skuA, skuUomA);
  await fixture.seedBarcode(skuB, skuUomB);

  const { url } = await application.start();
  const { status, body } = await get(`${url}/api/v1/items?q=${encodeURIComponent(marker)}`, token);

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.total, 1, "一個 Item 就算兩個 SKU 都命中都只可以係一個 total");
  assert.equal(body.data.items.length, 1);
  assert.equal(body.data.items[0].id, itemId);
  assert.equal(body.data.items[0].skuCount, 2);
});

test("GET /items：LIKE 萬用字元被跳脫，唔會被當成 % 或 _ 解讀", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withViewer(t, application);
  const fixture = await seedFixture(db);
  t.after(async () => {
    await fixture.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const literalName = `50%off_${randomUUID().slice(0, 6)}`;
  const decoyName = `50Xoff${randomUUID().slice(0, 6)}Y`; // 如果 % 冇跳脫，呢個都會撞中
  await fixture.seedItem({ name: literalName });
  const decoyItemId = await fixture.seedItem({ name: decoyName });
  await fixture.seedSku(decoyItemId);

  const { url } = await application.start();
  const { status, body } = await get(`${url}/api/v1/items?q=${encodeURIComponent(literalName)}`, token);

  assert.equal(status, 200);
  assert.equal(body.data.total, 1, "% 同 _ 應該係字面值，唔應該撞中冇相關嘅 decoy 名");
  assert.equal(body.data.items[0].name, literalName);
});

test("GET /items：分類／品牌／狀態篩選，回應唔洩漏 DB 內部欄位", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withViewer(t, application);
  const fixture = await seedFixture(db);
  t.after(async () => {
    await fixture.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const itemId = await fixture.seedItem({ name: `filter-target-${randomUUID().slice(0, 8)}` });

  const { url } = await application.start();
  const { status, body } = await get(
    `${url}/api/v1/items?categoryId=${fixture.categoryId}&brandId=${fixture.brandId}&status=draft`,
    token
  );

  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(body.data.items.some((row) => row.id === itemId));

  const item = body.data.items.find((row) => row.id === itemId);
  assert.deepEqual(Object.keys(item).sort(), [
    "brandId",
    "brandName",
    "categoryId",
    "categoryName",
    "id",
    "name",
    "productType",
    "shortName",
    "skuCount",
    "status",
    "updatedAt",
    "version"
  ]);
});

test("GET /items 同 /skus：Archived 預設隱藏，明確 status=archived 或 includeArchived=true 先睇得到", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withViewer(t, application);
  const fixture = await seedFixture(db);
  t.after(async () => {
    await fixture.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const marker = `archived-marker-${randomUUID().slice(0, 8)}`;
  const archivedItemId = await fixture.seedItem({ name: marker, status: "archived" });
  const activeItemId = await fixture.seedItem({ name: `active-${marker}` });
  const archivedSkuId = await fixture.seedSku(activeItemId, { skuCode: `ARCH-${marker}`, status: "archived" });
  const activeSkuId = await fixture.seedSku(activeItemId, { skuCode: `ACT-${marker}`, status: "active" });

  const { url } = await application.start();

  const defaultItems = await get(`${url}/api/v1/items?q=${encodeURIComponent(marker)}`, token);
  assert.equal(defaultItems.status, 200);
  assert.ok(!defaultItems.body.data.items.some((row) => row.id === archivedItemId), "預設唔應該見到 archived item");
  assert.ok(defaultItems.body.data.items.some((row) => row.id === activeItemId));

  const explicitArchivedItems = await get(
    `${url}/api/v1/items?q=${encodeURIComponent(marker)}&status=archived`,
    token
  );
  assert.equal(explicitArchivedItems.status, 200);
  assert.deepEqual(
    explicitArchivedItems.body.data.items.map((row) => row.id),
    [archivedItemId],
    "明確要求 status=archived 一定要見到"
  );

  const includeArchivedItems = await get(
    `${url}/api/v1/items?q=${encodeURIComponent(marker)}&includeArchived=true`,
    token
  );
  assert.equal(includeArchivedItems.status, 200);
  assert.equal(includeArchivedItems.body.data.total, 2);

  const defaultSkus = await get(`${url}/api/v1/skus?q=${encodeURIComponent(marker)}`, token);
  assert.equal(defaultSkus.status, 200);
  assert.ok(!defaultSkus.body.data.items.some((row) => row.id === archivedSkuId), "預設唔應該見到 archived SKU");
  assert.ok(defaultSkus.body.data.items.some((row) => row.id === activeSkuId));

  const includeArchivedSkus = await get(
    `${url}/api/v1/skus?q=${encodeURIComponent(marker)}&includeArchived=true`,
    token
  );
  assert.equal(includeArchivedSkus.status, 200);
  assert.equal(includeArchivedSkus.body.data.total, 2);
});

test("GET /items/:id：完整詳情，含全部 SKU 摘要", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withViewer(t, application);
  const fixture = await seedFixture(db);
  t.after(async () => {
    await fixture.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const itemId = await fixture.seedItem({ name: "detail-target", productType: "variant" });
  const skuId = await fixture.seedSku(itemId, { skuCode: `IT-DETAIL-${randomUUID().slice(0, 8)}`, suggestedPriceAmount: "199.9900" });

  const { url } = await application.start();
  const { status, body } = await get(`${url}/api/v1/items/${itemId}`, token);

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.id, itemId);
  assert.equal(body.data.skus.length, 1);
  assert.equal(body.data.skus[0].id, skuId);
  assert.deepEqual(body.data.skus[0].suggestedRetailPrice, {
    amount: "199.9900",
    currency: "HKD",
    taxBasis: "tax_not_applicable"
  });
  assert.deepEqual(body.data.attributeValues, []);
});

test("GET /items/:id 與 /skus/:id：投影已保存的 Attribute／Variant 值", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withViewer(t, application);
  const fixture = await seedFixture(db);
  const nowMs = Date.now();
  const itemId = await fixture.seedItem({ name: "attribute-projection", productType: "variant" });
  const skuId = await fixture.seedSku(itemId, { skuCode: `IT-ATTRIBUTE-${randomUUID().slice(0, 8)}` });

  const [expiryAttribute] = await db.execute(
    `INSERT INTO item_attribute_definitions
       (code, name, data_type, is_variant, status, created_at, updated_at)
     VALUES ('IT_EXPIRY', '到期日', 'date', 0, 'active', ?, ?)`,
    [nowMs, nowMs]
  );
  const [colorAttribute] = await db.execute(
    `INSERT INTO item_attribute_definitions
       (code, name, data_type, is_variant, status, created_at, updated_at)
     VALUES ('IT_COLOR', '顏色', 'single_option', 1, 'active', ?, ?)`,
    [nowMs, nowMs]
  );
  const [materialAttribute] = await db.execute(
    `INSERT INTO item_attribute_definitions
       (code, name, data_type, is_variant, status, created_at, updated_at)
     VALUES ('IT_MATERIAL', '材質', 'text', 0, 'active', ?, ?)`,
    [nowMs, nowMs]
  );
  const [sizeAttribute] = await db.execute(
    `INSERT INTO item_attribute_definitions
       (code, name, data_type, is_variant, status, created_at, updated_at)
     VALUES ('IT_SIZE', '尺寸', 'single_option', 1, 'active', ?, ?)`,
    [nowMs, nowMs]
  );
  const [unrelatedOptionAttribute] = await db.execute(
    `INSERT INTO item_attribute_definitions
       (code, name, data_type, is_variant, status, created_at, updated_at)
     VALUES ('IT_UNRELATED_OPTION', '不相干選項', 'single_option', 0, 'active', ?, ?)`,
    [nowMs, nowMs]
  );
  const [blueOption] = await db.execute(
    `INSERT INTO item_attribute_options
       (attribute_id, value, label, sort_order, status, created_at, updated_at)
     VALUES (?, 'blue', '藍', 0, 'active', ?, ?)`,
    [colorAttribute.insertId, nowMs, nowMs]
  );
  const [largeOption] = await db.execute(
    `INSERT INTO item_attribute_options
       (attribute_id, value, label, sort_order, status, created_at, updated_at)
     VALUES (?, 'large', '大', 0, 'active', ?, ?)`,
    [sizeAttribute.insertId, nowMs, nowMs]
  );
  await db.execute(
    `INSERT INTO item_category_attributes
       (category_id, attribute_id, required_for_activation, sort_order, created_at, updated_at)
     VALUES (?, ?, 0, 20, ?, ?), (?, ?, 0, 10, ?, ?), (?, ?, 0, 5, ?, ?), (?, ?, 0, 1, ?, ?), (?, ?, 0, 0, ?, ?)`,
    [
      fixture.categoryId,
      expiryAttribute.insertId,
      nowMs,
      nowMs,
      fixture.categoryId,
      colorAttribute.insertId,
      nowMs,
      nowMs,
      fixture.categoryId,
      materialAttribute.insertId,
      nowMs,
      nowMs,
      fixture.categoryId,
      sizeAttribute.insertId,
      nowMs,
      nowMs,
      fixture.categoryId,
      unrelatedOptionAttribute.insertId,
      nowMs,
      nowMs
    ]
  );
  await db.execute(
    `INSERT INTO item_attribute_values (item_id, attribute_id, value_date, updated_at)
     VALUES (?, ?, ?, ?)`,
    [itemId, expiryAttribute.insertId, 1800000000000, nowMs]
  );
  await db.execute(
    `INSERT INTO item_attribute_values (item_id, attribute_id, value_text, updated_at)
     VALUES (?, ?, '棉', ?)`,
    [itemId, materialAttribute.insertId, nowMs]
  );
  // MySQL FK 只驗證 option 存在，唔會驗證佢屬於同一 attribute。呢筆故意
  // 壞資料驗證 read projection 唔會洩漏另一個 attribute 的 option。
  await db.execute(
    `INSERT INTO item_attribute_values (item_id, attribute_id, option_id, updated_at)
     VALUES (?, ?, ?, ?)`,
    [itemId, unrelatedOptionAttribute.insertId, blueOption.insertId, nowMs]
  );
  await db.execute(
    `INSERT INTO item_sku_attribute_values (sku_id, attribute_id, option_id, updated_at)
     VALUES (?, ?, ?, ?)`,
    [skuId, colorAttribute.insertId, blueOption.insertId, nowMs]
  );
  await db.execute(
    `INSERT INTO item_sku_attribute_values (sku_id, attribute_id, option_id, updated_at)
     VALUES (?, ?, ?, ?)`,
    [skuId, sizeAttribute.insertId, largeOption.insertId, nowMs]
  );

  t.after(async () => {
    await db.execute("DELETE FROM item_sku_attribute_values WHERE sku_id = ?", [skuId]);
    await db.execute("DELETE FROM item_attribute_values WHERE item_id = ?", [itemId]);
    await db.execute(
      "DELETE FROM item_category_attributes WHERE category_id = ? AND attribute_id IN (?, ?, ?, ?, ?)",
      [fixture.categoryId, expiryAttribute.insertId, colorAttribute.insertId, materialAttribute.insertId, sizeAttribute.insertId, unrelatedOptionAttribute.insertId]
    );
    await db.execute("DELETE FROM item_attribute_definitions WHERE id IN (?, ?, ?, ?, ?)", [
      expiryAttribute.insertId,
      colorAttribute.insertId,
      materialAttribute.insertId,
      sizeAttribute.insertId,
      unrelatedOptionAttribute.insertId
    ]);
    await fixture.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const itemDetail = await get(`${url}/api/v1/items/${itemId}`, token);
  const skuDetail = await get(`${url}/api/v1/skus/${skuId}`, token);

  assert.equal(itemDetail.status, 200, JSON.stringify(itemDetail.body));
  assert.deepEqual(itemDetail.body.data.attributeValues, [
    {
      attributeId: materialAttribute.insertId,
      code: "IT_MATERIAL",
      name: "材質",
      dataType: "text",
      value: "棉",
      option: null
    },
    {
      attributeId: expiryAttribute.insertId,
      code: "IT_EXPIRY",
      name: "到期日",
      dataType: "date",
      value: 1800000000000,
      option: null
    }
  ]);
  assert.equal(skuDetail.status, 200, JSON.stringify(skuDetail.body));
  assert.deepEqual(skuDetail.body.data.variantValues, [
    {
      attributeId: sizeAttribute.insertId,
      code: "IT_SIZE",
      name: "尺寸",
      dataType: "single_option",
      value: "large",
      option: { id: largeOption.insertId, value: "large", label: "大" }
    },
    {
      attributeId: colorAttribute.insertId,
      code: "IT_COLOR",
      name: "顏色",
      dataType: "single_option",
      value: "blue",
      option: { id: blueOption.insertId, value: "blue", label: "藍" }
    }
  ]);
});

test("GET /items/:id：唔存在嘅 id 回 404 ITEM_NOT_FOUND", { skip }, async (t) => {
  const application = await startApplication();
  const { token } = await withViewer(t, application);
  t.after(() => application.shutdown("integration_test_complete"));

  const { url } = await application.start();
  const { status, body } = await get(`${url}/api/v1/items/999999999`, token);

  assert.equal(status, 404);
  assert.equal(body.error.code, "ITEM_NOT_FOUND");
});

// --- GET /api/v1/skus -------------------------------------------------------

test("GET /skus：exact code／barcode 優先於 prefix，prefix 優先於 contains", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withViewer(t, application);
  const fixture = await seedFixture(db);
  t.after(async () => {
    await fixture.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const marker = randomUUID().slice(0, 8);
  const itemId = await fixture.seedItem({ name: `rank-item-${marker}` });

  // Contains：sku_code 唔係以 marker 開頭，但 sku_name 有 marker。
  const containsSkuId = await fixture.seedSku(itemId, {
    skuCode: `ZZZ-${marker}-CONTAINS`,
    skuName: `包含 ${marker} 喺名入面`
  });
  // Prefix：sku_code 以 marker 開頭。
  const prefixSkuId = await fixture.seedSku(itemId, { skuCode: `${marker}-PREFIX`, skuName: "prefix match" });
  // Exact：sku_code 完全等於 marker。
  const exactSkuId = await fixture.seedSku(itemId, { skuCode: marker, skuName: "exact match" });

  const { url } = await application.start();
  const { status, body } = await get(`${url}/api/v1/skus?q=${encodeURIComponent(marker)}`, token);

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.total, 3);
  assert.deepEqual(
    body.data.items.map((row) => row.id),
    [exactSkuId, prefixSkuId, containsSkuId],
    "exact 排第一、prefix 第二、contains 排最後"
  );
});

test("GET /skus：exact barcode 命中都排第一", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withViewer(t, application);
  const fixture = await seedFixture(db);
  t.after(async () => {
    await fixture.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const marker = randomUUID().slice(0, 8);
  const itemId = await fixture.seedItem({ name: `barcode-rank-${marker}` });

  const containsSkuId = await fixture.seedSku(itemId, { skuCode: `ZZZ-${marker}` });
  const barcodeSkuId = await fixture.seedSku(itemId, { skuCode: `unrelated-${randomUUID().slice(0, 6)}` });
  const barcodeSkuUomId = await fixture.seedSkuUom(barcodeSkuId);
  await fixture.seedBarcode(barcodeSkuId, barcodeSkuUomId, { barcode: marker });

  const { url } = await application.start();
  const { status, body } = await get(`${url}/api/v1/skus?q=${encodeURIComponent(marker)}`, token);

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.total, 2);
  assert.equal(body.data.items[0].id, barcodeSkuId, "條碼完全相符要排第一");
  assert.equal(body.data.items[1].id, containsSkuId);
});

test("GET /skus：itemId／status／purchasable／sellable 篩選", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withViewer(t, application);
  const fixture = await seedFixture(db);
  t.after(async () => {
    await fixture.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const itemId = await fixture.seedItem();
  const purchasableSkuId = await fixture.seedSku(itemId, { purchasable: 1, sellable: 0 });
  await fixture.seedSku(itemId, { purchasable: 0, sellable: 1 });

  const { url } = await application.start();
  const { status, body } = await get(
    `${url}/api/v1/skus?itemId=${itemId}&purchasable=true&sellable=false`,
    token
  );

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.total, 1);
  assert.equal(body.data.items[0].id, purchasableSkuId);
});

test("GET /skus/:id：完整詳情，含 Item 摘要、UOM、條碼與價格口徑", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withViewer(t, application);
  const fixture = await seedFixture(db);
  t.after(async () => {
    await fixture.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const itemId = await fixture.seedItem({ name: "sku-detail-item" });
  const skuId = await fixture.seedSku(itemId, { suggestedPriceAmount: "50.0000" });
  const skuUomId = await fixture.seedSkuUom(skuId, { isBase: 1, toBaseFactor: 1 });
  await fixture.seedBarcode(skuId, skuUomId, { isPrimary: 1 });

  const { url } = await application.start();
  const { status, body } = await get(`${url}/api/v1/skus/${skuId}`, token);

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.id, skuId);
  assert.equal(body.data.item.id, itemId);
  assert.equal(body.data.item.name, "sku-detail-item");
  assert.equal(body.data.uoms.length, 1);
  assert.equal(body.data.uoms[0].id, skuUomId);
  assert.equal(body.data.uoms[0].isBase, true);
  assert.equal(body.data.barcodes.length, 1);
  assert.equal(body.data.barcodes[0].isPrimary, true);
  assert.deepEqual(body.data.suggestedRetailPrice, {
    amount: "50.0000",
    currency: "HKD",
    taxBasis: "tax_not_applicable"
  });
  assert.deepEqual(body.data.variantValues, []);
  assert.deepEqual(body.data.media, []);
});

test("GET /skus/:id：唔存在嘅 id 回 404 SKU_NOT_FOUND", { skip }, async (t) => {
  const application = await startApplication();
  const { token } = await withViewer(t, application);
  t.after(() => application.shutdown("integration_test_complete"));

  const { url } = await application.start();
  const { status, body } = await get(`${url}/api/v1/skus/999999999`, token);

  assert.equal(status, 404);
  assert.equal(body.error.code, "SKU_NOT_FOUND");
});

// --- 權限矩陣（Item／SKU 讀 API 共用同一組規則） ---------------------------

test("未登入、只有 item.mgmt 冇 item.view、stale permission：Item／SKU 讀 API 一律符合 401／403 規則", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);

  const mgmtRole = await seedRole(db, { permissionNames: ["item.mgmt"] });
  const mgmtActor = await seedUser(db, {
    username: `it-item-read-mgmt-${randomUUID().slice(0, 8)}`,
    password: "unused-password!",
    roleId: mgmtRole.roleId
  });
  const viewRole = await seedRole(db, { permissionNames: ["item.view"] });
  const staleActor = await seedUser(db, {
    username: `it-item-read-stale-${randomUUID().slice(0, 8)}`,
    password: "unused-password!",
    roleId: viewRole.roleId
  });

  t.after(async () => {
    await cleanupUser(db, mgmtActor.userId);
    await mgmtRole.cleanup();
    await cleanupUser(db, staleActor.userId);
    await viewRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const mgmtToken = await issueToken(mgmtActor.userId, { roles: [mgmtRole.roleName], permissions: ["item.mgmt"] });
  // Claims 宣稱多過資料庫現況（多咗 item.mgmt），滿足 authorizationPolicies
  // 嘅靜態檢查（要有 item.view）之後，先喺 service 入面撞 PERMISSION_STALE。
  const staleToken = await issueToken(staleActor.userId, {
    roles: [viewRole.roleName],
    permissions: ["item.view", "item.mgmt"]
  });

  for (const path of ["/api/v1/items", "/api/v1/skus"]) {
    const anonymous = await get(`${url}${path}`, null);
    assert.equal(anonymous.status, 401, path);

    const mgmtOnly = await get(`${url}${path}`, mgmtToken);
    assert.equal(mgmtOnly.status, 403, path);

    const stale = await get(`${url}${path}`, staleToken);
    assert.equal(stale.status, 403, path);
    assert.equal(stale.body.error.code, "PERMISSION_STALE", path);
  }
});
