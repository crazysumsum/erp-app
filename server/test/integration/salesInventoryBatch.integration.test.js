import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { InventoryReservationService } from "../../src/modules/inventory/InventoryReservationService.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
async function setup(t) {
  const config = defaultConfigurationSource();
  const app = await createApplication({ configurationSource: { ...config, application: { ...config.application, port: 0 } } });
  let cleanup = async () => {};
  t.after(async () => { try { await cleanup(); } finally { await app.shutdown("sales_inventory_batch_complete"); } });
  const db = app.services.require("mysqldatabase"), now = Date.now(), suffix = randomUUID().slice(0, 8);
  const insert = async (sql, params) => Number((await db.execute(sql, params))[0].insertId);
  const userId = await insert("INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'Sales batch test', ?, ?)",
    [`sales-batch-${suffix}`, await hashPassword("Integration-Test-Pass-1!"), now, now]);
  const roleName = `sales-batch-${suffix}`;
  const roleId = await insert("INSERT INTO roles (name, created_at) VALUES (?, ?)", [roleName, now]);
  await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
  await db.execute("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = 'sales.mgmt'", [roleId]);
  const categoryId = await insert("INSERT INTO item_categories (name, created_at, updated_at) VALUES (?, ?, ?)", [`sales-${suffix}`, now, now]);
  const brandId = await insert("INSERT INTO item_brands (name, created_at, updated_at) VALUES (?, ?, ?)", [`sales-${suffix}`, now, now]);
  const uomId = await insert("INSERT INTO item_uoms (code, name, created_at, updated_at) VALUES (?, 'Sales unit', ?, ?)", [`SB${suffix}`, now, now]);
  const itemId = await insert("INSERT INTO items (name, category_id, brand_id, product_type, status, created_at, updated_at) VALUES ('Sales batch', ?, ?, 'standard', 'active', ?, ?)", [categoryId, brandId, now, now]);
  const skuIds = [];
  for (let i = 0; i < 2; i++) {
    const id = await insert(`INSERT INTO item_skus (item_id, sku_code, sku_name, tracking_policy, purchasable, sellable, inventory_tracked,
      min_sale_life_days, shelf_life_days, suggested_price_amount, status, created_at, updated_at) VALUES (?, ?, 'Sales SKU', 'batch_expiry', 1, 1, 1, 5, 365, '100.0000', 'active', ?, ?)`, [itemId, `SB-${suffix}-${i}`, now, now]);
    skuIds.push(id);
    await db.execute("INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, is_default_sale, created_at, updated_at) VALUES (?, ?, 1, 1, 1, ?, ?)", [id, uomId, now, now]);
  }
  const warehouseId = await insert("INSERT INTO inventory_warehouses (warehouse_code, normalized_code, warehouse_name, created_at, updated_at) VALUES (?, ?, 'Sales batch', ?, ?)", [`SB-${suffix}`, `sb-${suffix}`, now, now]);
  const binId = await insert("INSERT INTO inventory_bins (warehouse_id, bin_code, normalized_code, created_at, updated_at) VALUES (?, 'A', 'a', ?, ?)", [warehouseId, now, now]);
  for (const skuId of skuIds) {
    const lotId = await insert(`INSERT INTO inventory_lots (sku_id, lot_number, normalized_lot_number, expiry_date,
      first_receipt_date, sku_code_snapshot, created_at) VALUES (?, 'LONG', 'long', '2027-01-01', '2026-10-02', 'Sales SKU', ?)`, [skuId, now]);
    await db.execute(`INSERT INTO inventory_stock_balances (warehouse_id, bin_id, sku_id, lot_id, stock_status, on_hand_quantity, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'AVAILABLE', 5, ?, ?)`, [warehouseId, binId, skuId, lotId, now, now]);
  }
  cleanup = async () => {
    // Immutable audit and its referenced operation evidence remain in the disposable CI schema.
    await db.execute("DELETE FROM inventory_allocations WHERE reservation_id IN (SELECT id FROM inventory_reservations WHERE warehouse_id = ?)", [warehouseId]);
    await db.execute("DELETE FROM inventory_reservations WHERE warehouse_id = ?", [warehouseId]);
    await db.execute("DELETE FROM inventory_stock_balances WHERE warehouse_id = ?", [warehouseId]);
    await db.execute("DELETE FROM inventory_stock_controls WHERE warehouse_id = ?", [warehouseId]);
    await db.execute("DELETE FROM inventory_lots WHERE sku_id IN (?, ?)", skuIds);
    await db.execute("DELETE FROM inventory_bins WHERE id = ?", [binId]);
    await db.execute("DELETE FROM inventory_warehouses WHERE id = ?", [warehouseId]);
    await db.execute("DELETE FROM item_sku_uoms WHERE sku_id IN (?, ?)", skuIds);
    await db.execute("DELETE FROM item_skus WHERE item_id = ?", [itemId]);
    await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
    await db.execute("DELETE FROM item_uoms WHERE id = ?", [uomId]);
    await db.execute("DELETE FROM item_brands WHERE id = ?", [brandId]);
    await db.execute("DELETE FROM item_categories WHERE id = ?", [categoryId]);
    await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
    await db.execute("DELETE FROM user_roles WHERE user_id = ?", [userId]);
    await db.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  };
  const service = new InventoryReservationService({ database: db, logger: app.services.require("logging").logger,
    time: { nowMs: () => now, fileDate: () => "2026-10-02" } });
  const command = (documentId, payload, eventId = randomUUID()) => {
    return { actor: { userId, serviceName: "", claimedRoles: [roleName], claimedPermissions: ["sales.mgmt"] },
      source: { documentId: String(documentId), eventId }, correlationId: eventId, payload };
  };
  return { app, db, service, command, skuIds, warehouseId, binId, now };
}

