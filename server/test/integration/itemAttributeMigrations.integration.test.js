/**
 * T23 嘅 5 張 Attribute／Variant 表（`0018`–`0022`），對一個真的、已經
 * migrate 過的 MySQL 驗證 schema 本身：unique key、FK CASCADE／RESTRICT
 * 呢啲行為淨係真 DB 先驗得到，假連線頂唔到。設計說明見
 * docs/items_management/design_spec.md §5.10。
 *
 * 呢個檔案直接打 SQL，唔經 HTTP／service——想驗嘅係 migration 本身寫啱行為，
 * 唔係 service 層邏輯（嗰啲已經由 itemCreate.integration.test.js 嘅 Variant
 * 案例覆蓋）。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";

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

/** `MySqlDatabaseService` 將真正嘅 mysql2 錯誤包咗做 `.cause`（見
 * `MySqlDatabaseService.js`：`throw new MySqlDatabaseOperationError(...,
 * { cause: error })`），外層嘅 `.message`／`.code` 淨係得返一個泛用嘅
 * "MySQL database execute failed" 同 "DATABASE_OPERATION_FAILED"——要斷言
 * 真正嘅 MySQL error code（`ER_DUP_ENTRY`／`ER_ROW_IS_REFERENCED_2`）一定
 * 要睇 `.cause.code`，唔可以直接用 regex 撞 `.message`。 */
function rejectsWithMysqlCode(promiseFactory, expectedCode) {
  return assert.rejects(promiseFactory, (error) => {
    const actualCode = error?.cause?.code ?? error?.code;
    assert.equal(actualCode, expectedCode, `expected MySQL error code ${expectedCode}, got ${actualCode}`);
    return true;
  });
}

async function seedCatalog(db) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const [category] = await db.query(
    "INSERT INTO item_categories (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    [`it-cat-${suffix}`, nowMs, nowMs]
  );
  const [uom] = await db.query(
    "INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    [`ITAM${suffix}`, "Integration Test Unit", nowMs, nowMs]
  );
  return {
    categoryId: category.insertId,
    uomId: uom.insertId,
    async cleanup() {
      await db.execute("DELETE FROM item_uoms WHERE id = ?", [uom.insertId]);
      await db.execute("DELETE FROM item_categories WHERE id = ?", [category.insertId]);
    }
  };
}

async function seedAttribute(db, { dataType = "single_option", isVariant = 1, uomId = null } = {}) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const [attribute] = await db.query(
    `INSERT INTO item_attribute_definitions
       (code, name, data_type, uom_id, is_variant, is_filterable, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?)`,
    [`it-attr-${suffix}`, `Integration Test Attribute ${suffix}`, dataType, uomId, isVariant, nowMs, nowMs]
  );
  return attribute.insertId;
}

async function seedOption(db, attributeId, { value = "A" } = {}) {
  const nowMs = Date.now();
  const [option] = await db.query(
    `INSERT INTO item_attribute_options (attribute_id, value, label, sort_order, status, created_at, updated_at)
     VALUES (?, ?, ?, 0, 'active', ?, ?)`,
    [attributeId, value, value, nowMs, nowMs]
  );
  return option.insertId;
}

// --- item_attribute_definitions ----------------------------------------------

test("item_attribute_definitions：code 全域唯一", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const code = `it-dup-code-${randomUUID().slice(0, 8)}`;
  let attributeId = null;
  t.after(async () => {
    if (attributeId) await db.execute("DELETE FROM item_attribute_definitions WHERE id = ?", [attributeId]);
    await application.shutdown("integration_test_complete");
  });

  const nowMs = Date.now();
  const [first] = await db.query(
    `INSERT INTO item_attribute_definitions (code, name, data_type, is_variant, is_filterable, status, created_at, updated_at)
     VALUES (?, 'First', 'text', 0, 0, 'active', ?, ?)`,
    [code, nowMs, nowMs]
  );
  attributeId = first.insertId;

  await rejectsWithMysqlCode(
    () =>
      db.query(
        `INSERT INTO item_attribute_definitions (code, name, data_type, is_variant, is_filterable, status, created_at, updated_at)
         VALUES (?, 'Second', 'text', 0, 0, 'active', ?, ?)`,
        [code, nowMs, nowMs]
      ),
    "ER_DUP_ENTRY"
  );
});

