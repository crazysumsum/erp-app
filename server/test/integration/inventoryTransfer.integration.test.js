import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { before, after } from "node:test";
import mysql from "mysql2/promise";
import { up as permissions } from "../../database/migrations/0055_seed_inventory_permissions.js";
import { up as operations } from "../../database/migrations/0056_create_inventory_operations.js";
import { up as audit } from "../../database/migrations/0057_create_inventory_audit.js";
import { up as master } from "../../database/migrations/0058_create_inventory_master.js";
import { up as stock } from "../../database/migrations/0059_create_inventory_stock.js";
import { up as movements } from "../../database/migrations/0060_create_inventory_movements.js";
import { up as reservations } from "../../database/migrations/0063_create_inventory_reservations.js";
import { up as transfers } from "../../database/migrations/0064_create_inventory_transfers.js";
import { InventoryTransferService } from "../../src/modules/inventory/InventoryTransferService.js";
import { InventoryInquiryService } from "../../src/modules/inventory/InventoryInquiryService.js";
import { InventoryOperationService } from "../../src/modules/inventory/InventoryOperationService.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";
import { createInventoryBarrier } from "../../test-support/fakeInventoryDatabase.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_TRANSFER_TESTS === "1";
const integrationTest = enabled ? test : test.skip;
const time = { nowMs: () => 1790899200000, fileDate: () => "2026-10-02" };
const logger = { error() {} };
let pool, database, service, inquiry;

