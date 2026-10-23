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
import { InventoryOperationService } from "../../src/modules/inventory/InventoryOperationService.js";
import { InventoryReservationService } from "../../src/modules/inventory/InventoryReservationService.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { InventoryLockService } from "../../src/modules/inventory/InventoryLockService.js";
import { normalizeAdjustmentCommand } from "../../src/modules/inventory/inventoryAdjustmentPosting.js";
import { normalizeReversalCommand } from "../../src/modules/inventory/inventoryReversalPosting.js";
import { issueInventoryHighRiskContext } from "../../src/modules/inventory/inventoryHighRiskContext.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";
import { createInventoryBarrier } from "../../test-support/fakeInventoryDatabase.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_MOVEMENT_TESTS === "1";
const integrationTest = enabled ? test : test.skip;
const time = { nowMs: () => 1790899200000, fileDate: () => "2026-10-02" };
const logger = { error() {} };
let pool, database, service;

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
    `CREATE TABLE user_devices (id BIGINT UNSIGNED PRIMARY KEY, user_id BIGINT UNSIGNED, device_id CHAR(64),
      public_key VARBINARY(512), status VARCHAR(20), UNIQUE (user_id, device_id)) ENGINE=InnoDB`,
    "CREATE TABLE fr_token_versions (subject VARCHAR(190) PRIMARY KEY, version BIGINT UNSIGNED) ENGINE=InnoDB",
    `CREATE TABLE permissions (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(190) UNIQUE,
      description VARCHAR(255) DEFAULT '', created_at BIGINT UNSIGNED) ENGINE=InnoDB`,
    "CREATE TABLE items (id BIGINT UNSIGNED PRIMARY KEY, name VARCHAR(190), product_type VARCHAR(20), status VARCHAR(20), version INT UNSIGNED NOT NULL DEFAULT 1) ENGINE=InnoDB",
    `CREATE TABLE item_skus (id BIGINT UNSIGNED PRIMARY KEY, item_id BIGINT UNSIGNED, sku_code VARCHAR(190),
      sku_name VARCHAR(190), status VARCHAR(20), purchasable BOOLEAN DEFAULT 1, sellable BOOLEAN DEFAULT 1,
      inventory_tracked BOOLEAN DEFAULT 1, tracking_policy VARCHAR(20), shelf_life_days INT,
      min_receipt_life_days INT, min_sale_life_days INT, effective_from DATE, effective_to DATE,
      version INT UNSIGNED NOT NULL DEFAULT 1) ENGINE=InnoDB`,
    `CREATE TABLE item_uoms (id BIGINT UNSIGNED PRIMARY KEY, code VARCHAR(20), name VARCHAR(100) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active', version INT UNSIGNED NOT NULL DEFAULT 1) ENGINE=InnoDB`,
    `CREATE TABLE item_sku_uoms (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      sku_id BIGINT UNSIGNED, uom_id BIGINT UNSIGNED, to_base_factor DECIMAL(18,6),
      is_base BOOLEAN, is_default_purchase BOOLEAN, is_default_sale BOOLEAN,
      version INT UNSIGNED NOT NULL DEFAULT 1) ENGINE=InnoDB`
  ]) await pool.query(ddl);
  for (const migrate of [permissions, operations, audit, master, stock, movements, reservations, transfers]) await migrate(pool);
  await pool.query("INSERT INTO users VALUES (7, 'synthetic-operator', 'active')");
  await pool.query("INSERT INTO roles VALUES (1, 'warehouse-operator')");
  await pool.query("INSERT INTO user_roles VALUES (7, 1)");
  await pool.query("INSERT INTO role_permissions SELECT 1, id FROM permissions WHERE name = 'inventory.operation'");
  await pool.query("INSERT INTO users VALUES (8, 'synthetic-adjuster', 'active')");
  await pool.query("INSERT INTO roles VALUES (2, 'inventory-adjuster')");
  await pool.query("INSERT INTO user_roles VALUES (8, 2)");
  await pool.query("INSERT INTO role_permissions SELECT 2, id FROM permissions WHERE name IN ('inventory.view','inventory.adjust')");
  await pool.execute("INSERT INTO user_devices VALUES (1, 8, ?, ?, 'approved')", ["a".repeat(64), Buffer.from("synthetic-public-key")]);
  await pool.query("INSERT INTO items (id,name,product_type,status) VALUES (1, 'Synthetic', 'physical', 'active')");
  await pool.query(`INSERT INTO item_skus (id, item_id, sku_code, sku_name, status, tracking_policy)
    VALUES (12, 1, 'SKU-12', 'Synthetic plain', 'active', 'none'),
           (13, 1, 'SKU-13', 'Synthetic expiry', 'active', 'batch_expiry'),
           (14, 1, 'SKU-14', 'Synthetic serial', 'active', 'serial')`);
  await pool.query("INSERT INTO item_uoms (id, code, name) VALUES (1, 'EA', 'Each')");
  await pool.query(`INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,is_default_purchase,is_default_sale)
    VALUES (12,1,1,1,1,1), (13,1,1,1,1,1), (14,1,1,1,1,1)`);
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
  service = new InventoryPostingService({ database, logger, time });
  for (const binId of [4,5]) await pool.execute(`INSERT INTO inventory_bins
    (id,warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,1,?,?,1,1)`,
    [binId, `BIN-${binId}`, `BIN-${binId}`]);
});
after(async () => { if (pool) await pool.end(); });

