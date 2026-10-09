import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { ItemAdminService } from "../../src/modules/item/ItemAdminService.js";
import { ItemLookupService } from "../../src/modules/item/ItemLookupService.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

async function fixture(t, { status = "draft" } = {}) {
  const config = defaultConfigurationSource();
  const app = await createApplication({ configurationSource: { ...config, application: { ...config.application, port: 0 } } });
  const db = app.services.require("mysqldatabase"), now = Date.now(), suffix = randomUUID().slice(0, 8);
  const insert = async (sql, params = []) => Number((await db.execute(sql, params))[0].insertId);
  const actorId = await insert("INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, 'unused', ?, ?)", [`item-ref-${suffix}`, now, now]);
  const categoryId = await insert("INSERT INTO item_categories (name, created_at, updated_at) VALUES (?, ?, ?)", [`ref-${suffix}`, now, now]);
  const brandId = await insert("INSERT INTO item_brands (name, created_at, updated_at) VALUES (?, ?, ?)", [`ref-${suffix}`, now, now]);
  const uomIds = [];
  for (const code of ["EA", "BOX"]) uomIds.push(await insert("INSERT INTO item_uoms (code, name, created_at, updated_at) VALUES (?, ?, ?, ?)", [`${code}${suffix}`, code, now, now]));
  const itemId = await insert("INSERT INTO items (name, category_id, brand_id, product_type, status, created_at, updated_at) VALUES (?, ?, ?, 'variant', ?, ?, ?)", [`ref-${suffix}`, categoryId, brandId, status, now, now]);
  const skuIds = [], mappingIds = [];
  for (let i = 0; i < 2; i++) {
    const skuId = await insert(`INSERT INTO item_skus (item_id, sku_code, sku_name, tracking_policy, purchasable, sellable, inventory_tracked, suggested_price_amount, status, created_at, updated_at)
      VALUES (?, ?, 'Reference SKU', 'none', 1, 1, 1, '1.0000', ?, ?, ?)`, [itemId, `REF-${suffix}-${i}`, status, now, now]);
    skuIds.push(skuId);
    for (let j = 0; j < uomIds.length; j++) mappingIds.push(await insert(`INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, is_default_purchase, is_default_sale, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [skuId, uomIds[j], j ? 24 : 1, j ? 0 : 1, j ? 0 : 1, j ? 0 : 1, now, now]));
  }
  const warehouseId = await insert("INSERT INTO inventory_warehouses (warehouse_code, normalized_code, warehouse_name, created_at, updated_at) VALUES (?, ?, 'Reference test', ?, ?)", [`REF-${suffix}`, `ref-${suffix}`, now, now]);
  const binId = await insert("INSERT INTO inventory_bins (warehouse_id, bin_code, normalized_code, created_at, updated_at) VALUES (?, 'A', 'a', ?, ?)", [warehouseId, now, now]);
  const dependencies = { database: db, logger: app.services.require("logging").logger, time: app.services.require("time") };
  const service = new ItemAdminService(dependencies), lookup = new ItemLookupService(dependencies);
  const command = { actorId, claimedRoles: [], claimedPermissions: [], version: 1, reason: "TASK-043 developer verification" };
  const snapshot = async () => {
    const [items] = await db.query("SELECT id, status, version FROM items WHERE id = ?", [itemId]);
    const [skus] = await db.query("SELECT id, status, version FROM item_skus WHERE item_id = ? ORDER BY id", [itemId]);
    const [uoms] = await db.query("SELECT * FROM item_sku_uoms WHERE sku_id IN (?, ?) ORDER BY id", skuIds);
    const [barcodes] = await db.query("SELECT * FROM item_sku_barcodes WHERE sku_id IN (?, ?) ORDER BY id", skuIds);
    const [audit] = await db.query("SELECT * FROM item_audit_logs WHERE actor_user_id = ? ORDER BY id", [actorId]);
    return { items, skus, uoms, barcodes, audit };
  };
  const stock = async (quantity, stockStatus = "AVAILABLE", skuId = skuIds[0]) => insert(`INSERT INTO inventory_stock_balances
    (warehouse_id, bin_id, sku_id, stock_status, on_hand_quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [warehouseId, binId, skuId, stockStatus, quantity, now, now]);
  const update = (changes = {}) => service.updateSku({ ...command, id: skuIds[0], skuName: "Reference SKU", trackingPolicy: "none", purchasable: true,
    sellable: true, inventoryTracked: true, suggestedPriceAmount: "1.0000", barcodes: [],
    uoms: uomIds.map((uomId, index) => ({ id: mappingIds[index], uomId, toBaseFactor: index ? 24 : 1, isBase: !index, isDefaultPurchase: !index, isDefaultSale: !index })), ...changes });
  const salesLine = async (type, status) => {
    const customerId = await insert(`INSERT INTO customers (customer_code, customer_code_key, legal_name, legal_name_key, default_currency_code, status, created_at, updated_at)
      VALUES (?, ?, 'Reference customer', ?, 'HKD', 'active', ?, ?)`, [`REF-${suffix}`, `ref-${suffix}`, `ref-${suffix}`, now, now]);
    if (type === "quotation") {
      const id = await insert(`INSERT INTO sales_quotations (quotation_number, status, customer_id, customer_code_snapshot, customer_name_snapshot, currency_code,
        quotation_date, valid_until, line_count, total_amount, created_at, updated_at, last_business_updated_at)
        VALUES (?, ?, ?, 'Reference', 'Reference customer', 'HKD', '2026-10-09', '2099-12-31', 1, 1, ?, ?, ?)`, [`REF-${suffix}`, status, customerId, now, now, now]);
      await insert(`INSERT INTO sales_quotation_lines (quotation_id, line_no, sku_id, item_name_snapshot, sku_code_snapshot, sku_name_snapshot, sku_uom_id,
        uom_code_snapshot, uom_name_snapshot, to_base_factor_snapshot, quantity, base_quantity, unit_selling_price, price_source, line_amount, created_at, updated_at)
        VALUES (?, 1, ?, 'Reference', 'Reference', 'Reference SKU', ?, 'BOX', 'Box', 24, 1, 24, 1, 'MANUAL', 1, ?, ?)`, [id, skuIds[0], mappingIds[1], now, now]);
      return id;
    }
    const id = await insert(`INSERT INTO sales_orders (sales_order_number, status, source_type, customer_id, customer_code_snapshot, customer_name_snapshot, currency_code,
      fulfillment_warehouse_id, warehouse_code_snapshot, warehouse_name_snapshot, order_date, line_count, total_amount, created_at, updated_at, last_business_updated_at)
      VALUES (?, ?, 'MANUAL', ?, 'Reference', 'Reference customer', 'HKD', ?, 'Reference', 'Reference', '2026-10-09', 1, 1, ?, ?, ?)`, [`REF-${suffix}`, status, customerId, warehouseId, now, now, now]);
    await insert(`INSERT INTO sales_order_lines (sales_order_id, line_no, sku_id, item_name_snapshot, sku_code_snapshot, sku_name_snapshot, sku_uom_id,
      uom_code_snapshot, uom_name_snapshot, to_base_factor_snapshot, tracking_policy_snapshot, ordered_quantity, ordered_base_quantity, unit_selling_price,
      price_source, line_amount, created_at, updated_at) VALUES (?, 1, ?, 'Reference', 'Reference', 'Reference SKU', ?, 'BOX', 'Box', 24, 'none', 1, 24, 1, 'MANUAL', 1, ?, ?)`, [id, skuIds[0], mappingIds[1], now, now]);
    return id;
  };
  t.after(async () => {
    try {
      await db.execute("DELETE FROM sales_orders WHERE sales_order_number = ?", [`REF-${suffix}`]);
      await db.execute("DELETE FROM sales_quotations WHERE quotation_number = ?", [`REF-${suffix}`]);
      await db.execute("DELETE FROM customers WHERE customer_code = ?", [`REF-${suffix}`]);
      await db.execute("DELETE FROM inventory_stock_balances WHERE warehouse_id = ?", [warehouseId]);
      await db.execute("DELETE FROM inventory_stock_controls WHERE warehouse_id = ?", [warehouseId]);
      await db.execute("DELETE FROM inventory_lots WHERE sku_id IN (?, ?)", skuIds);
      await db.execute("DELETE FROM inventory_bins WHERE id = ?", [binId]);
      await db.execute("DELETE FROM inventory_warehouses WHERE id = ?", [warehouseId]);
      await db.execute("DELETE FROM item_audit_logs WHERE actor_user_id = ?", [actorId]);
      await db.execute("DELETE FROM item_sku_barcodes WHERE sku_id IN (?, ?)", skuIds);
      await db.execute("DELETE FROM item_sku_uoms WHERE sku_id IN (?, ?)", skuIds);
      await db.execute("DELETE FROM item_skus WHERE item_id = ?", [itemId]);
      await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
      await db.execute("DELETE FROM item_uoms WHERE id IN (?, ?)", uomIds);
      await db.execute("DELETE FROM item_brands WHERE id = ?", [brandId]);
      await db.execute("DELETE FROM item_categories WHERE id = ?", [categoryId]);
      await db.execute("DELETE FROM users WHERE id = ?", [actorId]);
    } finally { await app.shutdown("item_reference_test_complete"); }
  });
  return { app, db, insert, now, suffix, itemId, skuIds, mappingIds, uomIds, warehouseId, binId, service, lookup, command, snapshot, stock, update, salesLine };
}

function referenced(code, types) {
  return error => {
    assert.equal(error.publicCode, code);
    assert.equal(error.statusCode, 409);
    assert.deepEqual(error.publicDetails.referenceTypes, types);
    assert.doesNotMatch(error.publicMessage, /SQL|CONSTRAINT|FOREIGN KEY/iu);
    return true;
  };
}

integrationTest("TASK-043: Draft Item and SKU deletion report real Inventory references and leave the aggregate untouched", async t => {
  const f = await fixture(t);
  await f.stock(0);
  const before = await f.snapshot();
  await assert.rejects(f.service.deleteItem({ ...f.command, id: f.itemId }), referenced("ITEM_REFERENCED", ["inventory_stock_balances"]));
  await assert.rejects(f.service.deleteSku({ ...f.command, id: f.skuIds[0] }), referenced("SKU_REFERENCED", ["inventory_stock_balances"]));
  assert.deepEqual(await f.snapshot(), before);
});

integrationTest("TASK-043: unreferenced Draft SKU and Item deletion still succeed and record only successful audits", async t => {
  const f = await fixture(t);
  await f.service.deleteSku({ ...f.command, id: f.skuIds[1] });
  await f.service.deleteItem({ ...f.command, id: f.itemId });
  const after = await f.snapshot();
  assert.deepEqual(after.items, []);
  assert.deepEqual(after.skus, []);
  assert.deepEqual(after.uoms, []);
  assert.deepEqual(after.audit.map(row => row.action), ["sku.delete", "item.delete"]);
});

integrationTest("TASK-043: real Sales quotation UOM references block removal and Draft deletion without rebuilding retained mappings", async t => {
  const f = await fixture(t);
  await f.salesLine("quotation", "CANCELLED");
  const before = await f.snapshot();
  await assert.rejects(f.update({ uoms: [{ id: f.mappingIds[0], uomId: f.uomIds[0], toBaseFactor: 1, isBase: true, isDefaultPurchase: true, isDefaultSale: true }] }),
    referenced("UOM_CHANGE_BLOCKED", ["sales_quotation_lines"]));
  await assert.rejects(f.service.deleteItem({ ...f.command, id: f.itemId }), referenced("ITEM_REFERENCED", ["sales_quotation_lines"]));
  await assert.rejects(f.service.deleteSku({ ...f.command, id: f.skuIds[0] }), referenced("SKU_REFERENCED", ["sales_quotation_lines"]));
  assert.deepEqual(await f.snapshot(), before);
  await f.update({ skuName: "Renamed safely" });
  assert.deepEqual((await f.snapshot()).uoms.map(row => row.id), before.uoms.map(row => row.id));
});

integrationTest("TASK-043: live Sales quotations/orders block archive, cancelled/completed snapshots remain readable after archive", async t => {
  for (const [type, openStatus, terminalStatus, table] of [
    ["quotation", "ISSUED", "CANCELLED", "sales_quotation_lines"],
    ["order", "CONFIRMED", "COMPLETED", "sales_order_lines"]
  ]) {
    await t.test(type, async child => {
      const f = await fixture(child, { status: "inactive" });
      const documentId = await f.salesLine(type, openStatus), before = await f.snapshot();
      await assert.rejects(f.service.archiveItem({ ...f.command, id: f.itemId }), referenced("ITEM_REFERENCED", [table]));
      await assert.rejects(f.service.archiveSku({ ...f.command, id: f.skuIds[0] }), referenced("SKU_REFERENCED", [table]));
      assert.deepEqual(await f.snapshot(), before);
      await f.db.execute(`UPDATE ${type === "quotation" ? "sales_quotations" : "sales_orders"} SET status = ? WHERE id = ?`, [terminalStatus, documentId]);
      await f.service.archiveItem({ ...f.command, id: f.itemId });
      const [[line]] = await f.db.query(`SELECT sku_id, sku_uom_id, to_base_factor_snapshot FROM ${table} WHERE sku_id = ?`, [f.skuIds[0]]);
      assert.equal(Number(line.sku_uom_id), f.mappingIds[1]);
      assert.equal(Number(line.to_base_factor_snapshot), 24);
    });
  }
});

// Interception controls scheduling/fallback only; actual schema, locks and FK failures remain MySQL's.
function interceptTransactions(f, query) {
  f.service.database = {
    query: (...args) => f.db.query(...args), execute: (...args) => f.db.execute(...args),
    withTransaction: (work, options) => f.db.withTransaction(tx => work({
      query: (sql, params) => query(tx, sql, params), execute: (...args) => tx.execute(...args)
    }), options)
  };
}

integrationTest("TASK-043: archive sees a newly committed reference after its authorization read", async t => {
  const f = await fixture(t, { status: "inactive" });
  let inserted = false;
  interceptTransactions(f, async (tx, sql, params) => {
    if (!inserted && sql.includes("FROM items WHERE id = ? FOR UPDATE")) { inserted = true; await f.stock(1); }
    return tx.query(sql, params);
  });
  const before = await f.snapshot();
  await assert.rejects(f.service.archiveItem({ ...f.command, id: f.itemId }), referenced("ITEM_REFERENCED", ["inventory_stock_balances"]));
  assert.deepEqual(await f.snapshot(), before);
});

integrationTest("TASK-043: raced FK failures map to public 409, including unknown fallback, with complete rollback", async t => {
  for (const [target, hideFallback] of [["item", false], ["sku", false], ["sku", true], ["uom", false], ["uom", true]]) {
    await t.test(`${target}: fallback hidden=${hideFallback}`, async child => {
      const f = await fixture(child);
      if (target === "uom") await f.salesLine("quotation", "CANCELLED");
      else await f.stock(0);
      let failed = false;
      interceptTransactions(f, async (tx, sql, params) => {
        if (sql.includes("information_schema.key_column_usage") && (!failed || hideFallback)) return [[]];
        return tx.query(sql, params);
      });
      const original = f.service.database.withTransaction;
      f.service.database.withTransaction = (work, options) => original(tx => work({ ...tx,
        execute: async (...args) => { try { return await tx.execute(...args); } catch (error) { failed = true; throw error; } }
      }), options);
      const before = await f.snapshot();
      const action = target === "item" ? f.service.deleteItem({ ...f.command, id: f.itemId })
        : target === "sku" ? f.service.deleteSku({ ...f.command, id: f.skuIds[0] })
          : f.update({ uoms: [{ id: f.mappingIds[0], uomId: f.uomIds[0], toBaseFactor: 1, isBase: true, isDefaultPurchase: true, isDefaultSale: true }] });
      await assert.rejects(action, referenced(target === "item" ? "ITEM_REFERENCED" : target === "sku" ? "SKU_REFERENCED" : "UOM_CHANGE_BLOCKED",
        [hideFallback ? "unknown" : target === "uom" ? "sales_quotation_lines" : "inventory_stock_balances"]));
      assert.equal(failed, true, "a real MySQL FK, not a fabricated error, must reject deletion");
      assert.deepEqual(await f.snapshot(), before);
    });
  }
});

integrationTest("TASK-043: consumer-held Item locks serialize factor changes until committed references can be checked", async t => {
  const f = await fixture(t, { status: "active" });
  const ready = Promise.withResolvers(), release = Promise.withResolvers(), attempting = Promise.withResolvers();
  const consumer = f.db.withTransaction(async tx => {
    assert.equal((await f.lookup.getInventoryProfileInTransaction(tx, f.skuIds[0])).usable, true);
    ready.resolve();
    await release.promise;
    await tx.execute(`INSERT INTO inventory_stock_balances (warehouse_id, bin_id, sku_id, stock_status, on_hand_quantity, created_at, updated_at)
      VALUES (?, ?, ?, 'AVAILABLE', 1, ?, ?)`, [f.warehouseId, f.binId, f.skuIds[0], f.now, f.now]);
  });
  t.after(() => release.resolve());
  await ready.promise;
  interceptTransactions(f, (tx, sql, params) => {
    if (sql.includes("SELECT * FROM item_skus WHERE id = ? FOR UPDATE")) attempting.resolve();
    return tx.query(sql, params);
  });
  const change = f.update({ uoms: [
    { id: f.mappingIds[0], uomId: f.uomIds[0], toBaseFactor: 1, isBase: true, isDefaultPurchase: true, isDefaultSale: true },
    { id: f.mappingIds[1], uomId: f.uomIds[1], toBaseFactor: 30, isBase: false }
  ] });
  const rejected = assert.rejects(change, referenced("UOM_CHANGE_BLOCKED", ["inventory_stock_balances"]));
  await attempting.promise;
  release.resolve();
  await consumer;
  await rejected;
  assert.equal((await f.snapshot()).uoms[1].to_base_factor, 24);
});

integrationTest("TASK-043: barcode-bound UOM removal is rejected with the actual dependency and full rollback", async t => {
  const f = await fixture(t);
  await f.insert(`INSERT INTO item_sku_barcodes (sku_id, sku_uom_id, barcode, normalized_barcode, barcode_type, is_primary, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'internal', 1, ?, ?)`, [f.skuIds[0], f.mappingIds[1], `REF-${f.suffix}`, `REF-${f.suffix}`, f.now, f.now]);
  const before = await f.snapshot();
  await assert.rejects(f.update({ uoms: [{ id: f.mappingIds[0], uomId: f.uomIds[0], toBaseFactor: 1, isBase: true, isDefaultPurchase: true, isDefaultSale: true }] }),
    referenced("UOM_CHANGE_BLOCKED", ["item_sku_barcodes"]));
  assert.deepEqual(await f.snapshot(), before);
});

integrationTest("TASK-043: single Item/SKU and bulk archive share live-stock guards and atomic audit rollback", async t => {
  const f = await fixture(t, { status: "inactive" });
  await f.stock(3, "QUARANTINED", f.skuIds[1]);
  const before = await f.snapshot();
  await assert.rejects(f.service.archiveItem({ ...f.command, id: f.itemId }), referenced("ITEM_REFERENCED", ["inventory_stock_balances"]));
  await assert.rejects(f.service.archiveSku({ ...f.command, id: f.skuIds[1] }), referenced("SKU_REFERENCED", ["inventory_stock_balances"]));
  await assert.rejects(f.service.bulkChangeStatus({ ...f.command, targetType: "sku", action: "archive", targets: f.skuIds.map(id => ({ id, version: 1 })) }), error => {
    assert.equal(error.publicCode, "BULK_STATUS_CHANGE_REJECTED");
    assert.equal(error.publicDetails.issues[0].code, "SKU_REFERENCED");
    return true;
  });
  assert.deepEqual(await f.snapshot(), before);
});

integrationTest("TASK-043: reserved quantity blocks archive but zero balance/control and retained lot history do not", async t => {
  const f = await fixture(t, { status: "inactive" });
  await f.stock(0);
  await f.insert("INSERT INTO inventory_stock_controls (warehouse_id, sku_id, reserved_quantity, created_at, updated_at) VALUES (?, ?, 2, ?, ?)", [f.warehouseId, f.skuIds[0], f.now, f.now]);
  await f.insert("INSERT INTO inventory_lots (sku_id, lot_number, normalized_lot_number, first_receipt_date, sku_code_snapshot, created_at) VALUES (?, 'HISTORY', 'history', '2026-10-09', 'Reference SKU', ?)", [f.skuIds[0], f.now]);
  await assert.rejects(f.service.archiveSku({ ...f.command, id: f.skuIds[0] }), referenced("SKU_REFERENCED", ["inventory_stock_controls"]));
  await f.db.execute("UPDATE inventory_stock_controls SET reserved_quantity = 0 WHERE warehouse_id = ?", [f.warehouseId]);
  await f.service.archiveItem({ ...f.command, id: f.itemId });
  assert.ok((await f.snapshot()).skus.every(row => row.status === "archived"));
  const [[history]] = await f.db.query("SELECT COUNT(*) AS count FROM inventory_lots WHERE sku_id = ?", [f.skuIds[0]]);
  assert.equal(Number(history.count), 1);
});

integrationTest("TASK-043: Inventory profile and UOM resolution read current locked values after an earlier RR snapshot", async t => {
  const f = await fixture(t, { status: "active" });
  await f.db.withTransaction(async tx => {
    await tx.query("SELECT status FROM item_skus WHERE id = ?", [f.skuIds[0]]);
    await f.service.deactivateItem({ ...f.command, id: f.itemId });
    await f.service.archiveItem({ ...f.command, id: f.itemId, version: 2 });
    await f.update({ version: 3, uoms: [
      { id: f.mappingIds[0], uomId: f.uomIds[0], toBaseFactor: 1, isBase: true, isDefaultPurchase: true, isDefaultSale: true },
      { id: f.mappingIds[1], uomId: f.uomIds[1], toBaseFactor: 30, isBase: false }
    ] });
    const profile = await f.lookup.getInventoryProfileInTransaction(tx, f.skuIds[0]);
    assert.equal(profile.skuStatus, "archived");
    assert.equal(profile.usable, false);
    assert.equal((await f.lookup.resolveUomInTransaction(tx, f.skuIds[0], f.uomIds[1])).toBaseFactor, 30);
  });
});

integrationTest("TASK-043: the real Inventory receipt consumer posts the locked Item conversion and rolls back its caller transaction", async t => {
  const f = await fixture(t, { status: "active" });
  const posting = new InventoryPostingService({ database: f.db, logger: f.app.services.require("logging").logger,
    time: f.app.services.require("time"), authorize: async () => ({ username: "reference-test", permissions: ["inventory.operation"] }) });
  const command = inventoryCommandFixture({ actor: { userId: f.command.actorId, claimedRoles: [], claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: "receipt.post", requiredCallerPermission: "inventory.operation" },
    source: { documentId: f.suffix, eventId: randomUUID() }, payload: { skuId: f.skuIds[0], quantity: 2,
      uomId: f.uomIds[1], warehouseId: f.warehouseId, binId: f.binId, stockStatus: "AVAILABLE" } });
  const rollback = new Error("intentional developer transaction rollback");
  await assert.rejects(f.db.withTransaction(async tx => {
    const result = await posting.postReceiptInTransaction(tx, command);
    assert.equal(result.baseQuantity, 48);
    assert.equal(result.balance.onHandQuantity, 48);
    throw rollback;
  }), error => error.cause === rollback);
  const [[balance]] = await f.db.query("SELECT COUNT(*) AS count FROM inventory_stock_balances WHERE warehouse_id = ?", [f.warehouseId]);
  assert.equal(Number(balance.count), 0);
});

integrationTest("TASK-043: Item-first factor update makes an earlier-snapshot Inventory consumer observe the committed conversion", async t => {
  const f = await fixture(t, { status: "active" });
  const updated = Promise.withResolvers(), release = Promise.withResolvers(), requesting = Promise.withResolvers();
  const record = f.service.auditLog.record.bind(f.service.auditLog);
  f.service.auditLog.record = async (...args) => { await record(...args); updated.resolve(); await release.promise; };
  t.after(() => release.resolve());
  await f.db.withTransaction(async tx => {
    await tx.query("SELECT to_base_factor FROM item_sku_uoms WHERE id = ?", [f.mappingIds[1]]);
    const change = f.update({ uoms: [
      { id: f.mappingIds[0], uomId: f.uomIds[0], toBaseFactor: 1, isBase: true, isDefaultPurchase: true, isDefaultSale: true },
      { id: f.mappingIds[1], uomId: f.uomIds[1], toBaseFactor: 30, isBase: false }
    ] });
    await updated.promise;
    const executor = { query: (sql, params) => {
      if (sql.includes("FROM item_skus s") && sql.includes("FOR SHARE")) requesting.resolve();
      return tx.query(sql, params);
    } };
    const conversion = f.lookup.resolveUomInTransaction(executor, f.skuIds[0], f.uomIds[1]);
    await requesting.promise;
    release.resolve();
    await change;
    assert.equal((await conversion).toBaseFactor, 30);
  });
});