before(async () => {
  if (!enabled) return;
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_p3_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET ?? "", /^\/private\/tmp\/erp-inventory-p3-mysql-2670\.[A-Za-z0-9_]+\/mysql\.sock$/u);
  pool = mysql.createPool({ user: "root", database: process.env.DB_NAME,
    socketPath: process.env.DB_SOCKET, connectionLimit: 4 });
  const [[environment]] = await pool.query("SELECT VERSION() AS version, DATABASE() AS db, @@skip_networking AS isolated");
  assert.match(environment.version, /^26\.7\.0(?:$|-)/u);
  assert.equal(environment.db, process.env.DB_NAME);
  assert.equal(Number(environment.isolated), 1);
  assert.equal((await pool.query("SHOW TABLES"))[0].length, 0, "requires fresh task-owned synthetic schema");
  // Minimal synthetic parents, but real Inventory migrations, auth, Item lookup and transactions.
  for (const ddl of [
    "CREATE TABLE users (id BIGINT UNSIGNED PRIMARY KEY, username VARCHAR(190), status VARCHAR(20)) ENGINE=InnoDB",
    "CREATE TABLE roles (id BIGINT UNSIGNED PRIMARY KEY, name VARCHAR(190)) ENGINE=InnoDB",
    "CREATE TABLE user_roles (user_id BIGINT UNSIGNED, role_id BIGINT UNSIGNED) ENGINE=InnoDB",
    "CREATE TABLE role_permissions (role_id BIGINT UNSIGNED, permission_id BIGINT UNSIGNED) ENGINE=InnoDB",
    `CREATE TABLE permissions (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(190) UNIQUE,
      description VARCHAR(255) DEFAULT '', created_at BIGINT UNSIGNED) ENGINE=InnoDB`,
    "CREATE TABLE items (id BIGINT UNSIGNED PRIMARY KEY, name VARCHAR(190), product_type VARCHAR(20), status VARCHAR(20)) ENGINE=InnoDB",
    `CREATE TABLE item_skus (id BIGINT UNSIGNED PRIMARY KEY, item_id BIGINT UNSIGNED, sku_code VARCHAR(190),
      sku_name VARCHAR(190), status VARCHAR(20), purchasable BOOLEAN DEFAULT 1, sellable BOOLEAN DEFAULT 1,
      inventory_tracked BOOLEAN DEFAULT 1, tracking_policy VARCHAR(20), shelf_life_days INT,
      min_receipt_life_days INT, min_sale_life_days INT, effective_from DATE, effective_to DATE) ENGINE=InnoDB`,
    "CREATE TABLE item_uoms (id BIGINT UNSIGNED PRIMARY KEY, code VARCHAR(20)) ENGINE=InnoDB",
    `CREATE TABLE item_sku_uoms (sku_id BIGINT UNSIGNED, uom_id BIGINT UNSIGNED, to_base_factor DECIMAL(18,6),
      is_base BOOLEAN, is_default_purchase BOOLEAN, is_default_sale BOOLEAN) ENGINE=InnoDB`
  ]) await pool.query(ddl);
  for (const migrate of [permissions, operations, audit, master, stock, movements, reservations, transfers]) await migrate(pool);
  await pool.query("INSERT INTO users VALUES (7, 'synthetic-operator', 'active')");
  await pool.query("INSERT INTO roles VALUES (1, 'warehouse-operator')");
  await pool.query("INSERT INTO user_roles VALUES (7, 1)");
  await pool.query("INSERT INTO role_permissions SELECT 1, id FROM permissions WHERE name = 'inventory.operation'");
  await pool.query("INSERT INTO items VALUES (1, 'Synthetic', 'physical', 'active')");
  await pool.query(`INSERT INTO item_skus (id, item_id, sku_code, sku_name, status, tracking_policy)
    VALUES (12, 1, 'SKU-12', 'Synthetic plain', 'active', 'none'),
           (13, 1, 'SKU-13', 'Synthetic expiry', 'active', 'batch_expiry'),
           (14, 1, 'SKU-14', 'Synthetic serial', 'active', 'serial')`);
  await pool.query("INSERT INTO item_uoms VALUES (1, 'EA')");
  await pool.query("INSERT INTO item_sku_uoms VALUES (12,1,1,1,1,1), (13,1,1,1,1,1), (14,1,1,1,1,1)");
  for (const warehouseId of [1, 2, 3]) {
    await pool.execute(`INSERT INTO inventory_warehouses
      (id, warehouse_code, normalized_code, warehouse_name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)`,
    [warehouseId, `WH-${warehouseId}`, `WH-${warehouseId}`, `Synthetic ${warehouseId}`]);
    await pool.execute(`INSERT INTO inventory_bins
      (id, warehouse_id, bin_code, normalized_code, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)`,
    [warehouseId, warehouseId, `BIN-${warehouseId}`, `BIN-${warehouseId}`]);
  }
  await pool.query(`INSERT INTO inventory_lots
    (id, sku_id, lot_number, normalized_lot_number, expiry_date, manufacture_date,
     first_receipt_date, sku_code_snapshot, created_at)
    VALUES (1,13,'LOT-13','LOT-13','2026-12-31','2026-01-01','2026-01-02','SKU-13',1)`);
  database = { query: (sql, params) => pool.query(sql, params), async withTransaction(work) {
    const tx = await pool.getConnection();
    try { await tx.beginTransaction(); const result = await work(tx); await tx.commit(); return result; }
    catch (error) { await tx.rollback(); throw error; }
    finally { tx.release(); }
  } };
  service = new InventoryTransferService({ database, logger, time });
  inquiry = new InventoryInquiryService({ database, time });
});
after(async () => { if (pool) await pool.end(); });