let nextSku = 100;
async function fixture({ onHand = 10, allocated = 0, status = 'AVAILABLE', expiry = null, destination = null } = {}) {
  const skuId = nextSku++;
  await pool.execute(`INSERT INTO item_skus (id,item_id,sku_code,sku_name,status,tracking_policy)
    VALUES (?,1,?,?,'active',?)`, [skuId, `SKU-${skuId}`, `Synthetic ${skuId}`, expiry ? 'batch_expiry' : 'none']);
  await pool.execute(`INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,is_default_purchase,is_default_sale)
    VALUES (?,1,1,1,1,1)`, [skuId]);
  let lotId = null;
  if (expiry) {
    const [lot] = await pool.execute(`INSERT INTO inventory_lots
      (sku_id,lot_number,normalized_lot_number,expiry_date,first_receipt_date,sku_code_snapshot,created_at)
      VALUES (?,?,?,?,'2026-01-01',?,1)`, [skuId, `LOT-${skuId}`, `LOT-${skuId}`, expiry, `SKU-${skuId}`]);
    lotId = Number(lot.insertId);
  }
  const [balance] = await pool.execute(`INSERT INTO inventory_stock_balances
    (warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,allocated_quantity,fifo_anchor_date,version,created_at,updated_at)
    VALUES (1,1,?,?,?, ?,?,'2026-01-01',1,1,1)`, [skuId, lotId, status, onHand, allocated]);
  let destinationId = null;
  if (destination !== null) {
    const [row] = await pool.execute(`INSERT INTO inventory_stock_balances
      (warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,allocated_quantity,fifo_anchor_date,version,created_at,updated_at)
      VALUES (1,4,?,?,?, ?,0,'2026-02-01',3,1,1)`, [skuId, lotId, status, destination]);
    destinationId = Number(row.insertId);
  }
  return { skuId, lotId, balanceId: Number(balance.insertId), destinationId,
    line: { sourceBalanceId: Number(balance.insertId), destinationBinId: 4, quantity: 2,
      expectedSourceVersion: 1, expectedDestinationVersion: destination === null ? null : 3 } };
}
function move(lines, extra = {}, eventId = randomUUID()) {
  return inventoryCommandFixture({ actor: { claimedPermissions: ['inventory.operation'] },
    authorization: { purpose: 'bin_move.post', requiredCallerPermission: 'inventory.operation' },
    source: { module: 'INVENTORY', documentType: 'BIN_MOVE', documentId: 'synthetic-task030', eventId },
    correlationId: eventId, payload: { warehouseId: 1, lines, ...extra } });
}
async function snapshot() {
  const result = {};
  for (const table of ['inventory_lots', 'inventory_stock_balances', 'inventory_stock_controls', 'inventory_operation_requests',
    'inventory_movements', 'inventory_audit_logs', 'inventory_reservations', 'inventory_allocations',
    'inventory_transfers', 'inventory_transfer_lines']) result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`))[0];
  return result;
}
async function rejectsUnchanged(work, code) {
  const before = await snapshot();
  await assert.rejects(work, { code });
  assert.deepEqual(await snapshot(), before);
}
async function balances(skuId) { return (await pool.query('SELECT * FROM inventory_stock_balances WHERE sku_id = ? ORDER BY bin_id', [skuId]))[0]; }
async function movementRows(group) { return (await pool.query('SELECT * FROM inventory_movements WHERE movement_group_id = ? ORDER BY id', [group]))[0]; }

function adjustment(payload, action = "adjustment.post", eventId = randomUUID()) {
  return inventoryCommandFixture({ actor: { userId: 8, claimedRoles: ["inventory-adjuster"], claimedPermissions: ["inventory.view", "inventory.adjust"] },
    authorization: { purpose: action, requiredCallerPermission: "inventory.adjust" },
    source: { module: "INVENTORY", documentType: action === "adjustment.post" ? "ADJUSTMENT" : "STATUS_TRANSFER",
      documentId: "synthetic-task031", eventId }, correlationId: eventId,
    payload: { quantity: 2, uomId: 1, reasonText: "Synthetic physical inspection", ...payload } });
}
function prepareAdjustment(command, clock = time, signal = new AbortController().signal) {
  const reverse = command.authorization.purpose === "movement.reverse";
  const normalized = reverse ? normalizeReversalCommand({ query() {}, execute() {} }, command)
    : normalizeAdjustmentCommand({ query() {}, execute() {} }, command, command.authorization.purpose);
  const now = clock.nowMs(), deviceId = "a".repeat(64);
  const req = { method: "POST", ...(reverse ? { input: { params: { id: String(normalized.payload.movementId) } } } : {}),
    apiRoute: { authType: "jwt-device-password", path: reverse ? "/api/v1/inventory/movements/:id/reverse" : command.authorization.purpose === "adjustment.post"
    ? "/api/v1/inventory/adjustments" : "/api/v1/inventory/status-transfers" },
    auth: { type: "jwt-device-password", claims: { sub: "8", roles: normalized.actor.claimedRoles,
      permissions: normalized.actor.claimedPermissions, did: deviceId, exp: Math.floor(now / 1000) + 900,
      auth_time: Math.floor(now / 1000), ver: 0 }, deviceBinding: { id: 1, user_id: 8, device_id: deviceId,
      public_key: Buffer.from("synthetic-public-key"), status: "approved" } },
    requestTimeout: { signal }, get: () => String(now) };
  return { command: normalized, context: issueInventoryHighRiskContext(req, normalized, { time: clock,
    signatureMaxSkewSeconds: 60, sessionMaxAgeSeconds: 28800, clockToleranceSeconds: 5 }) };
}
function submitAdjustment(command, posting = service, clock = time, signal) {
  const prepared = prepareAdjustment(command, clock, signal);
  return command.authorization.purpose === "movement.reverse" ? posting.reverseMovement(prepared.command, prepared.context)
    : command.authorization.purpose === "adjustment.post" ? posting.postAdjustment(prepared.command, prepared.context)
    : posting.postStatusTransfer(prepared.command, prepared.context);
}
function increase(f, extra = {}) {
  return adjustment({ direction: "IN", warehouseId: 1, binId: 1, skuId: f.skuId, stockStatus: "AVAILABLE",
    expectedBalanceVersion: 1, reasonCategory: "COUNT_GAIN", ...extra });
}

integrationTest("ADJ031-UOM native Pack conversion, credential-free intent and original replay survive changed current factor", async () => {
  const f = await fixture();
  await pool.query("INSERT INTO item_uoms (id,code,name) VALUES (2,'CASE','Case')");
  await pool.execute(`INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,is_default_purchase,is_default_sale)
    VALUES (?,2,12,0,0,0)`, [f.skuId]);
  const input = increase(f, { uomId: 2 });
  const result = await submitAdjustment(input);
  assert.equal(result.baseQuantity, 24); assert.deepEqual(result.inputUom, { id: 2, code: "CASE" });
  const before = await snapshot();
  await pool.execute("UPDATE item_sku_uoms SET to_base_factor = 9 WHERE sku_id = ? AND uom_id = 2", [f.skuId]);
  assert.deepEqual(await submitAdjustment(input), result);
  assert.deepEqual(await snapshot(), before);
  const [[operation]] = await pool.query("SELECT request_hash, result_summary FROM inventory_operation_requests WHERE id = ?", [result.operationId]);
  assert.doesNotMatch(JSON.stringify(operation), /password|signature|context|token/u);
  await rejectsUnchanged(() => submitAdjustment({ ...input, payload: { ...input.payload, quantity: 3 } }), "INVENTORY_SOURCE_CONFLICT");
});

integrationTest("ADJ031-STATUS native six different directions conserve On Hand, Allocation and Reserved", async () => {
  for (const from of ["AVAILABLE", "QUARANTINED", "DAMAGED"]) for (const to of ["AVAILABLE", "QUARANTINED", "DAMAGED"]) {
    if (from === to) continue;
    const f = await fixture({ status: from, allocated: 2 });
    const result = await submitAdjustment(adjustment({ sourceBalanceId: f.balanceId, destinationStatus: to,
      expectedSourceVersion: 1, expectedDestinationVersion: null }, "status_transfer.post"));
    assert.equal(result.lineCount, 2);
    const rows = await balances(f.skuId);
    assert.equal(rows.reduce((sum, row) => sum + Number(row.on_hand_quantity), 0), 10);
    assert.equal(rows.reduce((sum, row) => sum + Number(row.allocated_quantity), 0), 2);
    assert.deepEqual((await movementRows(result.movementGroupId)).map(row => [row.direction, row.stock_status, Number(row.quantity)]),
      [["OUT",from,2],["IN",to,2]]);
  }
});

integrationTest("ADJ031-IN-LOT native creation/exact NULL dates and receipt minimum-life remain all-or-none", async () => {
  const f = await fixture({ expiry: "2026-12-31" });
  const input = increase(f, { expectedBalanceVersion: null, lotNumber: " NEW-031 ", expiryDate: "2027-01-01" });
  const result = await submitAdjustment(input);
  const [[lot]] = await pool.query("SELECT id, DATE_FORMAT(first_receipt_date,'%Y-%m-%d') AS first_receipt_date, manufacture_date, created_by FROM inventory_lots WHERE sku_id = ? AND normalized_lot_number = 'NEW-031'", [f.skuId]);
  assert.equal(lot.first_receipt_date, time.fileDate()); assert.equal(lot.manufacture_date, null);
  assert.equal(Number(lot.created_by), 8);
  const [[created]] = await pool.query("SELECT id,version,DATE_FORMAT(fifo_anchor_date,'%Y-%m-%d') AS fifo_anchor_date FROM inventory_stock_balances WHERE lot_id = ?", [lot.id]);
  assert.equal(created.fifo_anchor_date, time.fileDate());
  await rejectsUnchanged(() => submitAdjustment(increase(f, { expectedBalanceVersion: Number(created.version), lotNumber: "NEW-031",
    expiryDate: "2027-01-01", manufactureDate: "2026-01-01" })), "LOT_DATA_CONFLICT");
  for (const stockStatus of ["AVAILABLE", "QUARANTINED", "DAMAGED"]) {
    await rejectsUnchanged(() => submitAdjustment(increase(f, { expectedBalanceVersion: null, stockStatus,
      lotNumber: `EXPIRED-${stockStatus}`, expiryDate: "2026-10-01" })), "LOT_EXPIRED");
  }
  await pool.execute("UPDATE item_skus SET min_receipt_life_days = 60 WHERE id = ?", [f.skuId]);
  await rejectsUnchanged(() => submitAdjustment(increase(f, { expectedBalanceVersion: null, stockStatus: "DAMAGED",
    lotNumber: "SHORT-031", expiryDate: "2026-10-03" })), "LOT_MINIMUM_LIFE_FAILED");
  assert.equal((await movementRows(result.movementGroupId)).length, 1);
});

integrationTest("ADJ031-OUT-RESERVED native negative protects free stock/current eligible coverage but permits expired uncovered reduction", async () => {
  for (const options of [{ allocated: 9 }, { expiry: "2026-01-01" }, {}]) {
    const f = await fixture(options);
    await pool.execute(`INSERT INTO inventory_stock_controls (warehouse_id,sku_id,reserved_quantity,created_at,updated_at)
      VALUES (1,?,10,1,1)`, [f.skuId]);
    const input = adjustment({ direction: "OUT", balanceId: f.balanceId, expectedBalanceVersion: 1, reasonCategory: "DAMAGE" });
    if (options.allocated) await rejectsUnchanged(() => submitAdjustment(input), "INSUFFICIENT_STOCK");
    else if (!options.expiry) await rejectsUnchanged(() => submitAdjustment(input), "INSUFFICIENT_ATP");
    else {
      await submitAdjustment(input);
      assert.equal(Number((await balances(f.skuId))[0].on_hand_quantity), 8);
      const [[control]] = await pool.query("SELECT reserved_quantity FROM inventory_stock_controls WHERE sku_id = ?", [f.skuId]);
      assert.equal(Number(control.reserved_quantity), 10);
    }
  }
});

integrationTest("ADJ031-LOCKS-VERSION native competing expected-absent requests produce one post and one complete rollback", async () => {
  const f = await fixture();
  const input = increase(f, { stockStatus: "DAMAGED", expectedBalanceVersion: null });
  const results = await Promise.allSettled([submitAdjustment(input), submitAdjustment({ ...input,
    source: { ...input.source, eventId: randomUUID() } })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "VERSION_CONFLICT");
  assert.equal((await balances(f.skuId)).filter(row => row.stock_status === "DAMAGED").length, 1);
  await rejectsUnchanged(() => submitAdjustment(increase(f, { quantity: Number.MAX_SAFE_INTEGER })), "INVENTORY_QUANTITY_INVALID");
});

integrationTest("INT034-ADJUST-VERSION existing OnHand10 same-version OUT4 requests have one complete winner", async () => {
  const f = await fixture();
  const barrier = createInventoryBarrier(), real = new InventoryOperationService();
  const posting = new InventoryPostingService({ database, logger, time, operations: {
    claim: async (...args) => { const result = await real.claim(...args); await barrier.wait(); return result; },
    complete: (...args) => real.complete(...args)
  } });
  const inputs = [0, 1].map(() => adjustment({ direction: "OUT", balanceId: f.balanceId, quantity: 4,
    expectedBalanceVersion: 1, reasonCategory: "DAMAGE" }));
  const before = await snapshot();
  const results = await Promise.allSettled(inputs.map(input => submitAdjustment(input, posting)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "VERSION_CONFLICT");
  const winner = results.find(result => result.status === "fulfilled").value;
  const after = await snapshot(), rows = await balances(f.skuId);
  assert.deepEqual(rows.map(row => [Number(row.on_hand_quantity), Number(row.allocated_quantity), Number(row.version)]), [[6, 0, 2]]);
  assert.deepEqual(after.inventory_movements.slice(0, before.inventory_movements.length), before.inventory_movements);
  assert.equal(after.inventory_movements.length - before.inventory_movements.length, 1);
  const added = after.inventory_operation_requests.slice(before.inventory_operation_requests.length);
  assert.equal(added.length, 1); assert.equal(Number(added[0].id), winner.operationId); assert.ok(added[0].completed_at);
  const audits = after.inventory_audit_logs.slice(before.inventory_audit_logs.length);
  assert.equal(audits.length, 1); assert.equal(audits[0].action, "adjustment.post"); assert.equal(audits[0].outcome, "SUCCEEDED");
  for (const table of ["inventory_lots", "inventory_reservations", "inventory_allocations", "inventory_transfers", "inventory_transfer_lines"])
    assert.deepEqual(after[table], before[table]);
});

integrationTest("INT034-IMMUTABLE actual Movement and Audit UPDATE DELETE triggers preserve complete history", async () => {
  const f = await fixture(), result = await service.postBinMove(move([f.line]));
  const before = await snapshot();
  for (const table of ["inventory_movements", "inventory_audit_logs"]) {
    const row = before[table].find(row => Number(row.operation_request_id) === result.operationId);
    assert.ok(row);
    for (const sql of [`UPDATE ${table} SET id = id WHERE id = ?`, `DELETE FROM ${table} WHERE id = ?`]) {
      await assert.rejects(() => pool.execute(sql, [row.id]),
        { code: "ER_SIGNAL_EXCEPTION", sqlState: "45000", sqlMessage: `${table} is immutable` });
      assert.deepEqual(await snapshot(), before);
    }
  }
});

integrationTest("INT034-RESERVED-MOVE eligible unallocated Reservation keeps its accounting during same-Warehouse Move", async () => {
  const f = await fixture(), reservations = new InventoryReservationService({ database, logger, time });
  await reservations.create(inventoryCommandFixture({ actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: "reservation.create", requiredCallerPermission: "inventory.operation" },
    source: { eventId: randomUUID() }, payload: { skuId: f.skuId, warehouseId: 1, quantity: 4, purpose: "SALE", minimumRemainingDays: 0 } }));
  const before = await snapshot();
  await service.postBinMove(move([{ ...f.line, quantity: 7 }]));
  const after = await snapshot();
  for (const table of ["inventory_stock_controls", "inventory_reservations", "inventory_allocations"]) assert.deepEqual(after[table], before[table]);
  assert.deepEqual((await balances(f.skuId)).map(row => [Number(row.on_hand_quantity), Number(row.allocated_quantity)]), [[3, 0], [7, 0]]);
  assert.deepEqual(after.inventory_movements.slice(0, before.inventory_movements.length), before.inventory_movements);
});

integrationTest("ADJ031-ROLLBACK native failure after first Status leg and new Lot creation leaves no business artifacts", async () => {
  await pool.query("CREATE TRIGGER task031_reject_audit BEFORE INSERT ON inventory_audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic task031 audit failure'");
  try {
    const f = await fixture({ expiry: "2026-12-31" });
    const before = await snapshot(), lotsBefore = (await pool.query("SELECT * FROM inventory_lots ORDER BY id"))[0];
    for (const input of [increase(f, { lotNumber: "ROLLBACK-031", expiryDate: "2027-01-01", expectedBalanceVersion: null }),
      adjustment({ sourceBalanceId: f.balanceId, destinationStatus: "DAMAGED", expectedSourceVersion: 1, expectedDestinationVersion: null }, "status_transfer.post")]) {
      await assert.rejects(() => submitAdjustment(input), error => (error?.cause?.code ?? error?.code) === "ER_SIGNAL_EXCEPTION");
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual((await pool.query("SELECT * FROM inventory_lots ORDER BY id"))[0], lotsBefore);
    }
  } finally { await pool.query("DROP TRIGGER task031_reject_audit"); }
});

integrationTest("ADJ031-REVOKE-ORDER native revocation committed during stock wait defeats stale RR snapshot and rolls back", async () => {
  for (const phase of ["warehouse", "new-lot-bucket"]) for (const kind of ["permission", "role", "user", "device", "token", "admin-token-first"]) {
    const f = await fixture(phase === "warehouse" ? {} : { expiry: "2026-12-31" });
    const blocker = await pool.getConnection(), writer = await pool.getConnection();
    let arrived;
    const atStock = new Promise(resolve => { arrived = resolve; });
    const posting = new InventoryPostingService({ database, logger, time });
    if (phase === "warehouse") {
      const original = posting.locks.lockForCommand.bind(posting.locks);
      posting.locks.lockForCommand = async (...args) => { arrived(); return original(...args); };
    } else {
      const original = posting.resolveReceiptLotInTransaction.bind(posting);
      posting.resolveReceiptLotInTransaction = async (...args) => {
        const lot = await original(...args);
        assert.equal(lot.created_by, null, "new Lot must not implicitly lock users before Bucket waits");
        arrived(); return lot;
      };
    }
    const before = await snapshot();
    let pending;
    try {
      await blocker.beginTransaction();
      if (phase === "warehouse") await blocker.query("SELECT id FROM inventory_warehouses WHERE id = 1 FOR UPDATE");
      else await blocker.query("SELECT id FROM inventory_stock_balances WHERE warehouse_id = 1 AND sku_id = ? FOR UPDATE", [f.skuId]);
      const input = phase === "warehouse" ? increase(f) : increase(f, { lotNumber: "WAIT-031", expiryDate: "2027-01-01", expectedBalanceVersion: null });
      pending = submitAdjustment(input, posting).then(result => ({ result }), error => ({ error }));
      await atStock;
      await writer.query("SET SESSION innodb_lock_wait_timeout = 2");
      if (kind === "permission") await writer.query("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = 2 AND p.name = 'inventory.adjust'");
      if (kind === "role") await writer.query("DELETE FROM user_roles WHERE user_id = 8 AND role_id = 2");
      if (kind === "user" || kind === "admin-token-first") {
        if (kind === "admin-token-first") await writer.query("INSERT INTO fr_token_versions VALUES ('8',1)");
        await writer.query("UPDATE users SET status = 'inactive' WHERE id = 8");
      }
      if (kind === "device") await writer.query("UPDATE user_devices SET status = 'revoked' WHERE id = 1");
      if (kind === "token") await writer.query("INSERT INTO fr_token_versions VALUES ('8',1)");
      // Each autocommit writer has finished before the stock blocker is released.
      await blocker.commit();
      const outcome = await pending;
      assert.equal(outcome.error?.code, kind === "device" ? "DEVICE_REVOKED" : kind === "token" ? "JWT_INVALID" : "PERMISSION_STALE");
      assert.deepEqual(await snapshot(), before);
    } finally {
      await blocker.rollback(); blocker.release();
      if (pending) await pending;
      if (kind === "permission") await pool.query("INSERT INTO role_permissions SELECT 2,id FROM permissions WHERE name = 'inventory.adjust'");
      if (kind === "role") await pool.query("INSERT INTO user_roles VALUES (8,2)");
      if (kind === "user" || kind === "admin-token-first") await pool.query("UPDATE users SET status = 'active' WHERE id = 8");
      if (kind === "device") await pool.query("UPDATE user_devices SET status = 'approved' WHERE id = 1");
      if (kind === "token" || kind === "admin-token-first") await pool.query("DELETE FROM fr_token_versions WHERE subject = '8'");
      writer.release();
    }
  }
});

integrationTest("ADJ031-REVOKE-ORDER native final security locks serialize later revocation until posting completes", async () => {
  const f = await fixture(), writer = await pool.getConnection();
  let reached, release;
  const finalGuardHeld = new Promise(resolve => { reached = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  const wrapped = { async withTransaction(work) { return database.withTransaction(async tx => {
    const executor = { execute: (...args) => tx.execute(...args), query: async (sql, params) => {
      const result = await tx.query(sql, params);
      if (sql.includes("FROM fr_token_versions") && sql.includes("FOR SHARE")) { reached(); await resume; }
      return result;
    } };
    return work(executor);
  }); } };
  const posting = new InventoryPostingService({ database: wrapped, logger, time });
  const pending = submitAdjustment(increase(f), posting);
  try {
    await finalGuardHeld;
    await writer.query("SET SESSION innodb_lock_wait_timeout = 1");
    await assert.rejects(() => writer.query("UPDATE user_devices SET status = 'revoked' WHERE id = 1"), { code: "ER_LOCK_WAIT_TIMEOUT" });
    release(); await pending;
    await writer.query("UPDATE user_devices SET status = 'revoked' WHERE id = 1");
    await rejectsUnchanged(() => submitAdjustment(increase(f, { expectedBalanceVersion: 2 })), "DEVICE_REVOKED");
  } finally {
    release(); await pending.catch(() => {});
    await writer.query("UPDATE user_devices SET status = 'approved' WHERE id = 1"); writer.release();
  }
});

integrationTest("ADJ031-PROOF native signed-time expiry after stock locks rolls back Operation and zero destination", async () => {
  const f = await fixture(), before = await snapshot();
  let now = time.nowMs();
  const clock = { nowMs: () => now, fileDate: time.fileDate };
  const posting = new InventoryPostingService({ database, logger, time: clock });
  const original = posting.locks.lockBalancesAfterLot.bind(posting.locks);
  posting.locks.lockBalancesAfterLot = async (...args) => { const result = await original(...args); now += 60_001; return result; };
  await assert.rejects(() => submitAdjustment(increase(f, { stockStatus: "DAMAGED", expectedBalanceVersion: null }), posting, clock),
    { code: "DEVICE_SIGNATURE_STALE" });
  assert.deepEqual(await snapshot(), before);
});

integrationTest("ADJ031-ACTOR-BIND native exact successful attribution and replay do not backfill existing NULL Lot creators", async () => {
  const f = await fixture({ expiry: "2026-12-31" });
  const input = increase(f, { lotNumber: "ACTOR-031", expiryDate: "2027-01-01", expectedBalanceVersion: null });
  const result = await submitAdjustment(input);
  const [[operation]] = await pool.execute("SELECT actor_user_id,completed_at FROM inventory_operation_requests WHERE id = ?", [result.operationId]);
  assert.equal(Number(operation.actor_user_id), 8); assert.ok(operation.completed_at);
  const [[lot]] = await pool.execute("SELECT id,created_by FROM inventory_lots WHERE sku_id = ? AND normalized_lot_number = 'ACTOR-031'", [f.skuId]);
  assert.equal(Number(lot.created_by), 8);
  const beforeReplay = await snapshot();
  assert.deepEqual(await submitAdjustment(input), result);
  assert.deepEqual(await snapshot(), beforeReplay);
  await submitAdjustment(increase(f, { lotNumber: `LOT-${f.skuId}`, expiryDate: "2026-12-31" }));
  const [[existing]] = await pool.execute("SELECT created_by FROM inventory_lots WHERE id = ?", [f.lotId]);
  assert.equal(existing.created_by, null);
  for (const row of await movementRows(result.movementGroupId)) assert.equal(Number(row.posted_by), 8);
});

integrationTest("ADJ031-ACTOR-BIND native binding zero/DB error/deadline/abort reaches the intended stage and rolls back", async () => {
  for (const target of ["operation_requests", "lots"]) for (const failure of ["zero", "error", "deadline", "abort"]) {
    const f = await fixture({ expiry: "2026-12-31" }), before = await snapshot();
    let now = time.nowMs(), reached = false;
    const abort = new AbortController(), clock = { nowMs: () => now, fileDate: time.fileDate };
    const wrapped = { async withTransaction(work) { return database.withTransaction(tx => work({
      query: (...args) => tx.query(...args), execute: async (sql, params) => {
        const binding = sql.startsWith(`UPDATE inventory_${target} SET`) && sql.includes(target === "lots" ? "created_by = ?" : "actor_user_id = ?");
        if (!binding) return tx.execute(sql, params);
        reached = true;
        if (failure === "zero") return tx.execute(sql.replace("WHERE id = ?", "WHERE id = ? AND 1 = 0"), params);
        if (failure === "error") return tx.query("SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic actor bind failure'");
        const result = await tx.execute(sql, params);
        if (failure === "deadline") now += 60_001;
        if (failure === "abort") abort.abort(Object.assign(new Error("timeout"), { code: "REQUEST_TIMEOUT" }));
        return result;
      }
    })); } };
    const posting = new InventoryPostingService({ database: wrapped, logger, time: clock });
    await assert.rejects(() => submitAdjustment(increase(f, { lotNumber: "BIND-FAIL", expiryDate: "2027-01-01", expectedBalanceVersion: null }),
      posting, clock, abort.signal), error => (error?.cause?.code ?? error?.code) === (failure === "zero" ? "CONCURRENT_OPERATION"
        : failure === "error" ? "ER_SIGNAL_EXCEPTION" : failure === "deadline" ? "DEVICE_SIGNATURE_STALE" : "REQUEST_TIMEOUT"));
    assert.equal(reached, true);
    assert.deepEqual(await snapshot(), before);
  }
});

integrationTest("ADJ031-COMPATIBILITY native Receipt retains actor attribution and immutable DATE semantics for new and existing Lots", async () => {
  const f = await fixture({ expiry: "2026-12-31" });
  for (const lotNumber of [`LOT-${f.skuId}`, "RECEIPT-COMPAT-031"]) {
    const result = await service.postReceipt(inventoryCommandFixture({ actor: { claimedRoles: ["warehouse-operator"], claimedPermissions: ["inventory.operation"] },
      authorization: { purpose: "receipt.post", requiredCallerPermission: "inventory.operation" },
      source: { module: "INVENTORY", documentType: "RECEIPT", documentId: "synthetic-compat", eventId: randomUUID() },
      payload: { warehouseId: 1, binId: 1, skuId: f.skuId, uomId: 1, quantity: 1, stockStatus: "AVAILABLE", lotNumber, expiryDate: "2026-12-31" } }));
    assert.ok(result);
    const [[lot]] = await pool.execute("SELECT created_by,DATE_FORMAT(expiry_date,'%Y-%m-%d') AS expiry_date FROM inventory_lots WHERE sku_id = ? AND normalized_lot_number = ?", [f.skuId, lotNumber]);
    assert.equal(lot.expiry_date, "2026-12-31");
    assert.equal(lot.created_by === null ? null : Number(lot.created_by), lotNumber === "RECEIPT-COMPAT-031" ? 7 : null);
  }
});

integrationTest("ADJ031-DOMAIN-REPLAY real unique claim wait retains original result without recomputing changed stock or Item", async () => {
  const f = await fixture({ expiry: "2026-12-31" }), input = increase(f, { lotNumber: `LOT-${f.skuId}`, expiryDate: "2026-12-31" });
  let entered, release, attempted;
  const reached = new Promise(resolve => { entered = resolve; }), proceed = new Promise(resolve => { release = resolve; });
  const secondClaim = new Promise(resolve => { attempted = resolve; });
  const posting = new InventoryPostingService({ database, logger, time }), original = posting.operations.claim.bind(posting.operations);
  let calls = 0;
  posting.operations.claim = async (...args) => {
    const call = ++calls; if (call === 2) attempted();
    const result = await original(...args); if (call === 1) { entered(); await proceed; } return result;
  };
  const first = submitAdjustment(input, posting).then(result => ({ result }), error => ({ error }));
  let second;
  try {
    await reached;
    second = submitAdjustment(input, posting).then(result => ({ result }), error => ({ error }));
    await secondClaim; release();
    const results = await Promise.all([first, second]);
    for (const result of results) assert.ifError(result.error);
    assert.deepEqual(results[1].result, results[0].result);
    assert.equal((await movementRows(results[0].result.movementGroupId)).length, 1);
    await pool.execute("UPDATE item_skus SET status='inactive' WHERE id=?", [f.skuId]);
    await pool.execute("UPDATE inventory_lots SET expiry_date='2026-01-01' WHERE id=?", [f.lotId]);
    await pool.execute("UPDATE inventory_stock_balances SET on_hand_quantity=0,fifo_anchor_date=NULL,version=version+1 WHERE id=?", [f.balanceId]);
    const before = await snapshot();
    assert.deepEqual(await submitAdjustment(input), results[0].result); assert.deepEqual(await snapshot(), before);
  } finally { release(); await first; if (second) await second; }
});

integrationTest("ADJ031-LIFE-FIFO native DATE edges, minimum life, midnight wait and zero/positive anchors", async () => {
  for (const stockStatus of ["AVAILABLE", "QUARANTINED", "DAMAGED"]) {
    const f = await fixture({ expiry: "2026-12-31" });
    await submitAdjustment(increase(f, { lotNumber: "TODAY", expiryDate: time.fileDate(), stockStatus, expectedBalanceVersion: null }));
    await pool.execute("UPDATE item_skus SET min_receipt_life_days=60 WHERE id=?", [f.skuId]);
    await submitAdjustment(increase(f, { lotNumber: "EXACT-LIFE", expiryDate: "2026-12-01", stockStatus, expectedBalanceVersion: null }));
    await rejectsUnchanged(() => submitAdjustment(increase(f, { lotNumber: "SHORT-LIFE", expiryDate: "2026-11-30", stockStatus, expectedBalanceVersion: null })), "LOT_MINIMUM_LIFE_FAILED");
  }
  const f = await fixture(), anchor = async () => (await pool.query("SELECT DATE_FORMAT(fifo_anchor_date,'%Y-%m-%d') AS anchor FROM inventory_stock_balances WHERE id=?", [f.balanceId]))[0][0].anchor;
  await submitAdjustment(increase(f)); assert.equal(await anchor(), "2026-01-01");
  await submitAdjustment(adjustment({ direction: "OUT", balanceId: f.balanceId, expectedBalanceVersion: 2, quantity: 12, reasonCategory: "DAMAGE" }));
  assert.equal(await anchor(), null);
  await submitAdjustment(increase(f, { expectedBalanceVersion: 3 })); assert.equal(await anchor(), time.fileDate());
  let date = time.fileDate();
  const clock = { nowMs: time.nowMs, fileDate: () => date };
  const posting = new InventoryPostingService({ database, logger, time: clock }), original = posting.locks.lockBalancesAfterLot.bind(posting.locks);
  posting.locks.lockBalancesAfterLot = async (...args) => { const result = await original(...args); date = "2026-10-03"; return result; };
  await rejectsUnchanged(() => submitAdjustment(increase(f, { expectedBalanceVersion: 4 }), posting, clock), "CONCURRENT_OPERATION");
});

integrationTest("ADJ031-ROLLBACK every intended native write checkpoint rolls back new Lot, zero destination and both Status legs", async () => {
  const targets = [["operation",1],["lot",1],["zero_balance",1],["current_state",1],["movement",1],["audit",1],["complete",1],
    ["current_state",2],["movement",2],["audit",2]];
  for (const [target, occurrence] of targets) {
    const f = await fixture({ expiry: "2026-12-31" }), before = await snapshot();
    let count = 0, reached = false;
    function checkpoint(point) { if (point === target && ++count === occurrence) { reached = true; throw Object.assign(new Error("synthetic rollback"), { faultPoint: target }); } }
    const wrapped = { async withTransaction(work) { return database.withTransaction(tx => work({
      query: (...args) => tx.query(...args), checkpoint, execute: async (sql, params) => {
        const result = await tx.execute(sql, params);
        if (sql.startsWith("INSERT INTO inventory_lots")) checkpoint("lot");
        if (sql.startsWith("INSERT INTO inventory_stock_balances")) checkpoint("zero_balance");
        if (sql.includes("SET result_type = ?")) checkpoint("complete");
        return result;
      }
    })); } };
    const posting = new InventoryPostingService({ database: wrapped, logger, time });
    const input = occurrence === 2 ? adjustment({ sourceBalanceId: f.balanceId, destinationStatus: "DAMAGED",
      expectedSourceVersion: 1, expectedDestinationVersion: null }, "status_transfer.post")
      : increase(f, { lotNumber: "ROLLBACK-STAGE", expiryDate: "2027-01-01", expectedBalanceVersion: null });
    await assert.rejects(() => submitAdjustment(input, posting), { faultPoint: target });
    assert.equal(reached, true, `${target}/${occurrence} must actually be reached`); assert.deepEqual(await snapshot(), before);
  }
});

integrationTest('TASK-030 native multi-line document preserves Lot/status/BaseUOM and stores chained immutable paired legs', async () => {
  const f = await fixture({ expiry: '2026-12-31', status: 'QUARANTINED' });
  const result = await service.postBinMove(move([f.line, { ...f.line, quantity: 3 }], { reason: '  same warehouse  ' }));
  assert.deepEqual(Object.keys(result).sort(), ['lineCount', 'movementGroupId', 'operationId', 'status']);
  assert.equal(result.lineCount, 2);
  const rows = await movementRows(result.movementGroupId);
  assert.deepEqual(rows.map(r => [r.direction, Number(r.quantity), Number(r.balance_before), Number(r.balance_after), Number(r.balance_version_after)]),
    [['OUT',2,10,8,2],['IN',2,0,2,2],['OUT',3,8,5,3],['IN',3,2,5,3]]);
  assert.ok(rows.every(r => r.movement_type === 'BIN_MOVE' && r.location_kind === 'BIN' && Number(r.lot_id) === f.lotId &&
    r.stock_status === 'QUARANTINED' && r.reason_text === 'same warehouse' && Number(r.posted_by) === 7));
  assert.deepEqual((await balances(f.skuId)).map(r => [Number(r.on_hand_quantity),Number(r.allocated_quantity),Number(r.version)]), [[5,0,3],[5,0,3]]);
  const [[operation]] = await pool.query('SELECT * FROM inventory_operation_requests WHERE id = ?', [result.operationId]);
  assert.equal(operation.command_type, 'BIN_MOVE_POST');
  assert.deepEqual(typeof operation.result_summary === 'string' ? JSON.parse(operation.result_summary) : operation.result_summary, result);
  const [audits] = await pool.query('SELECT * FROM inventory_audit_logs WHERE operation_request_id = ? ORDER BY id', [result.operationId]);
  assert.equal(audits.length, 4);
  assert.ok(audits.every(r => r.action === 'bin_move.post' && r.outcome === 'SUCCEEDED'));
  await assert.rejects(() => pool.execute('UPDATE inventory_movements SET quantity = 1 WHERE id = ?', [rows[0].id]),
    { code: 'ER_SIGNAL_EXCEPTION', sqlState: '45000', sqlMessage: 'inventory_movements is immutable' });
  assert.deepEqual(await movementRows(result.movementGroupId), rows);
});

integrationTest('TASK-030 destination presence, source version and shared starting-version conflicts leave zero effects', async () => {
  for (const destination of [null, 4]) {
    const f = await fixture({ destination });
    for (const lines of [[{ ...f.line, expectedSourceVersion: 9 }],
      [{ ...f.line, expectedDestinationVersion: destination === null ? 1 : null }],
      [f.line, { ...f.line, expectedSourceVersion: 2 }]]) {
      await rejectsUnchanged(() => service.postBinMove(move(lines)), 'VERSION_CONFLICT');
    }
  }
});

integrationTest('TASK-030 gross OUT cannot use incoming quantities or consume allocated stock', async () => {
  const f = await fixture({ onHand: 5, allocated: 2, destination: 5 });
  await rejectsUnchanged(() => service.postBinMove(move([{ ...f.line, quantity: 4 }])), 'INSUFFICIENT_STOCK');
  const incoming = { sourceBalanceId: f.destinationId, destinationBinId: 1, quantity: 2, expectedSourceVersion: 3, expectedDestinationVersion: 1 };
  await rejectsUnchanged(() => service.postBinMove(move([incoming, { ...f.line, quantity: 4 }])), 'INSUFFICIENT_STOCK');
  await service.postBinMove(move([{ ...f.line, quantity: 3 }]));
  assert.deepEqual((await balances(f.skuId)).map(r => Number(r.allocated_quantity)), [2,0]);
});

integrationTest('TASK-030 natural expiry/uncovered Reservation does not block a conserving Move or change Control', async () => {
  const f = await fixture({ expiry: '2026-01-01' });
  // Real Reservation before natural expiry; posting uses the later fixed clock above.
  const reservations = new InventoryReservationService({ database, logger,
    time: { nowMs: () => Date.parse('2025-12-31T00:00:00Z'), fileDate: () => '2025-12-31' } });
  await reservations.create(inventoryCommandFixture({ actor: { claimedPermissions: ['inventory.operation'] },
    authorization: { purpose: 'reservation.create', requiredCallerPermission: 'inventory.operation' },
    source: { eventId: randomUUID() }, payload: { skuId: f.skuId, warehouseId: 1, quantity: 10, purpose: 'SALE', minimumRemainingDays: 0 } }));
  const before = (await pool.query('SELECT * FROM inventory_stock_controls WHERE sku_id = ?', [f.skuId]))[0];
  const beforeReservation = (await pool.query('SELECT * FROM inventory_reservations WHERE sku_id = ?', [f.skuId]))[0];
  await service.postBinMove(move([f.line]));
  assert.deepEqual((await pool.query('SELECT * FROM inventory_stock_controls WHERE sku_id = ?', [f.skuId]))[0], before);
  assert.deepEqual((await pool.query('SELECT * FROM inventory_reservations WHERE sku_id = ?', [f.skuId]))[0], beforeReservation);
  assert.equal((await balances(f.skuId)).reduce((sum,r) => sum + Number(r.on_hand_quantity), 0), 10);
});

integrationTest('TASK-030 FIFO clears exhausted source, initializes absent destination, retains positive destination anchor', async () => {
  for (const destination of [null, 4]) {
    const f = await fixture({ onHand: 2, destination });
    await service.postBinMove(move([f.line]));
    const actual = await balances(f.skuId);
    assert.equal(actual[0].fifo_anchor_date, null);
    const [[row]] = await pool.query("SELECT DATE_FORMAT(fifo_anchor_date,'%Y-%m-%d') AS anchor FROM inventory_stock_balances WHERE id = ?", [actual[1].id]);
    assert.equal(row.anchor, destination === null ? time.fileDate() : '2026-02-01');
  }
});

integrationTest('TASK-030 source replay returns original scalar receipt and reauthorizes without re-reading changed stock', async () => {
  const f = await fixture();
  const input = move([f.line, { ...f.line, quantity: 1 }], { reason: '  move  ' });
  const first = await service.postBinMove(input);
  const before = await snapshot();
  assert.deepEqual(await service.postBinMove({ ...input, payload: { ...input.payload, reason: 'move' } }), first);
  assert.deepEqual(await snapshot(), before);
  await rejectsUnchanged(() => service.postBinMove({ ...input, payload: { ...input.payload, lines: [...input.payload.lines].reverse() } }), 'INVENTORY_SOURCE_CONFLICT');
  await pool.query('DELETE FROM role_permissions WHERE role_id = 1');
  try { await assert.rejects(() => service.postBinMove(input), { code: 'PERMISSION_STALE' }); }
  finally { await pool.query("INSERT INTO role_permissions SELECT 1,id FROM permissions WHERE name = 'inventory.operation'"); }
  assert.deepEqual(await snapshot(), before);
});

integrationTest('TASK-030 strict body, source/destination ownership and inactive Bin reject without state changes', async () => {
  const f = await fixture();
  const missingVersion = { ...f.line };
  delete missingVersion.expectedDestinationVersion;
  for (const [input, code] of [[move([{ ...f.line, destinationBinId: 2 }]), 'BIN_WAREHOUSE_MISMATCH'],
    [move([{ ...f.line, destinationBinId: 1 }]), 'INVENTORY_INPUT_INVALID'],
    [move([{ ...f.line, quantity: '2' }]), 'INVENTORY_QUANTITY_INVALID'],
    [move([{ ...f.line, skuId: f.skuId }]), 'INVENTORY_INPUT_INVALID'],
    [move([missingVersion]), 'INVENTORY_INPUT_INVALID'],
    [move([f.line], { reason: 'a\u007fb' }), 'INVENTORY_INPUT_INVALID']]) await rejectsUnchanged(() => service.postBinMove(input), code);
  await pool.query("UPDATE inventory_bins SET status = 'INACTIVE' WHERE id = 4");
  try { await rejectsUnchanged(() => service.postBinMove(move([f.line])), 'BIN_INVALID'); }
  finally { await pool.query("UPDATE inventory_bins SET status = 'ACTIVE' WHERE id = 4"); }
});

integrationTest('TASK-030 injected P4 Counting signal rejects source or destination; no real Stocktake workflow claimed', async () => {
  const f = await fixture();
  for (const binId of [1,4]) {
    const real = new InventoryLockService();
    const blocked = new InventoryPostingService({ database, logger, time, locks: {
      lockForCommand: async (...args) => ({ ...await real.lockForCommand(...args), binLocks: [{ bin_id: binId, released_at: null }] }),
      lockBalancesAfterLot: (...args) => real.lockBalancesAfterLot(...args)
    } });
    await rejectsUnchanged(() => blocked.postBinMove(move([f.line])), 'BIN_LOCKED_BY_STOCKTAKE');
  }
});

function competingOperations() {
  const barrier = createInventoryBarrier();
  const real = new InventoryOperationService();
  return { claim: async (...args) => { const result = await real.claim(...args); await barrier.wait(); return result; },
    complete: (...args) => real.complete(...args) };
}
integrationTest('TASK-030 deterministic same-version Move race has one whole-document winner', async () => {
  const f = await fixture();
  const competing = new InventoryPostingService({ database, logger, time, operations: competingOperations() });
  const results = await Promise.allSettled([competing.postBinMove(move([f.line,f.line])), competing.postBinMove(move([f.line,f.line]))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'VERSION_CONFLICT');
  assert.deepEqual((await balances(f.skuId)).map(r => Number(r.on_hand_quantity)), [6,4]);
  assert.equal((await movementRows(results.find(r => r.status === 'fulfilled').value.movementGroupId)).length, 4);
});

integrationTest('TASK-030 current read detects destination created after source discovery despite repeatable-read snapshot', async () => {
  const f = await fixture();
  let discovered;
  const reached = new Promise(resolve => { discovered = resolve; });
  let release;
  const resume = new Promise(resolve => { release = resolve; });
  const gatedDb = { withTransaction: work => database.withTransaction(tx => work({
    execute: tx.execute.bind(tx), query: async (sql, params) => {
      const result = await tx.query(sql, params);
      if (sql.includes('LEFT JOIN inventory_lots')) { discovered(); await resume; }
      return result;
    }
  })) };
  const gated = new InventoryPostingService({ database: gatedDb, logger, time });
  const pending = gated.postBinMove(move([f.line]));
  const rejection = assert.rejects(() => pending, { code: 'VERSION_CONFLICT' });
  await reached;
  try {
    const receipt = inventoryCommandFixture({ actor: { claimedPermissions: ['inventory.operation'] },
      authorization: { purpose: 'receipt.post', requiredCallerPermission: 'inventory.operation' },
      source: { eventId: randomUUID() }, payload: { skuId: f.skuId, warehouseId: 1, binId: 4, quantity: 1, uomId: 1, stockStatus: 'AVAILABLE' } });
    await service.postReceipt(receipt);
  } finally { release(); }
  const afterReceipt = await snapshot();
  await rejection;
  assert.deepEqual(await snapshot(), afterReceipt);
  assert.deepEqual((await balances(f.skuId)).map(r => Number(r.on_hand_quantity)), [10,1]);
});

integrationTest('TASK-030 injected mid-leg, Audit, Operation completion and pre-commit failures roll back entire real transaction', async () => {
  const f = await fixture();
  for (const [needle, nth] of [['UPDATE inventory_stock_balances',2], ['INSERT INTO inventory_movements',3],
    ['INSERT INTO inventory_audit_logs',3], ['UPDATE inventory_operation_requests',1], ['PRE_COMMIT',1]]) {
    let writes = 0;
    const failingDb = { withTransaction: work => database.withTransaction(async tx => {
      const result = await work({ query: tx.query.bind(tx), execute: async (sql, params) => {
        if (sql.includes(needle) && ++writes === nth) throw new Error('synthetic task030 failure');
        return tx.execute(sql, params);
      } });
      if (needle === 'PRE_COMMIT') throw new Error('synthetic task030 failure');
      return result;
    }) };
    const failing = new InventoryPostingService({ database: failingDb, logger, time });
    const before = await snapshot();
    await assert.rejects(() => failing.postBinMove(move([f.line,f.line])), /synthetic task030 failure/u);
    assert.deepEqual(await snapshot(), before);
  }
});

integrationTest('TASK-030 Move vs Dispatch serializes Control and has no overspend or partial loser', async () => {
  const f = await fixture({ onHand: 5 });
  const transfer = new InventoryTransferService({ database, logger, time });
  const transferCommand = (action, payload) => inventoryCommandFixture({ actor: { claimedPermissions: ['inventory.operation'] },
    authorization: { purpose: `transfer.${action}`, requiredCallerPermission: 'inventory.operation' }, source: { eventId: randomUUID() }, payload });
  const draft = await transfer.create(transferCommand('create', { sourceWarehouseId: 1, destinationWarehouseId: 2,
    lines: [{ skuId: f.skuId, lotId: null, sourceBinId: 1, stockStatus: 'AVAILABLE', quantity: 4 }] }));
  const operations = competingOperations();
  const posting = new InventoryPostingService({ database, logger, time, operations });
  const dispatch = new InventoryTransferService({ database, logger, time, operations });
  const results = await Promise.allSettled([posting.postBinMove(move([{ ...f.line, quantity: 4 }])),
    dispatch.dispatch(transferCommand('dispatch', { transferId: draft.id, expectedVersion: 1 }))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(['VERSION_CONFLICT','INSUFFICIENT_STOCK','INSUFFICIENT_ATP'].includes(results.find(r => r.status === 'rejected').reason.code));
  assert.equal(Number((await balances(f.skuId))[0].on_hand_quantity), 1);
  const [[legs]] = await pool.query('SELECT COUNT(*) AS n FROM inventory_movements WHERE sku_id = ?', [f.skuId]);
  assert.equal(Number(legs.n), 2);
});

integrationTest('TASK-030 Move vs Issue preserves allocated stock and Reservation accounting under deterministic race', async () => {
  const f = await fixture({ onHand: 10 });
  const reservations = new InventoryReservationService({ database, logger, time });
  const reserveCommand = (purpose, payload) => inventoryCommandFixture({ actor: { claimedPermissions: ['inventory.operation'] },
    authorization: { purpose, requiredCallerPermission: 'inventory.operation' }, source: { eventId: randomUUID() }, payload });
  const reserved = await reservations.create(reserveCommand('reservation.create', { skuId: f.skuId, warehouseId: 1, quantity: 4, purpose: 'SALE', minimumRemainingDays: 0 }));
  const allocated = await reservations.allocate(reserveCommand('allocation.create', { reservationId: reserved.id, expectedVersion: reserved.version,
    allocations: [{ balanceId: f.balanceId, expectedVersion: 1, quantity: 4 }] }));
  const allocation = allocated.allocations[0];
  const posting = new InventoryPostingService({ database, logger, time, operations: competingOperations() });
  const issue = reserveCommand('issue.post', { reservationId: reserved.id, expectedVersion: allocated.version,
    lines: [{ allocationId: allocation.id, expectedVersion: allocation.version, balanceId: f.balanceId,
      expectedBalanceVersion: allocation.balanceVersion, quantity: 4 }] });
  const results = await Promise.allSettled([posting.postBinMove(move([{ ...f.line, quantity: 7, expectedSourceVersion: allocation.balanceVersion }])), posting.postIssue(issue)]);
  assert.equal(results[0].status, 'rejected');
  assert.ok(['VERSION_CONFLICT','INSUFFICIENT_STOCK'].includes(results[0].reason.code));
  assert.equal(results[1].status, 'fulfilled');
  assert.deepEqual((await balances(f.skuId)).map(r => [Number(r.on_hand_quantity),Number(r.allocated_quantity)]), [[6,0]]);
  const [[control]] = await pool.query('SELECT reserved_quantity FROM inventory_stock_controls WHERE sku_id = ?', [f.skuId]);
  assert.equal(Number(control.reserved_quantity), 0);
});

integrationTest('TASK-030 unsafe aggregate arithmetic and exhausted Balance version reject before any writes', async () => {
  const f = await fixture({ onHand: 5, destination: Number.MAX_SAFE_INTEGER });
  await rejectsUnchanged(() => service.postBinMove(move([f.line])), 'INVENTORY_QUANTITY_INVALID');
  const second = await fixture();
  await pool.execute('UPDATE inventory_stock_balances SET version = 4294967295 WHERE id = ?', [second.balanceId]);
  await rejectsUnchanged(() => service.postBinMove(move([{ ...second.line, expectedSourceVersion: 4294967295 }])), 'CONCURRENT_OPERATION');
});

integrationTest('TASK-030 mixed SKU/Lot/status documents conserve each scope and reject a late invalid destination atomically', async () => {
  const plain = await fixture();
  const batch = await fixture({ expiry: '2026-12-31', status: 'DAMAGED', destination: 7 });
  await rejectsUnchanged(() => service.postBinMove(move([plain.line, { ...batch.line, destinationBinId: 2 }])), 'BIN_WAREHOUSE_MISMATCH');
  const result = await service.postBinMove(move([plain.line, batch.line]));
  assert.equal(result.lineCount, 2);
  const legs = await movementRows(result.movementGroupId);
  assert.deepEqual(legs.map(r => [Number(r.sku_id),r.stock_status, r.lot_id === null ? null : Number(r.lot_id)]),
    [[plain.skuId,'AVAILABLE',null],[plain.skuId,'AVAILABLE',null],[batch.skuId,'DAMAGED',batch.lotId],[batch.skuId,'DAMAGED',batch.lotId]]);
  assert.deepEqual((await balances(plain.skuId)).map(r => Number(r.on_hand_quantity)), [8,2]);
  assert.deepEqual((await balances(batch.skuId)).map(r => Number(r.on_hand_quantity)), [8,9]);
});

async function reversal(original, extra = {}, eventId = randomUUID(), anchor) {
  const rows = await movementRows(original.movementGroupId);
  const [guards] = await pool.query(`SELECT DISTINCT b.id AS balanceId, b.version AS expectedVersion
    FROM inventory_stock_balances b JOIN inventory_movements m ON m.warehouse_id=b.warehouse_id
      AND m.bin_id=b.bin_id AND m.sku_id=b.sku_id AND COALESCE(m.lot_id,0)=b.lot_scope AND m.stock_status=b.stock_status
    WHERE m.movement_group_id=? ORDER BY b.id`, [original.movementGroupId]);
  const command = adjustment({}, "movement.reverse", eventId);
  command.source.documentType = "REVERSAL";
  command.payload = { movementId: anchor ?? Number(rows[0].id), reasonText: "Synthetic full group compensation",
    expectedBalances: guards.map(row => ({ balanceId: Number(row.balanceId), expectedVersion: Number(row.expectedVersion) })), ...extra };
  return command;
}
function receipt(f, quantity = 2) {
  return service.postReceipt(inventoryCommandFixture({ actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: "receipt.post", requiredCallerPermission: "inventory.operation" },
    source: { module: "INVENTORY", documentType: "RECEIPT", documentId: "synthetic-task032", eventId: randomUUID() },
    payload: { warehouseId: 1, binId: 1, skuId: f.skuId, uomId: 1, quantity, stockStatus: "AVAILABLE",
      ...(f.lotId ? { lotNumber: `LOT-${f.skuId}`, expiryDate: "2026-12-31" } : {}) } }));
}

integrationTest("REV032-RECEIPT native historical version5 uses current9 after legitimate later events and retains immutable original", async () => {
  const f = await fixture();
  await pool.execute("UPDATE inventory_stock_balances SET version=4 WHERE id=?", [f.balanceId]);
  const original = await receipt(f), history = await movementRows(original.movementGroupId);
  assert.equal(Number(history[0].balance_version_after), 5);
  for (const version of [5,6,7,8]) await submitAdjustment(increase(f, { quantity: 1, expectedBalanceVersion: version }));
  const input = await reversal(original);
  assert.equal(input.payload.expectedBalances[0].expectedVersion, 9);
  await rejectsUnchanged(() => submitAdjustment({ ...input, payload: { ...input.payload,
    expectedBalances: [{ balanceId: f.balanceId, expectedVersion: 5 }] } }), "VERSION_CONFLICT");
  const result = await submitAdjustment(input), [row] = await balances(f.skuId);
  assert.deepEqual([Number(row.on_hand_quantity), Number(row.version)], [14,10]);
  assert.deepEqual(await movementRows(original.movementGroupId), history);
  const [leg] = await movementRows(result.movementGroupId);
  assert.deepEqual([leg.movement_type, leg.direction, Number(leg.quantity), Number(leg.reversal_of_movement_id), Number(leg.posted_by)],
    ["REVERSAL","OUT",2,Number(history[0].id),8]);
  const [[operation]] = await pool.execute("SELECT actor_user_id,result_summary FROM inventory_operation_requests WHERE id=?", [result.operationId]);
  assert.equal(Number(operation.actor_user_id), 8); assert.deepEqual(operation.result_summary, result);
});

integrationTest("REV032-ADJUSTMENT native both directions at all three statuses undo Base quantity without historical updates", async () => {
  for (const status of ["AVAILABLE","QUARANTINED","DAMAGED"]) for (const direction of ["IN","OUT"]) {
    const f = await fixture({ status });
    const original = await submitAdjustment(direction === "IN" ? increase(f, { stockStatus: status })
      : adjustment({ direction, balanceId: f.balanceId, expectedBalanceVersion: 1, reasonCategory: "DAMAGE" }));
    const history = await movementRows(original.movementGroupId), result = await submitAdjustment(await reversal(original));
    assert.equal(Number((await balances(f.skuId))[0].on_hand_quantity), 10);
    assert.deepEqual(await movementRows(original.movementGroupId), history);
    assert.equal((await movementRows(result.movementGroupId))[0].direction, direction === "IN" ? "OUT" : "IN");
  }
});

integrationTest("REV032-PAIRS native shared-bucket BinMove and six Status pairs reverse descending IDs with chained versions", async () => {
  const f = await fixture();
  const original = await service.postBinMove(move([f.line, f.line])), history = await movementRows(original.movementGroupId);
  const result = await submitAdjustment(await reversal(original)), legs = await movementRows(result.movementGroupId);
  assert.deepEqual(legs.map(row => Number(row.reversal_of_movement_id)), history.map(row => Number(row.id)).reverse());
  assert.deepEqual(legs.map(row => Number(row.balance_version_after)), [4,4,5,5]);
  assert.deepEqual((await balances(f.skuId)).map(row => Number(row.on_hand_quantity)), [10,0]);
  for (const from of ["AVAILABLE","QUARANTINED","DAMAGED"]) for (const to of ["AVAILABLE","QUARANTINED","DAMAGED"]) {
    if (from === to) continue;
    const item = await fixture({ status: from });
    const posted = await submitAdjustment(adjustment({ sourceBalanceId: item.balanceId, destinationStatus: to,
      expectedSourceVersion: 1, expectedDestinationVersion: null }, "status_transfer.post"));
    const reversed = await submitAdjustment(await reversal(posted));
    assert.equal(reversed.lineCount, 2);
    const rows = await balances(item.skuId);
    assert.equal(Number(rows.find(row => row.stock_status === from).on_hand_quantity), 10);
    assert.equal(Number(rows.find(row => row.stock_status === to).on_hand_quantity), 0);
  }
});

integrationTest("REV032-ISSUE native full consumed Issue restores stock but never revives Reservation or Allocation", async () => {
  const f = await fixture(), reservationService = new InventoryReservationService({ database, logger, time });
  const command = (purpose, payload) => inventoryCommandFixture({ actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose, requiredCallerPermission: "inventory.operation" }, source: { eventId: randomUUID() }, payload });
  const reserved = await reservationService.create(command("reservation.create", { skuId: f.skuId, warehouseId: 1, quantity: 4, purpose: "SALE", minimumRemainingDays: 0 }));
  const allocated = await reservationService.allocate(command("allocation.create", { reservationId: reserved.id, expectedVersion: reserved.version,
    allocations: [{ balanceId: f.balanceId, expectedVersion: 1, quantity: 4 }] }));
  const allocation = allocated.allocations[0];
  const original = await service.postIssue(command("issue.post", { reservationId: reserved.id, expectedVersion: allocated.version,
    lines: [{ allocationId: allocation.id, expectedVersion: allocation.version, balanceId: f.balanceId,
      expectedBalanceVersion: allocation.balanceVersion, quantity: 4 }] }));
  const before = await snapshot(), result = await submitAdjustment(await reversal(original)), after = await snapshot();
  for (const table of ["inventory_reservations","inventory_allocations","inventory_stock_controls"]) assert.deepEqual(after[table], before[table]);
  assert.deepEqual([Number((await balances(f.skuId))[0].on_hand_quantity), Number((await balances(f.skuId))[0].allocated_quantity)], [10,0]);
  const [leg] = await movementRows(result.movementGroupId);
  assert.equal(leg.reservation_id, null); assert.equal(leg.allocation_id, null); assert.equal(Number(leg.quantity), 4);
});

integrationTest("INT034-RECONCILE chained paired Adjustment Status and Reversal groups match every Bucket delta", async () => {
  const f = await fixture();
  const key = row => [row.warehouse_id, row.bin_id, row.sku_id, row.lot_id, row.stock_status].join(":");
  async function checked(work) {
    const before = await snapshot(), result = await work(), after = await snapshot();
    const legs = await movementRows(result.movementGroupId), changes = new Map();
    assert.ok(legs.length);
    assert.ok(legs.every(row => Number(row.operation_request_id) === result.operationId));
    for (const row of legs) changes.set(key(row), (changes.get(key(row)) ?? 0) + (row.direction === "IN" ? 1 : -1) * Number(row.quantity));
    const previous = new Map(before.inventory_stock_balances.map(row => [key(row), Number(row.on_hand_quantity)]));
    for (const row of after.inventory_stock_balances) {
      assert.equal(Number(row.on_hand_quantity) - (previous.get(key(row)) ?? 0), changes.get(key(row)) ?? 0);
      previous.delete(key(row)); changes.delete(key(row));
    }
    assert.ok([...previous.values()].every(quantity => quantity === 0)); assert.equal(changes.size, 0);
    assert.deepEqual(after.inventory_movements.slice(0, before.inventory_movements.length), before.inventory_movements);
    const operation = after.inventory_operation_requests.find(row => Number(row.id) === result.operationId);
    assert.ok(operation.completed_at);
    const summary = typeof operation.result_summary === "string" ? JSON.parse(operation.result_summary) : operation.result_summary;
    assert.equal(summary.movementGroupId, result.movementGroupId);
    const audits = after.inventory_audit_logs.filter(row => Number(row.operation_request_id) === result.operationId);
    assert.equal(audits.length, legs.length); assert.ok(audits.every(row => row.outcome === "SUCCEEDED"));
    return result;
  }
  const moved = await checked(() => service.postBinMove(move([f.line, f.line])));
  const adjusted = await checked(() => submitAdjustment(increase(f, { expectedBalanceVersion: 3 })));
  const destination = (await balances(f.skuId)).find(row => Number(row.bin_id) === 4);
  const status = await checked(() => submitAdjustment(adjustment({ sourceBalanceId: Number(destination.id),
    destinationStatus: "DAMAGED", expectedSourceVersion: Number(destination.version), expectedDestinationVersion: null }, "status_transfer.post")));
  for (const original of [status, adjusted, moved]) {
    const history = await movementRows(original.movementGroupId);
    const reversed = await checked(async () => submitAdjustment(await reversal(original)));
    assert.deepEqual((await movementRows(reversed.movementGroupId)).map(row => Number(row.reversal_of_movement_id)),
      history.map(row => Number(row.id)).reverse());
  }
  assert.equal(Number((await balances(f.skuId)).find(row => Number(row.id) === f.balanceId).on_hand_quantity), 10);
});

integrationTest("REV032-VERSIONS native complete guards reject absent/missing/extra buckets and never create historical placeholders", async () => {
  const f = await fixture(), original = await service.postBinMove(move([f.line])), input = await reversal(original);
  for (const expectedBalances of [input.payload.expectedBalances.slice(0,1),
    [...input.payload.expectedBalances, { balanceId: 999999, expectedVersion: 1 }]]) {
    await rejectsUnchanged(() => submitAdjustment({ ...input, payload: { ...input.payload, expectedBalances } }), "REVERSAL_NOT_ALLOWED");
  }
  const [rows] = await balances(f.skuId);
  await pool.execute("DELETE FROM inventory_stock_balances WHERE id=?", [rows.id]);
  await rejectsUnchanged(() => submitAdjustment(input), "REVERSAL_NOT_ALLOWED");
});

integrationTest("REV032-RESERVED native Control coverage and gross OUT refuse Allocated or future inverse IN funding", async () => {
  const f = await fixture(), original = await receipt(f);
  await pool.execute("UPDATE inventory_stock_balances SET allocated_quantity=11 WHERE id=?", [f.balanceId]);
  await rejectsUnchanged(() => reversal(original).then(submitAdjustment), "REVERSAL_NOT_ALLOWED");
  await pool.execute("UPDATE inventory_stock_balances SET allocated_quantity=0 WHERE id=?", [f.balanceId]);
  await pool.execute("UPDATE inventory_stock_controls SET reserved_quantity=11 WHERE sku_id=?", [f.skuId]);
  await rejectsUnchanged(() => reversal(original).then(submitAdjustment), "REVERSAL_NOT_ALLOWED");
  const pair = await fixture(), posted = await service.postBinMove(move([pair.line, { ...pair.line, sourceBalanceId: pair.balanceId,
    destinationBinId: 4 }]));
  const rows = await balances(pair.skuId);
  await pool.execute("UPDATE inventory_stock_balances SET allocated_quantity=1 WHERE id=?", [rows.find(row => Number(row.bin_id) === 4).id]);
  await rejectsUnchanged(() => reversal(posted).then(submitAdjustment), "REVERSAL_NOT_ALLOWED");
});

integrationTest("REV032-LOT-LIFE-FIFO native expired original IN compensation preserves Lot dates/creator and never funds uncovered Sale Reserved", async () => {
  const f = await fixture({ onHand: 2, expiry: "2026-10-01" });
  const original = await submitAdjustment(adjustment({ direction: "OUT", balanceId: f.balanceId, expectedBalanceVersion: 1,
    quantity: 2, reasonCategory: "EXPIRY" }));
  await pool.execute("UPDATE item_skus SET min_receipt_life_days=90,min_sale_life_days=90 WHERE id=?", [f.skuId]);
  await pool.execute("UPDATE inventory_stock_controls SET reserved_quantity=3 WHERE sku_id=?", [f.skuId]);
  const before = await snapshot(), result = await submitAdjustment(await reversal(original));
  assert.deepEqual((await snapshot()).inventory_lots, before.inventory_lots);
  assert.deepEqual((await snapshot()).inventory_stock_controls, before.inventory_stock_controls);
  const [[row]] = await pool.execute("SELECT on_hand_quantity,DATE_FORMAT(fifo_anchor_date,'%Y-%m-%d') AS anchor FROM inventory_stock_balances WHERE id=?", [f.balanceId]);
  assert.deepEqual([Number(row.on_hand_quantity),row.anchor], [2,time.fileDate()]);
  const [[leg]] = await pool.execute("SELECT DATE_FORMAT(expiry_date_snapshot,'%Y-%m-%d') AS expiry FROM inventory_movements WHERE movement_group_id=?", [result.movementGroupId]);
  assert.equal(leg.expiry, "2026-10-01");
});

integrationTest("REV032-ONCE native different sources discover old RR snapshot but only one complete group wins", async () => {
  const f = await fixture(), original = await service.postBinMove(move([f.line])), history = await movementRows(original.movementGroupId);
  const inputs = [await reversal(original), await reversal(original, {}, randomUUID(), Number(history[1].id))];
  let arrived, release;
  const reached = new Promise(resolve => { arrived = resolve; }), proceed = new Promise(resolve => { release = resolve; });
  let discoveries = 0;
  const wrapped = { withTransaction: work => database.withTransaction(tx => work({
    execute: (...args) => tx.execute(...args), query: async (sql, params) => {
      const result = await tx.query(sql, params);
      if (sql.includes("FROM inventory_movements m") && !sql.includes("FOR UPDATE") && ++discoveries <= 2) {
        if (discoveries === 2) arrived(); await proceed;
      }
      return result;
    }
  })) };
  const posting = new InventoryPostingService({ database: wrapped, logger, time });
  const pending = inputs.map(input => submitAdjustment(input, posting).then(result => ({ result }), error => ({ error })));
  try { await reached; release(); const results = await Promise.all(pending);
    assert.equal(results.filter(row => row.result).length, 1);
    assert.equal(results.find(row => row.error).error.code, "MOVEMENT_ALREADY_REVERSED");
    const winner = results.find(row => row.result).result;
    assert.equal((await movementRows(winner.movementGroupId)).length, history.length);
    const [links] = await pool.query("SELECT reversal_of_movement_id FROM inventory_movements WHERE reversal_of_movement_id IN (?,?)", history.map(row => row.id));
    assert.equal(links.length, 2);
    // Fault only the redundant link read: the actual native unique constraint is the last defence.
    const backup = await fixture(), onceOriginal = await receipt(backup);
    await submitAdjustment(await reversal(onceOriginal));
    let nativeDuplicate = false;
    const omittedRead = { withTransaction: work => database.withTransaction(tx => work({
      query: (sql,params) => sql.includes("WHERE reversal_of_movement_id IN") ? Promise.resolve([[]]) : tx.query(sql,params),
      execute: async (sql,params) => {
        try { return await tx.execute(sql,params); }
        catch (error) {
          if (sql.startsWith("INSERT INTO inventory_movements")) {
            assert.equal(error.code,"ER_DUP_ENTRY"); assert.match(error.sqlMessage,/uq_inventory_movement_reversal/u);
            nativeDuplicate = true;
          }
          throw error;
        }
      }
    })) };
    const lastDefence = new InventoryPostingService({ database:omittedRead,logger,time });
    await rejectsUnchanged(() => reversal(onceOriginal).then(command => submitAdjustment(command,lastDefence)),"MOVEMENT_ALREADY_REVERSED");
    assert.equal(nativeDuplicate,true);
  } finally { release(); await Promise.all(pending); }
});

integrationTest("REV032-DOMAIN-REPLAY native source claim wait retains original four scalars despite changed stock and Item", async () => {
  const f = await fixture(), original = await receipt(f), input = await reversal(original);
  let arrived, release, attempted;
  const reached = new Promise(resolve => { arrived = resolve; }), proceed = new Promise(resolve => { release = resolve; });
  const secondClaim = new Promise(resolve => { attempted = resolve; });
  const posting = new InventoryPostingService({ database, logger, time }), claim = posting.operations.claim.bind(posting.operations);
  let calls = 0;
  posting.operations.claim = async (...args) => {
    const call = ++calls; if (call === 2) attempted();
    const result = await claim(...args); if (call === 1) { arrived(); await proceed; } return result;
  };
  const first = submitAdjustment(input, posting).then(result => ({ result }), error => ({ error }));
  let second;
  try {
    await reached; second = submitAdjustment(input, posting).then(result => ({ result }), error => ({ error }));
    await secondClaim; release(); const results = await Promise.all([first,second]);
    for (const result of results) assert.ifError(result.error);
    assert.deepEqual(results[0].result, results[1].result);
    await pool.execute("UPDATE item_skus SET status='inactive' WHERE id=?", [f.skuId]);
    await pool.execute("UPDATE inventory_stock_balances SET on_hand_quantity=0,fifo_anchor_date=NULL,version=version+1 WHERE id=?", [f.balanceId]);
    const before = await snapshot(); assert.deepEqual(await submitAdjustment(input), results[0].result);
    assert.deepEqual(await snapshot(), before);
    await rejectsUnchanged(() => submitAdjustment({ ...input, payload: { ...input.payload, reasonText: "Changed intent" } }), "INVENTORY_SOURCE_CONFLICT");
  } finally { release(); await first; if (second) await second; }
});

integrationTest("REV032-REVOKE-ORDER native Warehouse/Lot/Bucket waits accept committed revocation then reject stale proof atomically", async () => {
  for (const phase of ["warehouse","lot","balance"]) for (const kind of ["permission","role","user","device","token"]) {
    const f = await fixture({ expiry: "2026-12-31" }), original = await receipt(f), input = await reversal(original);
    const before = await snapshot(), blocker = await pool.getConnection(), writer = await pool.getConnection();
    let arrived;
    const reached = new Promise(resolve => { arrived = resolve; });
    const wrapped = { withTransaction: work => database.withTransaction(tx => work({
      execute: (...args) => tx.execute(...args), query: (sql, params) => {
        if (sql.includes("FOR UPDATE") && sql.includes(phase === "warehouse" ? "FROM inventory_warehouses"
          : phase === "lot" ? "FROM inventory_lots" : "FROM inventory_stock_balances")) arrived();
        return tx.query(sql, params);
      }
    })) };
    const posting = new InventoryPostingService({ database: wrapped, logger, time });
    let pending;
    try {
      await blocker.beginTransaction();
      await blocker.query(phase === "warehouse" ? "SELECT id FROM inventory_warehouses WHERE id=1 FOR UPDATE"
        : phase === "lot" ? "SELECT id FROM inventory_lots WHERE id=? FOR UPDATE"
          : "SELECT id FROM inventory_stock_balances WHERE id=? FOR UPDATE", phase === "warehouse" ? [] : [phase === "lot" ? f.lotId : f.balanceId]);
      pending = submitAdjustment(input, posting).then(result => ({ result }), error => ({ error }));
      await reached; await writer.query("SET SESSION innodb_lock_wait_timeout=2");
      if (kind === "permission") await writer.query("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=2 AND p.name='inventory.adjust'");
      if (kind === "role") await writer.query("DELETE FROM user_roles WHERE user_id=8");
      if (kind === "user") await writer.query("UPDATE users SET status='inactive' WHERE id=8");
      if (kind === "device") await writer.query("UPDATE user_devices SET status='revoked' WHERE id=1");
      if (kind === "token") await writer.query("INSERT INTO fr_token_versions VALUES ('8',1)");
      await blocker.commit(); const outcome = await pending;
      assert.equal(outcome.error?.code, kind === "device" ? "DEVICE_REVOKED" : kind === "token" ? "JWT_INVALID" : "PERMISSION_STALE");
      assert.deepEqual(await snapshot(), before);
    } finally {
      await blocker.rollback(); blocker.release(); if (pending) await pending;
      if (kind === "permission") await writer.query("INSERT INTO role_permissions SELECT 2,id FROM permissions WHERE name='inventory.adjust'");
      if (kind === "role") await writer.query("INSERT INTO user_roles VALUES (8,2)");
      if (kind === "user") await writer.query("UPDATE users SET status='active' WHERE id=8");
      if (kind === "device") await writer.query("UPDATE user_devices SET status='approved' WHERE id=1");
      if (kind === "token") await writer.query("DELETE FROM fr_token_versions WHERE subject='8'");
      writer.release();
    }
  }
});

integrationTest("REV032-ROLLBACK native each leg/Audit/completion/precommit and actor-bind failures leave zero effects", async () => {
  const f = await fixture(), original = await service.postBinMove(move([f.line])), input = await reversal(original);
  for (const [target, occurrence] of [["operation",1],["current_state",1],["current_state",2],["movement",1],["movement",2],
    ["audit",1],["audit",2],["complete",1],["PRE_COMMIT",1],["bind-zero",1],["bind-error",1]]) {
    const before = await snapshot(); let count = 0, reached = false;
    const fault = () => { reached = true; throw Object.assign(new Error("Synthetic reversal fault"), { faultPoint: target }); };
    const wrapped = { withTransaction: work => database.withTransaction(async tx => {
      const result = await work({ query: (...args) => tx.query(...args),
        checkpoint: point => { if (point === target && ++count === occurrence) fault(); },
        execute: async (sql, params) => {
          if (sql.startsWith("UPDATE inventory_operation_requests SET actor_user_id")) {
            if (target === "bind-error") fault();
            if (target === "bind-zero") { reached = true; return tx.execute(sql.replace("WHERE id = ?", "WHERE id = ? AND 1=0"), params); }
          }
          const value = await tx.execute(sql, params);
          if (target === "complete" && sql.includes("SET result_type = ?")) fault();
          return value;
        } });
      if (target === "PRE_COMMIT") fault(); return result;
    }) };
    const posting = new InventoryPostingService({ database: wrapped, logger, time });
    await assert.rejects(() => submitAdjustment(input, posting), target === "bind-zero" ? { code: "CONCURRENT_OPERATION" } : { faultPoint: target });
    assert.equal(reached, true, target); assert.deepEqual(await snapshot(), before);
  }
});

integrationTest("REV032-GROUP native incomplete completed summary, forbidden Transfer and Reversal groups fail closed", async () => {
  const f = await fixture(), operations = new InventoryOperationService(), complete = operations.complete.bind(operations);
  operations.complete = (tx, value) => complete(tx, { ...value, resultSummary: { ...value.resultSummary, lineCount: 2 } });
  const posting = new InventoryPostingService({ database,logger,time,operations });
  const incomplete = await posting.postBinMove(move([f.line]));
  await rejectsUnchanged(() => reversal(incomplete).then(submitAdjustment), "REVERSAL_NOT_ALLOWED");
  const item = await fixture(), original = await receipt(item), reversed = await submitAdjustment(await reversal(original));
  await rejectsUnchanged(() => reversal(reversed).then(submitAdjustment), "MOVEMENT_TYPE_NOT_REVERSIBLE");
  const transfer = new InventoryTransferService({ database,logger,time });
  const command = (action,payload) => inventoryCommandFixture({ actor:{ claimedPermissions:["inventory.operation"] },
    authorization:{ purpose:`transfer.${action}`,requiredCallerPermission:"inventory.operation" },source:{ eventId:randomUUID() },payload });
  const draft = await transfer.create(command("create",{ sourceWarehouseId:1,destinationWarehouseId:2,
    lines:[{ skuId:item.skuId,lotId:null,sourceBinId:1,stockStatus:"AVAILABLE",quantity:1 }] }));
  const dispatched = await transfer.dispatch(command("dispatch",{ transferId:draft.id,expectedVersion:1 }));
  const [[leg]] = await pool.execute("SELECT movement_group_id FROM inventory_movements WHERE operation_request_id=? ORDER BY id LIMIT 1",[dispatched.operationId]);
  await rejectsUnchanged(() => reversal({ movementGroupId:leg.movement_group_id }).then(submitAdjustment), "MOVEMENT_TYPE_NOT_REVERSIBLE");
});

integrationTest("REV032-RESERVED native competing Reserve and reversal serialize the same Control with one invariant-safe winner", async () => {
  const f = await fixture({ onHand:1 }), original = await receipt(f,4), input = await reversal(original);
  const operations = competingOperations(), posting = new InventoryPostingService({ database,logger,time,operations });
  const reservations = new InventoryReservationService({ database,logger,time,operations });
  const command = inventoryCommandFixture({ actor:{ claimedPermissions:["inventory.operation"] },
    authorization:{ purpose:"reservation.create",requiredCallerPermission:"inventory.operation" },source:{ eventId:randomUUID() },
    payload:{ warehouseId:1,skuId:f.skuId,quantity:4,purpose:"SALE",minimumRemainingDays:0 } });
  const results = await Promise.allSettled([submitAdjustment(input,posting),reservations.create(command)]);
  assert.equal(results.filter(row => row.status==="fulfilled").length,1);
  assert.ok(["REVERSAL_NOT_ALLOWED","INSUFFICIENT_ATP"].includes(results.find(row => row.status==="rejected").reason.code));
  const [[control]] = await pool.execute("SELECT reserved_quantity FROM inventory_stock_controls WHERE warehouse_id=1 AND sku_id=?",[f.skuId]);
  assert.ok(Number(control.reserved_quantity) <= Number((await balances(f.skuId))[0].on_hand_quantity));
});

integrationTest("REV032-REVOKE-ORDER native final security locks block revocation and preserve original proof deadlines after bind", async () => {
  const f = await fixture(), original = await receipt(f), input = await reversal(original), writer = await pool.getConnection();
  let reached,release;
  const guarded = new Promise(resolve => { reached=resolve; }), resume = new Promise(resolve => { release=resolve; });
  const wrapped = { withTransaction:work => database.withTransaction(tx => work({
    execute:(...args) => tx.execute(...args),query:async (sql,params) => {
      const result = await tx.query(sql,params);
      if (sql.includes("FROM fr_token_versions") && sql.includes("FOR SHARE")) { reached(); await resume; }
      return result;
    }
  })) };
  const posting = new InventoryPostingService({ database:wrapped,logger,time });
  const pending = submitAdjustment(input,posting).then(result => ({ result }),error => ({ error }));
  try {
    await guarded; await writer.query("SET SESSION innodb_lock_wait_timeout=1");
    await assert.rejects(() => writer.query("UPDATE user_devices SET status='revoked' WHERE id=1"),{ code:"ER_LOCK_WAIT_TIMEOUT" });
    release(); const result = await pending; assert.ifError(result.error);
    await writer.query("UPDATE user_devices SET status='revoked' WHERE id=1");
    await rejectsUnchanged(() => submitAdjustment(input),"DEVICE_REVOKED");
  } finally { release(); await pending; await writer.query("UPDATE user_devices SET status='approved' WHERE id=1"); writer.release(); }
  const next = await fixture(), posted = await receipt(next), command = await reversal(posted);
  for (const kind of ["deadline","abort","midnight","cas","lock-timeout"]) {
    let now=time.nowMs(),date=time.fileDate(),entered=false;
    const abort = new AbortController(),clock={ nowMs:()=>now,fileDate:()=>date };
    const failed = { withTransaction:work => database.withTransaction(tx => work({
      query:async (sql,params) => {
        const result = await tx.query(sql,params);
        if (kind==="midnight" && sql.includes("FROM fr_token_versions") && sql.includes("FOR SHARE")) { entered=true; date="2026-10-03"; }
        return result;
      },execute:async (sql,params) => {
        if (kind==="lock-timeout" && sql.startsWith("UPDATE inventory_stock_balances")) {
          entered=true; return tx.query("SIGNAL SQLSTATE 'HY000' SET MYSQL_ERRNO=1205,MESSAGE_TEXT='Synthetic lock wait timeout'");
        }
        if (kind==="cas" && sql.startsWith("UPDATE inventory_stock_balances")) {
          entered=true; return tx.execute(sql.replace("WHERE id = ?","WHERE id = ? AND 1=0"),params);
        }
        const result = await tx.execute(sql,params);
        if (sql.startsWith("UPDATE inventory_operation_requests SET actor_user_id")) {
          if (kind==="deadline") { entered=true; now+=60001; }
          if (kind==="abort") { entered=true; abort.abort(Object.assign(new Error("Synthetic timeout"),{ code:"REQUEST_TIMEOUT" })); }
        }
        return result;
      }
    })) };
    const failing = new InventoryPostingService({ database:failed,logger,time:clock });
    await rejectsUnchanged(() => submitAdjustment(command,failing,clock,abort.signal),
      kind==="deadline" ? "DEVICE_SIGNATURE_STALE" : kind==="abort" ? "REQUEST_TIMEOUT" : "CONCURRENT_OPERATION");
    assert.equal(entered,true,kind);
  }
});
