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

test("TC-017 purchase metadata returns actual association IDs and catalogue states without changing generic lookup", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixture.cleanup(); await catalog.cleanup(); await application.shutdown("purchase_metadata_complete");
  });
  await db.execute("UPDATE item_uoms SET status = 'inactive' WHERE id = ?", [catalog.uomIdB]);
  const service = lookupService(application);
  const [[mapping]] = await db.query("SELECT id FROM item_sku_uoms WHERE sku_id = ? AND uom_id = ?", [fixture.skuId, catalog.uomIdB]);
  const barcode = "purchase-metadata-" + randomUUID();
  await seedBarcode(db, { skuId: fixture.skuId, skuUomId: fixture.skuUomIdA, barcode });
  for (const read of [
    () => service.findById(fixture.skuId, { purpose: "purchase" }),
    () => service.findByCode(fixture.skuCode, { purpose: "purchase" }),
    () => service.findByBarcode(barcode, { purpose: "purchase" }),
    async () => (await service.findManyByIds([fixture.skuId], { purpose: "purchase" })).get(fixture.skuId)
  ]) {
    const result = await read();
    const box = result.uoms.find(uom => uom.uomId === catalog.uomIdB);
    assert.equal(box.skuUomId, Number(mapping.id));
    assert.equal(box.uomName, "Integration Test Unit B");
    assert.equal(box.status, "inactive");
    assert.equal(box.toBaseFactor, 12);
    assert.equal(box.isDefaultPurchase, true);
    assert.equal(result.uoms.length, 2);
    assert.equal(result.usable, true);
  }
  const before = await service.findById(fixture.skuId);
  assert.equal("skuUomId" in before.uoms[0], false);
  assert.equal("status" in before.uoms[0], false);
  await db.execute("UPDATE item_sku_uoms SET to_base_factor = 24 WHERE id = ?", [mapping.id]);
  assert.equal((await service.findById(fixture.skuId, { purpose: "purchase" })).uoms.find(uom => uom.uomId === catalog.uomIdB).skuUomId, Number(mapping.id));
});

test("TC-018 actual MySQL purchase search covers statuses, inclusive dates, active-UOM gating, literal prefixes and paging", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db), inactiveCatalog = await seedCatalog(db);
  const fixtures = [];
  t.after(async () => {
    for (const fixture of fixtures.reverse()) await fixture.cleanup();
    await inactiveCatalog.cleanup(); await catalog.cleanup(); await application.shutdown("purchase_search_complete");
  });
  const now = Date.now(), prefix = "PUR-" + randomUUID().slice(0, 8) + "-";
  const add = async (code, options = {}, selectedCatalog = catalog) => {
    const fixture = await seedItemWithSku(db, selectedCatalog, options);
    fixtures.push(fixture);
    await db.execute("UPDATE item_skus SET sku_code = ?, sku_name = ? WHERE id = ?", [prefix + code, prefix + "name-" + code, fixture.skuId]);
    await db.execute("UPDATE items SET name = ? WHERE id = ?", [prefix + "item-" + code, fixture.itemId]);
    return fixture;
  };
  const regular = await add("01");
  const boundary = await add("02", { overrides: { effectiveFrom: now, effectiveTo: now } });
  const serial = await add("03", { overrides: { sellable: 0 } });
  await db.execute("UPDATE item_skus SET tracking_policy = 'serial' WHERE id = ?", [serial.skuId]);
  await add("future", { overrides: { effectiveFrom: now + 1 } });
  await add("expired", { overrides: { effectiveTo: now - 1 } });
  await add("not-purchasable", { overrides: { purchasable: 0 } });
  for (const status of ["draft", "inactive", "discontinued", "archived"]) {
    await add("item-" + status, { itemStatus: status });
    await add("sku-" + status, { skuStatus: status });
  }
  const allInactive = await add("all-inactive", {}, inactiveCatalog);
  await db.execute("UPDATE item_uoms SET status = 'inactive' WHERE id IN (?, ?)", [catalog.uomIdB, inactiveCatalog.uomIdA]);
  await db.execute("UPDATE item_uoms SET status = 'archived' WHERE id = ?", [inactiveCatalog.uomIdB]);
  const literal = await add("literal_%!A");
  const decoy = await add("literalXA");
  let calls = 0;
  const service = new ItemLookupService({
    database: { query: (...args) => { calls++; return db.query(...args); } },
    logger: application.services.require("logging").logger,
    time: { nowMs: () => now }
  });
  const expected = [regular.skuId, boundary.skuId, serial.skuId, literal.skuId, decoy.skuId];
  const first = await service.searchForPurchase({ q: prefix, pageSize: 2 });
  assert.equal(calls, 3);
  assert.equal(first.total, expected.length);
  assert.deepEqual(first.items.map(row => row.skuId), expected.slice(0, 2));
  assert.deepEqual(first.items[0].uoms.map(uom => uom.status).sort(), ["active", "inactive"]);
  const second = await service.searchForPurchase({ q: prefix, page: 2, pageSize: 2 });
  const third = await service.searchForPurchase({ q: prefix, page: 3, pageSize: 2 });
  assert.deepEqual([...first.items, ...second.items, ...third.items].map(row => row.skuId), expected);
  const missing = await service.searchForPurchase({ q: prefix, page: 4, pageSize: 2 });
  assert.equal(missing.total, expected.length);
  assert.deepEqual(missing.items, []);
  assert.equal((await service.searchForPurchase({ q: prefix + "name-03" })).items[0].skuId, serial.skuId);
  assert.equal((await service.searchForPurchase({ q: prefix + "item-01" })).items[0].skuId, regular.skuId);
  assert.deepEqual((await service.searchForPurchase({ q: "  " + prefix + "literal_%!  " })).items.map(row => row.skuId), [literal.skuId]);
  assert.equal((await service.findById(allInactive.skuId, { purpose: "purchase" })).usable, true, "active UOM is search-only");
  assert.deepEqual((await service.searchForPurchase({ q: prefix + "all-inactive" })).items, []);
  assert.deepEqual((await service.searchForPurchase({ q: prefix + "no-such" })), { items: [], total: 0, page: 1, pageSize: 20 });
});

