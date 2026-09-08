/**
 * T21 嘅 `ItemLookupService`，對一個真的、已經 migrate 過的 MySQL 驗收。設計
 * 說明見 docs/items_management/design_spec.md §8.3。
 *
 * 呢度要驗嘅係假 database 頂唔到嘅嘢：真正嘅 JOIN（item_skus／items／
 * item_sku_uoms／item_sku_barcodes）冇打錯欄位、`normalized_barcode` 嘅
 * UNIQUE key 真係防到重複、`findManyByIds()` 批量查詢冇將唔同 SKU 嘅 UOM
 * 冚埋一齊。Purpose 規則本身（純邏輯，唔靠 DB）已經喺
 * test/itemLookupService.test.js 用假 database 覆蓋晒。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { ItemLookupService } from "../../src/modules/item/ItemLookupService.js";

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

function lookupService(application) {
  return new ItemLookupService({
    database: application.services.require("mysqldatabase"),
    logger: application.services.require("logging").logger,
    time: application.services.require("time")
  });
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
  const [uomA] = await db.query(
    "INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    [`ITLA${suffix}`, "Integration Test Unit A", nowMs, nowMs]
  );
  const [uomB] = await db.query(
    "INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    [`ITLB${suffix}`, "Integration Test Unit B", nowMs, nowMs]
  );

  return {
    categoryId: category.insertId,
    brandId: brand.insertId,
    uomIdA: uomA.insertId,
    uomIdB: uomB.insertId,
    async cleanup() {
      await db.execute("DELETE FROM item_uoms WHERE id IN (?, ?)", [uomA.insertId, uomB.insertId]);
      await db.execute("DELETE FROM item_brands WHERE id = ?", [brand.insertId]);
      await db.execute("DELETE FROM item_categories WHERE id = ?", [category.insertId]);
    }
  };
}

/** 一個 Item 連一粒完整 SKU（Base＋一個非 Base UOM），跳過 create API。 */
async function seedItemWithSku(db, catalog, { itemStatus = "active", skuStatus = "active", overrides = {} } = {}) {
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
        suggested_price_amount, effective_from, effective_to, status, created_at, updated_at)
     VALUES (?, ?, ?, 'none', ?, ?, ?, '100.0000', ?, ?, ?, ?, ?)`,
    [
      itemId,
      `IT-SKU-${suffix}`,
      "Integration test SKU",
      overrides.purchasable ?? 1,
      overrides.sellable ?? 1,
      overrides.inventoryTracked ?? 1,
      overrides.effectiveFrom ?? null,
      overrides.effectiveTo ?? null,
      skuStatus,
      nowMs,
      nowMs
    ]
  );
  const skuId = sku.insertId;

  const [skuUomA] = await db.query(
    `INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, is_default_sale, created_at, updated_at)
     VALUES (?, ?, 1, 1, 1, ?, ?)`,
    [skuId, catalog.uomIdA, nowMs, nowMs]
  );
  await db.query(
    `INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_default_purchase, created_at, updated_at)
     VALUES (?, ?, 12, 1, ?, ?)`,
    [skuId, catalog.uomIdB, nowMs, nowMs]
  );

  return {
    itemId,
    skuId,
    skuCode: `IT-SKU-${suffix}`,
    skuUomIdA: skuUomA.insertId,
    async cleanup() {
      await db.execute("DELETE FROM item_sku_barcodes WHERE sku_id = ?", [skuId]);
      await db.execute("DELETE FROM item_sku_uoms WHERE sku_id = ?", [skuId]);
      await db.execute("DELETE FROM item_skus WHERE id = ?", [skuId]);
      await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
    }
  };
}

async function seedBarcode(db, { skuId, skuUomId, barcode }) {
  const nowMs = Date.now();
  const [row] = await db.query(
    `INSERT INTO item_sku_barcodes
       (sku_id, sku_uom_id, barcode, normalized_barcode, barcode_type, is_primary, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'internal', 1, ?, ?)`,
    [skuId, skuUomId, barcode, barcode, nowMs, nowMs]
  );
  return row.insertId;
}

test("findById：真 JOIN 返正確嘅 Item／SKU／UOM 資料", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const result = await lookupService(application).findById(fixture.skuId);

  assert.equal(result.skuId, fixture.skuId);
  assert.equal(result.skuCode, fixture.skuCode);
  assert.equal(result.itemId, fixture.itemId);
  assert.equal(result.uoms.length, 2);
  const base = result.uoms.find((uom) => uom.isBase);
  assert.equal(base.uomId, catalog.uomIdA);
  assert.equal(base.toBaseFactor, 1);
});

test("findByCode：用真嘅 sku_code 查", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const result = await lookupService(application).findByCode(fixture.skuCode);

  assert.equal(result.skuId, fixture.skuId);
});

test("findByCode：搵唔到就回 null", { skip }, async (t) => {
  const application = await startApplication();
  t.after(async () => application.shutdown("integration_test_complete"));

  const result = await lookupService(application).findByCode("NO-SUCH-CODE");

  assert.equal(result, null);
});

test("findByBarcode：真 JOIN 去 item_sku_barcodes，搵到啱嘅 SKU", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog);
  const barcode = `4710088${randomUUID().slice(0, 6)}`;
  await seedBarcode(db, { skuId: fixture.skuId, skuUomId: fixture.skuUomIdA, barcode });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const result = await lookupService(application).findByBarcode(barcode);

  assert.equal(result.skuId, fixture.skuId);
});

test("findByBarcode：搵唔到就回 null", { skip }, async (t) => {
  const application = await startApplication();
  t.after(async () => application.shutdown("integration_test_complete"));

  const result = await lookupService(application).findByBarcode("NO-SUCH-BARCODE");

  assert.equal(result, null);
});

test("findManyByIds：跨兩個唔同 Item 嘅 SKU，UOM 冇冚埋一齊", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const fixtureA = await seedItemWithSku(db, catalog);
  const fixtureB = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixtureA.cleanup();
    await fixtureB.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const result = await lookupService(application).findManyByIds([fixtureA.skuId, fixtureB.skuId, 999999999]);

  assert.equal(result.size, 2);
  assert.equal(result.get(fixtureA.skuId).skuCode, fixtureA.skuCode);
  assert.equal(result.get(fixtureB.skuId).skuCode, fixtureB.skuCode);
  assert.equal(result.get(fixtureA.skuId).uoms.length, 2);
  assert.equal(result.get(fixtureB.skuId).uoms.length, 2);
  assert.equal(result.has(999999999), false);
});

test("purchase：真數據——Active＋purchasable＋喺效期內先 usable，Discontinued 就唔得", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const active = await seedItemWithSku(db, catalog, { itemStatus: "active", skuStatus: "active" });
  const discontinued = await seedItemWithSku(db, catalog, {
    itemStatus: "discontinued",
    skuStatus: "discontinued",
    overrides: { purchasable: 0 }
  });
  t.after(async () => {
    await active.cleanup();
    await discontinued.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const service = lookupService(application);
  const activeResult = await service.findById(active.skuId, { purpose: "purchase" });
  const discontinuedResult = await service.findById(discontinued.skuId, { purpose: "purchase" });

  assert.equal(activeResult.usable, true);
  assert.equal(discontinuedResult.usable, false);
  assert.ok(discontinuedResult.reasons.includes("STATUS_NOT_ACTIVE"));
  assert.ok(discontinuedResult.reasons.includes("NOT_PURCHASABLE"));
});

test("sale：真數據——Discontinued SKU 清貨仍然 usable", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog, { itemStatus: "active", skuStatus: "discontinued" });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const result = await lookupService(application).findById(fixture.skuId, { purpose: "sale" });

  assert.equal(result.usable, true);
});

test("inventory：真數據——Inactive 預設唔 usable，帶 includeInactive 先通過；Archived 點都唔得", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const inactive = await seedItemWithSku(db, catalog, { itemStatus: "inactive", skuStatus: "inactive" });
  const archived = await seedItemWithSku(db, catalog, { itemStatus: "archived", skuStatus: "archived" });
  t.after(async () => {
    await inactive.cleanup();
    await archived.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const service = lookupService(application);
  const inactiveDefault = await service.findById(inactive.skuId, { purpose: "inventory" });
  const inactiveIncluded = await service.findById(inactive.skuId, { purpose: "inventory", includeInactive: true });
  const archivedIncluded = await service.findById(archived.skuId, { purpose: "inventory", includeInactive: true });

  assert.equal(inactiveDefault.usable, false);
  assert.equal(inactiveIncluded.usable, true);
  assert.equal(archivedIncluded.usable, false);
  assert.ok(archivedIncluded.reasons.includes("ARCHIVED"));
});

test("assertUsable：真數據——SKU_NOT_FOUND 同 SKU_NOT_USABLE 兩種錯都拋得啱", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog, { itemStatus: "draft", skuStatus: "draft" });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const service = lookupService(application);

  await assert.rejects(() => service.assertUsable(999999999, { purpose: "purchase" }), { code: "SKU_NOT_FOUND" });
  await assert.rejects(() => service.assertUsable(fixture.skuId, { purpose: "purchase" }), {
    code: "SKU_NOT_USABLE"
  });
});

test("item_sku_barcodes 嘅 UNIQUE key 真係防到兩個 SKU 用同一個正規化條碼", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const fixtureA = await seedItemWithSku(db, catalog);
  const fixtureB = await seedItemWithSku(db, catalog);
  const barcode = `IT-BC-UNIQUE-${randomUUID().slice(0, 8)}`;
  await seedBarcode(db, { skuId: fixtureA.skuId, skuUomId: fixtureA.skuUomIdA, barcode });
  t.after(async () => {
    await fixtureA.cleanup();
    await fixtureB.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  await assert.rejects(() => seedBarcode(db, { skuId: fixtureB.skuId, skuUomId: fixtureB.skuUomIdA, barcode }));

  const result = await lookupService(application).findByBarcode(barcode);
  assert.equal(result.skuId, fixtureA.skuId, "重複插入失敗之後，原本嗰粒 SKU 依然係唯一嘅結果");
});
