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
import { inspectInventoryTransferSchema, up } from "../../database/migrations/0064_create_inventory_transfers.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_TRANSFER_MIGRATION_TESTS === "1";
const integrationTest = enabled ? test : test.skip;
let connection;
let transferId;
let lineId;
let operationId;

before(async () => {
  if (!enabled) return;
  const database = process.env.DB_NAME;
  const socketPath = process.env.DB_SOCKET;
  assert.match(database ?? "", /^erp_inventory_task026_[a-z0-9_]+$/u);
  assert.match(socketPath ?? "", /^\/private\/tmp\/erp-inventory-task026-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  connection = await mysql.createConnection({ user: "root", database, socketPath });
  const [[environment]] = await connection.query("SELECT VERSION() AS version, DATABASE() AS database_name, @@skip_networking AS isolated");
  assert.match(environment.version, /^26\.7\.0(?:$|-)/u);
  assert.equal(environment.database_name, database);
  assert.equal(Number(environment.isolated), 1);
  const [existing] = await connection.query("SHOW TABLES");
  assert.equal(existing.length, 0, "requires a fresh synthetic schema, never reset existing data");
  await connection.query("CREATE TABLE users (id BIGINT UNSIGNED PRIMARY KEY, username VARCHAR(190) NOT NULL) ENGINE=InnoDB");
  await connection.query(`CREATE TABLE permissions (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(190) NOT NULL UNIQUE, description VARCHAR(255) NOT NULL DEFAULT '', created_at BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB`);
  await connection.query("CREATE TABLE item_skus (id BIGINT UNSIGNED PRIMARY KEY, sku_code VARCHAR(190) NOT NULL, sku_name VARCHAR(190) NOT NULL) ENGINE=InnoDB");
  for (const migrate of [permissions, operations, audit, master, stock, movements, reservations]) await migrate(connection);
  await connection.query("INSERT INTO users VALUES (7, 'synthetic-actor')");
  await connection.query("INSERT INTO item_skus VALUES (1, 'SKU-1', 'Synthetic 1'), (2, 'SKU-2', 'Synthetic 2')");
  for (const id of [1, 2]) {
    await connection.execute(`INSERT INTO inventory_warehouses
      (id, warehouse_code, normalized_code, warehouse_name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)`,
    [id, `WH-${id}`, `WH-${id}`, `Synthetic ${id}`]);
    await connection.execute(`INSERT INTO inventory_bins
      (id, warehouse_id, bin_code, normalized_code, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)`,
    [id, id, `BIN-${id}`, `BIN-${id}`]);
  }
});
after(async () => { if (connection) await connection.end(); });

async function newOperation() {
  const [result] = await connection.execute(`INSERT INTO inventory_operation_requests
    (command_type, source_module, source_document_type, source_document_id, source_event_id, request_hash, actor_label, created_at)
    VALUES ('TRANSFER_CREATE', 'INVENTORY', 'TRANSFER', ?, 'CREATE', ?, 'synthetic', 1)`, [randomUUID(), "a".repeat(64)]);
  return result.insertId;
}

async function schemaSnapshot() {
  const result = {};
  for (const table of ["inventory_transfers", "inventory_transfer_lines", "inventory_movements"]) {
    const [[row]] = await connection.query(`SHOW CREATE TABLE ${table}`);
    result[table] = row["Create Table"].replace(/ AUTO_INCREMENT=\d+/gu, "");
  }
  return result;
}

integrationTest("Transfer migration creates complete typed schema, indexes and enforced constraints", async () => {
  assert.equal(await inspectInventoryTransferSchema(connection), false);
  await up(connection);
  assert.equal(await inspectInventoryTransferSchema(connection), true);
  operationId = await newOperation();
  const [header] = await connection.execute(`INSERT INTO inventory_transfers
    (transfer_number, source_warehouse_id, destination_warehouse_id, create_operation_id, created_at, updated_at, created_by)
    VALUES ('TR-SYNTHETIC', 1, 2, ?, 1, 1, 7)`, [operationId]);
  transferId = header.insertId;
  const [line] = await connection.execute(`INSERT INTO inventory_transfer_lines
    (transfer_id, line_number, sku_id, source_bin_id, dispatch_stock_status, quantity, sku_code_snapshot)
    VALUES (?, 1, 1, 1, 'AVAILABLE', 5, 'SKU-1')`, [transferId]);
  lineId = line.insertId;
});

integrationTest("Transfer migration rerun preserves header, lines and schema", async () => {
  const schema = await schemaSnapshot();
  const [headers] = await connection.query("SELECT * FROM inventory_transfers");
  const [lines] = await connection.query("SELECT * FROM inventory_transfer_lines");
  await up(connection);
  await up(connection);
  assert.deepEqual(await schemaSnapshot(), schema);
  assert.deepEqual((await connection.query("SELECT * FROM inventory_transfers"))[0], headers);
  assert.deepEqual((await connection.query("SELECT * FROM inventory_transfer_lines"))[0], lines);
});

integrationTest("Transfer header rejects same warehouse, invalid state/version, missing/duplicate operations", async () => {
  for (const [field, value, code] of [
    ["destination_warehouse_id", 1, "ER_CHECK_CONSTRAINT_VIOLATED"],
    ["status", "PARTIAL", "ER_CHECK_CONSTRAINT_VIOLATED"], ["version", 0, "ER_CHECK_CONSTRAINT_VIOLATED"],
    ["create_operation_id", 999999, "ER_NO_REFERENCED_ROW_2"]
  ]) await assert.rejects(connection.execute(`UPDATE inventory_transfers SET ${field} = ? WHERE id = ?`, [value, transferId]), { code });
  for (const field of ["create_operation_id", "dispatch_operation_id", "receive_operation_id", "cancel_operation_id"]) {
    const id = await newOperation();
    await connection.execute(`UPDATE inventory_transfers SET ${field} = ? WHERE id = ?`, [id, transferId]);
    const createId = field === "create_operation_id" ? id : await newOperation();
    await assert.rejects(connection.execute(`INSERT INTO inventory_transfers
      (transfer_number, source_warehouse_id, destination_warehouse_id, create_operation_id, ${field === "create_operation_id" ? "reason" : field}, created_at, updated_at)
      VALUES (?, 1, 2, ?, ?, 1, 1)`, [randomUUID(), createId, field === "create_operation_id" ? "" : id]), { code: "ER_DUP_ENTRY" });
  }
  await assert.rejects(connection.execute("DELETE FROM inventory_warehouses WHERE id = 1"), { code: "ER_ROW_IS_REFERENCED_2" });
  await connection.query("DELETE FROM users WHERE id = 7");
  assert.equal((await connection.query("SELECT created_by FROM inventory_transfers"))[0][0].created_by, null);
});

integrationTest("Transfer lines enforce parent, bins and composite SKU/Lot ownership", async () => {
  for (const field of ["transfer_id", "sku_id", "source_bin_id", "destination_bin_id"]) {
    await assert.rejects(connection.execute(`UPDATE inventory_transfer_lines SET ${field} = 999999 WHERE id = ?`, [lineId]), { code: "ER_NO_REFERENCED_ROW_2" });
  }
  await connection.query(`INSERT INTO inventory_lots
    (id, sku_id, lot_number, normalized_lot_number, first_receipt_date, sku_code_snapshot, created_at)
    VALUES (1, 2, 'LOT-2', 'LOT-2', '2026-09-30', 'SKU-2', 1)`);
  await assert.rejects(connection.execute("UPDATE inventory_transfer_lines SET lot_id = 1 WHERE id = ?", [lineId]), { code: "ER_NO_REFERENCED_ROW_2" });
  await connection.execute("UPDATE inventory_transfer_lines SET sku_id = 2, lot_id = 1, destination_bin_id = 2 WHERE id = ?", [lineId]);
  await assert.rejects(connection.execute("DELETE FROM inventory_lots WHERE id = 1"), { code: "ER_ROW_IS_REFERENCED_2" });
  await assert.rejects(connection.execute("DELETE FROM inventory_transfers WHERE id = ?", [transferId]), { code: "ER_ROW_IS_REFERENCED_2" });
});

integrationTest("Transfer line quantity, whole in-transit amount, statuses and line uniqueness are constrained", async () => {
  for (const [field, value] of [["quantity", 0], ["in_transit_quantity", 2], ["dispatch_stock_status", "UNKNOWN"],
    ["receive_stock_status", "DAMAGED"], ["version", 0], ["line_number", 0]]) {
    await assert.rejects(connection.execute(`UPDATE inventory_transfer_lines SET ${field} = ? WHERE id = ?`, [value, lineId]), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  }
  for (const status of ["AVAILABLE", "QUARANTINED", null]) {
    await connection.execute("UPDATE inventory_transfer_lines SET receive_stock_status = ?, in_transit_quantity = 5 WHERE id = ?", [status, lineId]);
  }
  await connection.execute("UPDATE inventory_transfer_lines SET in_transit_quantity = 0 WHERE id = ?", [lineId]);
  await assert.rejects(connection.execute(`INSERT INTO inventory_transfer_lines
    (transfer_id, line_number, sku_id, source_bin_id, dispatch_stock_status, quantity, sku_code_snapshot)
    VALUES (?, 1, 1, 1, 'AVAILABLE', 1, 'SKU-1')`, [transferId]), { code: "ER_DUP_ENTRY" });
});

integrationTest("Transfer movement references are optional, restrictive and retry-safe after interrupted FK attachment", async () => {
  await connection.query("ALTER TABLE inventory_movements DROP FOREIGN KEY fk_inventory_movements_transfer_line");
  assert.equal(await inspectInventoryTransferSchema(connection), false);
  await up(connection);
  assert.equal(await inspectInventoryTransferSchema(connection), true);
  const sql = `INSERT INTO inventory_movements
    (movement_group_id, operation_request_id, movement_type, location_kind, warehouse_id, sku_id, stock_status,
     direction, quantity, transfer_id, transfer_line_id, sku_code_snapshot, sku_name_snapshot, warehouse_code_snapshot, posted_at, posted_by_label)
    VALUES (?, ?, 'TRANSFER_DISPATCH', 'IN_TRANSIT', 1, 2, 'AVAILABLE', 'IN', 5, ?, ?, 'SKU-2', 'Synthetic', 'WH-1', 1, 'synthetic')`;
  const id = await newOperation();
  for (const pair of [[999999, lineId], [transferId, 999999]]) {
    await assert.rejects(connection.execute(sql, [randomUUID(), id, ...pair]), { code: "ER_NO_REFERENCED_ROW_2" });
  }
  await connection.execute(sql, [randomUUID(), id, null, null]);
  await connection.execute(sql, [randomUUID(), id, transferId, lineId]);
  await assert.rejects(connection.execute("DELETE FROM inventory_transfer_lines WHERE id = ?", [lineId]), { code: "ER_ROW_IS_REFERENCED_2" });
});

integrationTest("Transfer migration fails closed on incompatible existing index, check and FK without further DDL", async () => {
  const observed = { query: async (sql, args) => {
    assert.equal(/^\s*(?:CREATE|ALTER)/u.test(sql), false, "incompatible schema must reject before DDL");
    return connection.query(sql, args);
  } };
  await connection.query("ALTER TABLE inventory_transfers DROP INDEX idx_inventory_transfers_status");
  await assert.rejects(up(observed), /Incompatible.*index/u);
  await connection.query("ALTER TABLE inventory_transfers ADD INDEX idx_inventory_transfers_status (status, updated_at, id)");
  await connection.query("ALTER TABLE inventory_transfers ALTER CHECK chk_inventory_transfers_warehouses NOT ENFORCED");
  await assert.rejects(up(observed), /Incompatible.*check/u);
  await connection.query("ALTER TABLE inventory_transfers ALTER CHECK chk_inventory_transfers_warehouses ENFORCED");
  await connection.query("ALTER TABLE inventory_transfers ALTER COLUMN status SET DEFAULT 'IN_TRANSIT'");
  await assert.rejects(up(observed), /Incompatible.*default/u);
  await connection.query("ALTER TABLE inventory_transfers ALTER COLUMN status SET DEFAULT 'DRAFT'");
  await connection.query("ALTER TABLE inventory_transfers DROP CHECK chk_inventory_transfers_status");
  await connection.query(`ALTER TABLE inventory_transfers ADD CONSTRAINT chk_inventory_transfers_status
    CHECK (status IN ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED', 'PARTIAL'))`);
  await assert.rejects(up(observed), /Incompatible.*check/u);
  await connection.query("ALTER TABLE inventory_transfers DROP CHECK chk_inventory_transfers_status");
  await connection.query(`ALTER TABLE inventory_transfers ADD CONSTRAINT chk_inventory_transfers_status
    CHECK (status IN ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'))`);
  await connection.query("ALTER TABLE inventory_transfer_lines DROP FOREIGN KEY fk_inventory_transfer_lines_destination_bin");
  await assert.rejects(up(observed), /Incompatible.*foreign key/u);
  await connection.query(`ALTER TABLE inventory_transfer_lines ADD CONSTRAINT fk_inventory_transfer_lines_destination_bin
    FOREIGN KEY (destination_bin_id) REFERENCES inventory_warehouses (id) ON DELETE RESTRICT`);
  await assert.rejects(up(observed), /Incompatible.*foreign key/u);
  await connection.query("ALTER TABLE inventory_transfer_lines DROP FOREIGN KEY fk_inventory_transfer_lines_destination_bin");
  await connection.query(`ALTER TABLE inventory_transfer_lines ADD CONSTRAINT fk_inventory_transfer_lines_destination_bin
    FOREIGN KEY (destination_bin_id) REFERENCES inventory_bins (id) ON DELETE RESTRICT`);
  assert.equal(await inspectInventoryTransferSchema(connection), true);
});