test("item_attribute_definitions.uom_id：RESTRICT，UOM 仲被屬性引用就刪唔到", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const attributeId = await seedAttribute(db, { dataType: "decimal", isVariant: 0, uomId: catalog.uomId });
  t.after(async () => {
    await db.execute("DELETE FROM item_attribute_definitions WHERE id = ?", [attributeId]);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  await rejectsWithMysqlCode(() => db.execute("DELETE FROM item_uoms WHERE id = ?", [catalog.uomId]), "ER_ROW_IS_REFERENCED_2");
});

// --- item_attribute_options ---------------------------------------------------

test("item_attribute_options：同一屬性底下 value 唯一，唔同屬性可以撞返同一個 value", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const attributeId = await seedAttribute(db);
  t.after(async () => {
    await db.execute("DELETE FROM item_attribute_options WHERE attribute_id = ?", [attributeId]);
    await db.execute("DELETE FROM item_attribute_definitions WHERE id = ?", [attributeId]);
    await application.shutdown("integration_test_complete");
  });

  await seedOption(db, attributeId, { value: "紅" });
  await rejectsWithMysqlCode(() => seedOption(db, attributeId, { value: "紅" }), "ER_DUP_ENTRY");
});

test("item_attribute_options：CASCADE，刪屬性連埋佢啲 option 一齊冇", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const attributeId = await seedAttribute(db);
  const optionId = await seedOption(db, attributeId);
  t.after(async () => application.shutdown("integration_test_complete"));

  await db.execute("DELETE FROM item_attribute_definitions WHERE id = ?", [attributeId]);

  const [[remaining]] = await db.query("SELECT COUNT(*) AS c FROM item_attribute_options WHERE id = ?", [optionId]);
  assert.equal(remaining.c, 0);
});

// --- item_category_attributes -------------------------------------------------