function line(overrides = {}) {
  return { skuId: 12, lotId: null, sourceBinId: 1, stockStatus: "AVAILABLE", quantity: 5, ...overrides };
}
function command(action, payload, eventId = randomUUID()) {
  return inventoryCommandFixture({ actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: `transfer.${action}`, requiredCallerPermission: "inventory.operation" },
    source: { module: "INVENTORY", documentType: "TRANSFER", documentId: "synthetic-task027", eventId },
    correlationId: eventId, payload });
}
function create(lines = [line()]) {
  return command("create", { sourceWarehouseId: 1, destinationWarehouseId: 2, lines });
}
async function rows(id) {
  return (await pool.query("SELECT * FROM inventory_transfer_lines WHERE transfer_id = ? ORDER BY line_number", [id]))[0];
}
function update(header, lines, overrides = {}) {
  return command("update", { transferId: header.id, expectedVersion: header.version,
    sourceWarehouseId: 1, destinationWarehouseId: 2, lines, ...overrides });
}
function retained(row, overrides = {}) {
  return line({ id: Number(row.id), expectedVersion: Number(row.version), ...overrides });
}
async function snapshot() {
  const result = {};
  for (const table of ["inventory_transfers", "inventory_transfer_lines", "inventory_operation_requests",
    "inventory_audit_logs", "inventory_stock_balances", "inventory_stock_controls", "inventory_movements"]) {
    result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`))[0];
  }
  return result;
}
async function rejectsUnchanged(work, code) {
  const before = await snapshot();
  await assert.rejects(work, { code });
  assert.deepEqual(await snapshot(), before);
}

integrationTest("TASK-027 real Draft creation stores canonical SKU/Lot snapshots with zero stock effects", async () => {
  const result = await service.create(create([line(), line({ skuId: 13, lotId: 1, quantity: 7 })]));
  const actual = await rows(result.id);
  assert.equal(result.status, "DRAFT");
  assert.equal(actual[1].sku_code_snapshot, "SKU-13");
  assert.equal(actual[1].lot_number_snapshot, "LOT-13");
  assert.equal(actual[1].expiry_date_snapshot.getFullYear(), 2026);
  assert.ok(actual.every((row) => Number(row.in_transit_quantity) === 0));
  const state = await snapshot();
  for (const table of ["inventory_stock_balances", "inventory_stock_controls", "inventory_movements"]) assert.deepEqual(state[table], []);
  assert.ok(state.inventory_audit_logs.some((row) => row.action === "transfer.create" && Number(row.target_id) === result.id));
});

integrationTest("TASK-027 complete replacement preserves owned IDs, reorders, removes and adds atomically", async () => {
  const header = await service.create(create([line(), line({ quantity: 6 }), line({ quantity: 7 })]));
  const old = await rows(header.id);
  const result = await service.update(update(header, [retained(old[1], { quantity: 8 }), retained(old[0]), line({ quantity: 9 })]));
  const actual = await rows(header.id);
  assert.equal(result.version, 2);
  assert.deepEqual(actual.map((row) => Number(row.line_number)), [1,2,3]);
  assert.deepEqual(actual.slice(0,2).map((row) => Number(row.id)), [Number(old[1].id), Number(old[0].id)]);
  assert.deepEqual(actual.map((row) => Number(row.version)), [2,2,1]);
  assert.ok(actual.every((row) => Number(row.id) !== Number(old[2].id)));
});

integrationTest("TASK-027 stale header and retained-line versions have no effects", async () => {
  const header = await service.create(create());
  const [old] = await rows(header.id);
  await rejectsUnchanged(() => service.update(update(header, [retained(old)], { expectedVersion: 2 })), "VERSION_CONFLICT");
  await rejectsUnchanged(() => service.update(update(header, [retained(old, { expectedVersion: 2 })])), "VERSION_CONFLICT");
});

integrationTest("TASK-027 cross-owner child IDs cannot be moved or deleted", async () => {
  const first = await service.create(create());
  const second = await service.create(create());
  const [foreign] = await rows(second.id);
  await rejectsUnchanged(() => service.update(update(first, [retained(foreign)])), "INVENTORY_RESOURCE_NOT_FOUND");
});

integrationTest("TASK-027 invalid last-line Bin or SKU/Lot ownership rolls back the whole document", async () => {
  const header = await service.create(create());
  for (const [invalid, code] of [[line({ sourceBinId: 2 }), "BIN_WAREHOUSE_MISMATCH"],
    [line({ lotId: 1 }), "LOT_DATA_CONFLICT"], [line({ sourceBinId: 999999 }), "BIN_INVALID"]]) {
    await rejectsUnchanged(() => service.update(update(header, [line(), invalid])), code);
  }
});

integrationTest("TASK-027 Draft cancellation retains lines and records actor/time/reason/Audit", async () => {
  const header = await service.create(create());
  const old = await rows(header.id);
  const result = await service.cancel(command("cancel", { transferId: header.id, expectedVersion: 1, reason: "No longer required" }));
  assert.equal(result.status, "CANCELLED");
  const [[stored]] = await pool.query("SELECT * FROM inventory_transfers WHERE id = ?", [header.id]);
  assert.equal(Number(stored.cancelled_by), 7);
  assert.equal(Number(stored.cancelled_at), time.nowMs());
  assert.equal(stored.reason, "No longer required");
  assert.deepEqual(await rows(header.id), old);
  await rejectsUnchanged(() => service.cancel(command("cancel", { transferId: header.id, expectedVersion: 2, reason: "again" })), "TRANSFER_STATE_CONFLICT");
});

integrationTest("TASK-027 read queries expose versions, stable paging and four states without mutations", async () => {
  for (const status of ["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"]) {
    const header = await service.create(create());
    // Fixture-only state, not Dispatch/Receive implementation or evidence.
    await pool.execute("UPDATE inventory_transfers SET status = ? WHERE id = ?", [status, header.id]);
    const before = await snapshot();
    const detail = await inquiry.getTransfer(header.id);
    assert.equal(detail.status, status);
    assert.equal(detail.version, 1);
    assert.equal(detail.lines[0].version, 1);
    assert.equal(detail.lines[0].inTransitQuantity, 0);
    assert.deepEqual(detail.movements, []);
    const list = await inquiry.listTransfers({ number: detail.number, status, sourceWarehouseId: 1,
      destinationWarehouseId: 2, createdFrom: time.nowMs(), createdTo: time.nowMs() });
    assert.deepEqual(list.items.map((item) => item.id), [header.id]);
    assert.equal(list.pageSize, 20);
    assert.deepEqual(await snapshot(), before);
  }
  await assert.rejects(inquiry.getTransfer(999999), { code: "INVENTORY_RESOURCE_NOT_FOUND" });
  await assert.rejects(inquiry.listTransfers({ pageSize: 101 }), { code: "INVENTORY_INPUT_INVALID" });
});

integrationTest("TASK-027 create/update/cancel replay original receipts after later mutations; conflicts reject", async () => {
  const original = create();
  const header = await service.create(original);
  const edit = update(header, [line({ quantity: 6 })]);
  const edited = await service.update(edit);
  const cancel = command("cancel", { transferId: header.id, expectedVersion: edited.version, reason: "done" });
  const cancelled = await service.cancel(cancel);
  const before = await snapshot();
  assert.deepEqual(await service.create(original), header);
  assert.deepEqual(await service.update(edit), edited);
  assert.deepEqual(await service.cancel(cancel), cancelled);
  assert.deepEqual(await snapshot(), before);
  await rejectsUnchanged(() => service.create({ ...original, payload: { ...original.payload, reason: "changed" } }), "INVENTORY_SOURCE_CONFLICT");
});

integrationTest("TASK-027 audit failure rolls back real create, replacement and cancellation transactions", async () => {
  const failing = new InventoryTransferService({ database, logger, time,
    audit: { recordSucceeded: async () => { throw new Error("synthetic audit failure"); } } });
  const header = await service.create(create());
  for (const [action, input] of [["create", create()], ["update", update(header, [line({ quantity: 9 })])],
    ["cancel", command("cancel", { transferId: header.id, expectedVersion: 1, reason: "cancel" })]]) {
    const before = await snapshot();
    await assert.rejects(failing[action](input), /synthetic audit failure/u);
    assert.deepEqual(await snapshot(), before);
  }
});

integrationTest("TASK-027 same-version competing replacement and cancellation serialize with one winner", async () => {
  const header = await service.create(create());
  const barrier = createInventoryBarrier();
  const real = new InventoryOperationService();
  const competing = new InventoryTransferService({ database, logger, time, operations: {
    claim: async (...args) => { const claimed = await real.claim(...args); await barrier.wait(); return claimed; },
    complete: (...args) => real.complete(...args)
  } });
  const results = await Promise.allSettled([competing.update(update(header, [line({ quantity: 9 })])),
    competing.cancel(command("cancel", { transferId: header.id, expectedVersion: 1, reason: "cancel" }))]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(["CONCURRENT_OPERATION", "VERSION_CONFLICT", "TRANSFER_STATE_CONFLICT"].includes(results.find((result) => result.status === "rejected").reason.code));
  assert.equal((await inquiry.getTransfer(header.id)).version, 2);
});

integrationTest("TASK-027 fresh authorization rejects revoked permissions even on replay", async () => {
  const input = create();
  await service.create(input);
  await pool.query("DELETE FROM role_permissions WHERE role_id = 1");
  try { await rejectsUnchanged(() => service.create(input), "PERMISSION_STALE"); }
  finally { await pool.query("INSERT INTO role_permissions SELECT 1, id FROM permissions WHERE name = 'inventory.operation'"); }
});

integrationTest("TASK-027 validates Active warehouses/Bins and tracking policy; non-Draft edits/cancel reject", async () => {
  for (const [table, code] of [["inventory_warehouses", "WAREHOUSE_INVALID"], ["inventory_bins", "BIN_INVALID"]]) {
    await pool.query(`UPDATE ${table} SET status = 'INACTIVE' WHERE id = 1`);
    try { await rejectsUnchanged(() => service.create(create()), code); }
    finally { await pool.query(`UPDATE ${table} SET status = 'ACTIVE' WHERE id = 1`); }
  }
  await rejectsUnchanged(() => service.create(create([line({ skuId: 14 })])), "SERIAL_TRACKING_UNSUPPORTED");
  for (const status of ["IN_TRANSIT", "RECEIVED"]) {
    const header = await service.create(create());
    await pool.execute("UPDATE inventory_transfers SET status = ? WHERE id = ?", [status, header.id]);
    await rejectsUnchanged(() => service.update(update(header, [line()])), "TRANSFER_STATE_CONFLICT");
    await rejectsUnchanged(() => service.cancel(command("cancel", { transferId: header.id, expectedVersion: 1, reason: "cancel" })), "TRANSFER_STATE_CONFLICT");
  }
  const state = await snapshot();
  for (const table of ["inventory_stock_balances", "inventory_stock_controls", "inventory_movements"]) assert.deepEqual(state[table], []);
});

integrationTest("TASK-027 Draft lifecycle leaves existing OnHand/Allocated/Reserved rows and versions byte-identical", async () => {
  const [balance] = await pool.execute(`INSERT INTO inventory_stock_balances
    (warehouse_id, bin_id, sku_id, stock_status, on_hand_quantity, allocated_quantity, version, created_at, updated_at)
    VALUES (1,1,12,'AVAILABLE',9,2,7,1,1)`);
  const [control] = await pool.execute(`INSERT INTO inventory_stock_controls
    (warehouse_id, sku_id, reserved_quantity, version, created_at, updated_at) VALUES (1,12,7,9,1,1)`);
  try {
    const before = await snapshot();
    // Draft is not stock posting: even quantities above ATP are allowed until Dispatch revalidation.
    const header = await service.create(create([line({ quantity: 5000 })]));
    const edited = await service.update(update(header, [line({ quantity: 6000 })]));
    await service.cancel(command("cancel", { transferId: header.id, expectedVersion: edited.version, reason: "no dispatch" }));
    const after = await snapshot();
    for (const table of ["inventory_stock_balances", "inventory_stock_controls", "inventory_movements"]) assert.deepEqual(after[table], before[table]);
  } finally {
    await pool.execute("DELETE FROM inventory_stock_balances WHERE id = ?", [balance.insertId]);
    await pool.execute("DELETE FROM inventory_stock_controls WHERE id = ?", [control.insertId]);
  }
});

integrationTest("TASK-027 complete replacement can change Active warehouse scope with new owned source Bins", async () => {
  const header = await service.create(create());
  const [old] = await rows(header.id);
  const edited = await service.update(update(header, [retained(old, { sourceBinId: 2 })],
    { sourceWarehouseId: 2, destinationWarehouseId: 3, reason: "new route" }));
  const detail = await inquiry.getTransfer(header.id);
  assert.equal(detail.sourceWarehouseId, 2);
  assert.equal(detail.destinationWarehouseId, 3);
  assert.equal(detail.lines[0].sourceBinId, 2);
  await rejectsUnchanged(() => service.update(update(edited, [line({ sourceBinId: 1 })],
    { sourceWarehouseId: 2, destinationWarehouseId: 3 })), "BIN_WAREHOUSE_MISMATCH");
});