integrationTest("Sales batches serialize reverse demand, replay unchanged and release original complete membership", async t => {
  const f = await setup(t);
  const orders = f.skuIds.map((skuId, index) => ({ sourceLineId: index + 1, skuId, orderedBaseQuantity: 4, minimumRemainingDays: 0 }));
  const commands = [f.command(70001, { warehouseId: f.warehouseId, expectedOrderVersion: 1, lines: orders }),
    f.command(70002, { warehouseId: f.warehouseId, expectedOrderVersion: 1, lines: orders.toReversed() })];
  const results = await Promise.all(commands.map(cmd => f.db.withTransaction(tx => f.service.reserveAvailableForSalesBatchInTransaction(tx, cmd))));
  for (const skuId of f.skuIds) assert.equal(results.flatMap(r => r.lines).filter(r => r.skuId === skuId).reduce((sum, r) => sum + r.reservedBaseQuantity, 0), 5);
  assert.ok(results.flatMap(r => r.lines).every(r => r.reservedBaseQuantity + r.uncoveredBaseQuantity === 4 && r.minimumRemainingDays === 5));
  await f.db.execute("UPDATE item_skus SET status = 'inactive', min_sale_life_days = 30 WHERE id IN (?, ?)", f.skuIds);
  assert.deepEqual(await f.db.withTransaction(tx => f.service.reserveAvailableForSalesBatchInTransaction(tx, commands[0])), results[0]);
  const release = f.command(70001, { warehouseId: f.warehouseId, expectedOrderVersion: 1, intent: "ALL_OUTSTANDING" });
  const consume = tx => f.service.releaseSalesBatchInTransaction(tx, release).then(async r => {
    const rows = []; for await (const page of r.results) rows.push(...page); assert.equal(rows.length, r.lineCount); return rows;
  });
  const released = await f.db.withTransaction(consume);
  assert.deepEqual(await f.db.withTransaction(consume), released);
  const [[plan]] = await f.db.query(`EXPLAIN FORMAT=TRADITIONAL SELECT id FROM inventory_operation_requests WHERE source_module = 'SALES'
    AND source_document_type = 'SALES_ORDER' AND source_document_id = '70001' AND source_event_id = ? AND source_line_id <> '' AND id > 0 ORDER BY id LIMIT 100`, [release.source.eventId]);
  assert.ok(Number.isFinite(Number(plan.rows)));
  t.diagnostic(`Batch member query plan: type=${plan.type}, key=${plan.key}, estimatedRows=${plan.rows}`);
});