test("Sales named lookup and caller snapshots preserve mapping identity and hold current SHARE locks", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog);
  t.after(async () => {
    await fixture.cleanup(); await catalog.cleanup(); await application.shutdown("sales_item_snapshot_complete");
  });
  const service = lookupService(application);
  assert.equal((await service.findManyForSale([fixture.skuId])).get(fixture.skuId).suggestedPrice.amount, "100.0000");
  assert.equal((await service.findSaleUom(fixture.skuId, fixture.skuUomIdA)).uomId, catalog.uomIdA);
  await db.withTransaction(async (transaction) => {
    const [snapshot] = await service.getSalesSnapshotsInTransaction(transaction, [{ skuId: fixture.skuId, skuUomId: fixture.skuUomIdA }]);
    assert.equal(snapshot.salesUom.skuUomId, fixture.skuUomIdA);
    assert.equal(snapshot.skuVersion, 1);
    assert.equal(snapshot.itemVersion, 1);
    const inventoryProfiles = await service.getSalesInventoryProfilesInTransaction(transaction, [fixture.skuId]);
    assert.equal(inventoryProfiles.get(fixture.skuId).salesUom.skuUomId, fixture.skuUomIdA);
    assert.equal(inventoryProfiles.get(fixture.skuId).salesUom.toBaseFactor, 1);
    for (const [table, id, assignments] of [
      ["item_skus", fixture.skuId, "suggested_price_amount = '200.0000'"],
      ["items", fixture.itemId, "status = 'inactive'"],
      ["item_uoms", catalog.uomIdA, "status = 'inactive'"],
      ["item_sku_uoms", fixture.skuUomIdA, "to_base_factor = 2"]
    ]) {
      await assert.rejects(() => db.withTransaction(async (writer) => {
        const [[{ lockWait }]] = await writer.query("SELECT @@SESSION.innodb_lock_wait_timeout AS lockWait");
        try {
          await writer.query("SET SESSION innodb_lock_wait_timeout = 1");
          await writer.execute(`UPDATE ${table} SET ${assignments} WHERE id = ?`, [id]);
        } finally {
          await writer.query("SET SESSION innodb_lock_wait_timeout = ?", [Number(lockWait)]);
        }
      }), error => error.code === "ER_LOCK_WAIT_TIMEOUT" || error.cause?.code === "ER_LOCK_WAIT_TIMEOUT");
    }
    assert.deepEqual((await service.getSalesSnapshotsInTransaction(transaction, [{ skuId: fixture.skuId, skuUomId: fixture.skuUomIdA }]))[0], snapshot);
    // Inventory child inserts take a parent FK share lock: another SHARE remains compatible.
    await db.withTransaction(async (other) => {
      const [[row]] = await other.query("SELECT id FROM item_skus WHERE id = ? FOR SHARE", [fixture.skuId]);
      assert.equal(Number(row.id), fixture.skuId);
    });
  });
  await db.execute("UPDATE item_skus SET status = 'discontinued' WHERE id = ?", [fixture.skuId]);
  assert.equal((await service.findById(fixture.skuId, { purpose: "sale" })).usable, true);
  assert.equal((await service.findManyForSale([fixture.skuId])).get(fixture.skuId).usable, false);
  await assert.rejects(() => db.withTransaction(transaction => service.getSalesSnapshotsInTransaction(transaction,
    [{ skuId: fixture.skuId, skuUomId: fixture.skuUomIdA }])), { code: "SKU_NOT_USABLE" });
});

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

test("TC-006 findByBarcode：真 JOIN 去 item_sku_barcodes，搵到啱嘅 SKU", { skip }, async (t) => {
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