test("item_category_attributes：category_id CASCADE，attribute_id RESTRICT", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const attributeId = await seedAttribute(db, { dataType: "text", isVariant: 0 });
  const nowMs = Date.now();
  t.after(async () => {
    await db.execute("DELETE FROM item_category_attributes WHERE attribute_id = ?", [attributeId]);
    await db.execute("DELETE FROM item_attribute_definitions WHERE id = ?", [attributeId]);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  await db.execute(
    `INSERT INTO item_category_attributes (category_id, attribute_id, required_for_activation, sort_order, created_at, updated_at)
     VALUES (?, ?, 1, 0, ?, ?)`,
    [catalog.categoryId, attributeId, nowMs, nowMs]
  );

  // attribute_id RESTRICT：分類仲用緊呢個屬性就唔可以刪屬性本身。
  await rejectsWithMysqlCode(
    () => db.execute("DELETE FROM item_attribute_definitions WHERE id = ?", [attributeId]),
    "ER_ROW_IS_REFERENCED_2"
  );

  // category_id CASCADE：刪分類，呢條 mapping 跟住冇埋。
  await db.execute("DELETE FROM item_categories WHERE id = ?", [catalog.categoryId]);
  const [[remaining]] = await db.query(
    "SELECT COUNT(*) AS c FROM item_category_attributes WHERE attribute_id = ?",
    [attributeId]
  );
  assert.equal(remaining.c, 0);

  // Category 冇咗之後，呢個 fixture 嘅 catalog.cleanup() 會再刪一次
  // category——冇問題，DELETE 對唔存在嘅 id 係 no-op。
});

// --- item_attribute_values（Item 層級） ----------------------------------------

test("item_attribute_values：CASCADE 跟 Item，RESTRICT 跟屬性／選項；composite PK 擋同一個 Item 對同一屬性寫兩行", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const attributeId = await seedAttribute(db, { dataType: "text", isVariant: 0 });
  const nowMs = Date.now();
  const [item] = await db.query(
    `INSERT INTO items (name, category_id, product_type, status, version, created_at, updated_at)
     VALUES (?, ?, 'standard', 'draft', 1, ?, ?)`,
    [`it-item-${randomUUID().slice(0, 8)}`, catalog.categoryId, nowMs, nowMs]
  );
  const itemId = item.insertId;
  t.after(async () => {
    await db.execute("DELETE FROM item_attribute_values WHERE attribute_id = ?", [attributeId]);
    await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
    await db.execute("DELETE FROM item_attribute_definitions WHERE id = ?", [attributeId]);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  await db.execute(
    `INSERT INTO item_attribute_values (item_id, attribute_id, value_text, updated_at)
     VALUES (?, ?, '成分說明', ?)`,
    [itemId, attributeId, nowMs]
  );

  // Composite PK (item_id, attribute_id)：同一個 Item 對同一個屬性唔可以有第二行。
  await rejectsWithMysqlCode(
    () =>
      db.execute(`INSERT INTO item_attribute_values (item_id, attribute_id, value_text, updated_at) VALUES (?, ?, '第二次', ?)`, [
        itemId,
        attributeId,
        nowMs
      ]),
    "ER_DUP_ENTRY"
  );

  // RESTRICT：屬性仲有值就刪唔到。
  await rejectsWithMysqlCode(
    () => db.execute("DELETE FROM item_attribute_definitions WHERE id = ?", [attributeId]),
    "ER_ROW_IS_REFERENCED_2"
  );

  // CASCADE：刪 Item，佢嘅屬性值一齊冇。
  await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
  const [[remaining]] = await db.query("SELECT COUNT(*) AS c FROM item_attribute_values WHERE item_id = ?", [itemId]);
  assert.equal(remaining.c, 0);
});

// --- item_sku_attribute_values（SKU 層級） -------------------------------------

test("item_sku_attribute_values：CASCADE 跟 SKU，RESTRICT 跟屬性／選項；composite PK 擋同一個 SKU 對同一屬性寫兩行", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const attributeId = await seedAttribute(db);
  const optionId = await seedOption(db, attributeId, { value: "紅" });
  const nowMs = Date.now();
  const [item] = await db.query(
    `INSERT INTO items (name, category_id, product_type, status, version, created_at, updated_at)
     VALUES (?, ?, 'variant', 'draft', 1, ?, ?)`,
    [`it-item-${randomUUID().slice(0, 8)}`, catalog.categoryId, nowMs, nowMs]
  );
  const itemId = item.insertId;
  const [sku] = await db.query(
    `INSERT INTO item_skus (item_id, sku_code, sku_name, variant_signature, status, version, created_at, updated_at)
     VALUES (?, ?, 'SKU', 'deadbeef', 'draft', 1, ?, ?)`,
    [itemId, `IT-SKU-${randomUUID().slice(0, 8)}`, nowMs, nowMs]
  );
  const skuId = sku.insertId;
  t.after(async () => {
    await db.execute("DELETE FROM item_sku_attribute_values WHERE attribute_id = ?", [attributeId]);
    await db.execute("DELETE FROM item_skus WHERE item_id = ?", [itemId]);
    await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
    await db.execute("DELETE FROM item_attribute_options WHERE attribute_id = ?", [attributeId]);
    await db.execute("DELETE FROM item_attribute_definitions WHERE id = ?", [attributeId]);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  await db.execute(
    `INSERT INTO item_sku_attribute_values (sku_id, attribute_id, option_id, updated_at) VALUES (?, ?, ?, ?)`,
    [skuId, attributeId, optionId, nowMs]
  );

  await rejectsWithMysqlCode(
    () =>
      db.execute(`INSERT INTO item_sku_attribute_values (sku_id, attribute_id, option_id, updated_at) VALUES (?, ?, ?, ?)`, [
        skuId,
        attributeId,
        optionId,
        nowMs
      ]),
    "ER_DUP_ENTRY"
  );

  // RESTRICT：option 仲被 SKU 值引用就刪唔到。
  await rejectsWithMysqlCode(
    () => db.execute("DELETE FROM item_attribute_options WHERE id = ?", [optionId]),
    "ER_ROW_IS_REFERENCED_2"
  );

  // CASCADE：刪 SKU，佢嘅屬性值一齊冇。
  await db.execute("DELETE FROM item_skus WHERE id = ?", [skuId]);
  const [[remaining]] = await db.query("SELECT COUNT(*) AS c FROM item_sku_attribute_values WHERE sku_id = ?", [skuId]);
  assert.equal(remaining.c, 0);
});