integrationTest("Sales ATP reads newly committed lot expiry after an earlier RR snapshot and rolls back a failed batch", async t => {
  const f = await setup(t);
  const cmd = f.command(70003, { warehouseId: f.warehouseId, expectedOrderVersion: 1,
    lines: [{ sourceLineId: 1, skuId: f.skuIds[0], orderedBaseQuantity: 20, minimumRemainingDays: 0 }] });
  const originalLocks = f.service.locks;
  f.service.locks = { async lockForCommand(tx, scope) {
    // Item discovery has already established the transaction's RR snapshot.
    await f.db.withTransaction(async writer => {
      await originalLocks.lockForCommand(writer, scope);
      const [lot] = await writer.execute(`INSERT INTO inventory_lots (sku_id, lot_number, normalized_lot_number, expiry_date,
        first_receipt_date, sku_code_snapshot, created_at) VALUES (?, 'SHORT', 'short', '2026-10-03', '2026-10-02', 'Sales SKU', ?)`, [f.skuIds[0], f.now]);
      await writer.execute(`INSERT INTO inventory_stock_balances (warehouse_id, bin_id, sku_id, lot_id, stock_status, on_hand_quantity, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'AVAILABLE', 100, ?, ?)`, [f.warehouseId, f.binId, f.skuIds[0], Number(lot.insertId), f.now, f.now]);
    });
    return originalLocks.lockForCommand(tx, scope);
  } };
  const result = await f.db.withTransaction(tx => f.service.reserveAvailableForSalesBatchInTransaction(tx, cmd));
  assert.equal(result.lines[0].reservedBaseQuantity, 5);
  assert.equal(result.lines[0].uncoveredBaseQuantity, 15);
  f.service.locks = originalLocks;
  const fail = f.command(70004, { warehouseId: f.warehouseId, expectedOrderVersion: 1,
    lines: [{ sourceLineId: 1, skuId: f.skuIds[1], orderedBaseQuantity: 1, minimumRemainingDays: 0 }] });
  const audit = f.service.audit;
  f.service.audit = { async recordSucceeded() { throw new Error("Synthetic audit failure"); } };
  await assert.rejects(() => f.db.withTransaction(tx => f.service.reserveAvailableForSalesBatchInTransaction(tx, fail)), e => e.cause?.message === "Synthetic audit failure");
  const [[count]] = await f.db.query("SELECT COUNT(*) AS n FROM inventory_operation_requests WHERE source_module = 'SALES' AND source_document_id = '70004'");
  assert.equal(Number(count.n), 0);
  f.service.audit = audit;
});

integrationTest("Sales release handles 300 mappings in bounded pages and rolls back failure after page one", async t => {
  const f = await setup(t);
  await f.db.execute("UPDATE inventory_stock_balances SET on_hand_quantity = 500 WHERE warehouse_id = ? AND sku_id = ?", [f.warehouseId, f.skuIds[0]]);
  for (let i = 0; i < 3; i++) {
    const cmd = f.command(70005, { warehouseId: f.warehouseId, expectedOrderVersion: 1,
      lines: Array.from({ length: 100 }, (_, index) => ({ sourceLineId: index + 1, skuId: f.skuIds[0], orderedBaseQuantity: 1, minimumRemainingDays: 0 })) });
    await f.db.withTransaction(tx => f.service.reserveAvailableForSalesBatchInTransaction(tx, cmd));
  }
  const cmd = f.command(70005, { warehouseId: f.warehouseId, expectedOrderVersion: 1, intent: "ALL_OUTSTANDING" });
  const audit = f.service.audit; let audited = 0;
  f.service.audit = { async recordSucceeded(tx, input) {
    if (++audited === 101) throw new Error("Synthetic second-page failure");
    return audit.recordSucceeded(tx, input);
  } };
  await assert.rejects(() => f.db.withTransaction(tx => f.service.releaseSalesBatchInTransaction(tx, cmd)), e => e.cause?.message === "Synthetic second-page failure");
  const [[unchanged]] = await f.db.query("SELECT SUM(outstanding_quantity) AS quantity, MIN(version) AS minVersion, MAX(version) AS maxVersion FROM inventory_reservations WHERE warehouse_id = ?", [f.warehouseId]);
  assert.equal(Number(unchanged.quantity), 300); assert.equal(Number(unchanged.minVersion), 1); assert.equal(Number(unchanged.maxVersion), 1);
  const [[claims]] = await f.db.query("SELECT COUNT(*) AS n FROM inventory_operation_requests WHERE source_module = 'SALES' AND source_document_id = '70005' AND source_event_id = ?", [cmd.source.eventId]);
  assert.equal(Number(claims.n), 0);
  f.service.audit = audit;
  const started = performance.now();
  await f.db.withTransaction(async tx => {
    const result = await f.service.releaseSalesBatchInTransaction(tx, cmd);
    let count = 0; for await (const page of result.results) { assert.ok(page.length <= 100); count += page.length; }
    assert.equal(count, 300); assert.equal(result.lineCount, 300);
  });
  t.diagnostic(`300-mapping release including consumption: ${Math.round(performance.now() - started)}ms; one caller transaction`);
});
