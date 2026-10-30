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
import { inspectInventoryStocktakeSchema, up } from "../../database/migrations/0065_create_inventory_stocktakes.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_STOCKTAKE_MIGRATION_TESTS === "1";
const integrationTest = enabled ? test : test.skip;
let connection, first, second, scope, otherScope, line;
const tables = ["inventory_stocktakes", "inventory_stocktake_bins", "inventory_bin_locks", "inventory_stocktake_lines", "inventory_movements"];

before(async () => {
  if (!enabled) return;
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_task035_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET ?? "", /^\/private\/tmp\/erp-inventory-task035-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  connection = await mysql.createConnection({ user: "root", database: process.env.DB_NAME, socketPath: process.env.DB_SOCKET });
  const [[observed]] = await connection.query("SELECT VERSION() AS version, DATABASE() AS schema_name, @@skip_networking AS isolated");
  assert.equal(observed.version, "26.7.0"); assert.equal(observed.schema_name, process.env.DB_NAME); assert.equal(Number(observed.isolated), 1);
  assert.equal((await connection.query("SHOW TABLES"))[0].length, 0, "requires a fresh owned schema; never reset existing data");
  await connection.query("CREATE TABLE users (id BIGINT UNSIGNED PRIMARY KEY, username VARCHAR(190) NOT NULL) ENGINE=InnoDB");
  await connection.query("CREATE TABLE permissions (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(190) NOT NULL UNIQUE, description VARCHAR(255) NOT NULL DEFAULT '', created_at BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB");
  await connection.query("CREATE TABLE item_skus (id BIGINT UNSIGNED PRIMARY KEY, sku_code VARCHAR(190) NOT NULL, sku_name VARCHAR(190) NOT NULL) ENGINE=InnoDB");
  for (const migrate of [permissions, operations, audit, master, stock, movements, reservations, transfers]) await migrate(connection);
  await connection.query("INSERT INTO users VALUES (7, 'synthetic-actor')");
  await connection.query("INSERT INTO item_skus VALUES (1, 'SKU-1', 'Synthetic 1'), (2, 'SKU-2', 'Synthetic 2')");
  await connection.query("INSERT INTO inventory_warehouses (id, warehouse_code, normalized_code, warehouse_name, created_at, updated_at) VALUES (1, 'SYNTHETIC', 'synthetic', 'Synthetic', 1, 1)");
  for (const id of [1, 2]) await connection.execute("INSERT INTO inventory_bins (id, warehouse_id, bin_code, normalized_code, created_at, updated_at) VALUES (?, 1, ?, ?, 1, 1)", [id, `BIN-${id}`, `bin-${id}`]);
  await connection.query("INSERT INTO inventory_stock_balances (id, warehouse_id, bin_id, sku_id, stock_status, on_hand_quantity, created_at, updated_at) VALUES (1, 1, 1, 1, 'AVAILABLE', 5, 1, 1)");
  await connection.query("INSERT INTO inventory_lots (id, sku_id, lot_number, normalized_lot_number, first_receipt_date, sku_code_snapshot, created_at) VALUES (1, 2, 'LOT-2', 'lot-2', '2026-10-12', 'SKU-2', 1)");
});
after(async () => { if (connection) await connection.end(); });

async function operation() {
  return (await connection.execute("INSERT INTO inventory_operation_requests (command_type, source_module, source_document_type, source_document_id, source_event_id, request_hash, actor_label, created_at) VALUES ('STOCKTAKE_CREATE', 'INVENTORY', 'STOCKTAKE', ?, 'CREATE', ?, 'synthetic', 1)", [randomUUID(), "a".repeat(64)]))[0].insertId;
}
async function header() {
  return (await connection.execute("INSERT INTO inventory_stocktakes (stocktake_number, warehouse_id, create_operation_id, created_at, updated_at, created_by) VALUES (?, 1, ?, 1, 1, 7)", [randomUUID(), await operation()]))[0].insertId;
}
async function countLine(stocktake = first, binScope = scope, bin = 1, sku = 1, status = "AVAILABLE") {
  return (await connection.execute("INSERT INTO inventory_stocktake_lines (stocktake_id, stocktake_bin_id, bin_id, sku_id, stock_status) VALUES (?, ?, ?, ?, ?)", [stocktake, binScope, bin, sku, status]))[0].insertId;
}
async function lock(stocktake = first, binScope = scope, bin = 1, released = null) {
  return (await connection.execute("INSERT INTO inventory_bin_locks (stocktake_id, stocktake_bin_id, bin_id, lock_type, locked_at, locked_by, released_at) VALUES (?, ?, ?, 'STOCKTAKE', 1, 7, ?)", [stocktake, binScope, bin, released]))[0].insertId;
}
async function snapshot() {
  const result = {};
  for (const table of tables) {
    const [[definition]] = await connection.query(`SHOW CREATE TABLE ${table}`);
    result[table] = { schema: definition["Create Table"].replace(/ AUTO_INCREMENT=\d+/gu, ""), rows: (await connection.query(`SELECT * FROM ${table} ORDER BY id`))[0] };
  }
  return result;
}
async function rejectDrift(change, restore, pattern) {
  await connection.query(change);
  try {
    await assert.rejects(up({ query: async (sql, args) => {
      assert.equal(/^\s*(CREATE|ALTER|UPDATE|DELETE)/u.test(sql), false, "incompatible schema must reject before further mutation");
      return connection.query(sql, args);
    } }), pattern);
  } finally { await connection.query(restore); }
}

integrationTest("MIG035-D01 creates four typed InnoDB tables and optional Movement FKs", async () => {
  assert.equal(await inspectInventoryStocktakeSchema(connection), false);
  await up(connection); assert.equal(await inspectInventoryStocktakeSchema(connection), true);
  const [engines] = await connection.query("SELECT table_name AS table_name, engine AS engine FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('inventory_stocktakes', 'inventory_stocktake_bins', 'inventory_bin_locks', 'inventory_stocktake_lines')");
  assert.equal(engines.length, 4); assert.equal(engines.every(row => row.engine === "InnoDB"), true);
  first = await header(); second = await header();
  scope = (await connection.execute("INSERT INTO inventory_stocktake_bins (stocktake_id, bin_id, bin_code_snapshot, created_at) VALUES (?, 1, 'BIN-1', 1)", [first]))[0].insertId;
  otherScope = (await connection.execute("INSERT INTO inventory_stocktake_bins (stocktake_id, bin_id, bin_code_snapshot, created_at) VALUES (?, 1, 'BIN-1', 1)", [second]))[0].insertId;
  line = await countLine();
  await lock(first, scope, 1, 2);
});
integrationTest("MIG035-D02 rerun is a no-op preserving headers, scope, lines and lock history", async () => {
  const original = await snapshot(); await up(connection); await up(connection);
  assert.deepEqual(await snapshot(), original);
});
integrationTest("MIG035-D03 enforces states, versions and all command operation uniqueness", async () => {
  for (const state of ["DRAFT", "COUNTING", "READY_TO_POST", "POSTED", "CANCELLED"]) await connection.execute("UPDATE inventory_stocktakes SET status = ? WHERE id = ?", [state, first]);
  for (const [name, value] of [["status", "counting"], ["status", "PARTIAL"], ["version", 0]]) {
    await assert.rejects(connection.execute(`UPDATE inventory_stocktakes SET ${name} = ? WHERE id = ?`, [value, first]), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  }
  for (const name of ["create", "start", "ready", "post", "cancel"]) {
    const id = await operation();
    await connection.execute(`UPDATE inventory_stocktakes SET ${name}_operation_id = ? WHERE id = ?`, [id, first]);
    await assert.rejects(connection.execute(`UPDATE inventory_stocktakes SET ${name}_operation_id = ? WHERE id = ?`, [id, second]), { code: "ER_DUP_ENTRY" });
    await assert.rejects(connection.execute(`UPDATE inventory_stocktakes SET ${name}_operation_id = 999999 WHERE id = ?`, [first]), { code: "ER_NO_REFERENCED_ROW_2" });
  }
  await connection.execute("UPDATE inventory_stocktakes SET status = 'COUNTING' WHERE id = ?", [first]);
});
integrationTest("MIG035-D04 business parent references restrict deletion and actors become NULL", async () => {
  await assert.rejects(connection.query("DELETE FROM inventory_warehouses WHERE id = 1"), { code: "ER_ROW_IS_REFERENCED_2" });
  await assert.rejects(connection.execute("DELETE FROM inventory_stocktakes WHERE id = ?", [first]), { code: "ER_ROW_IS_REFERENCED_2" });
  await assert.rejects(connection.execute("DELETE FROM inventory_operation_requests WHERE id = (SELECT create_operation_id FROM inventory_stocktakes WHERE id = ?)", [first]), { code: "ER_ROW_IS_REFERENCED_2" });
  await connection.query("DELETE FROM users WHERE id = 7");
  assert.equal((await connection.execute("SELECT created_by FROM inventory_stocktakes WHERE id = ?", [first]))[0][0].created_by, null);
  assert.equal((await connection.query("SELECT locked_by FROM inventory_bin_locks"))[0][0].locked_by, null);
  await connection.query("INSERT INTO users VALUES (7, 'synthetic-actor-restored')");
});
integrationTest("MIG035-D05 scope rows enforce unique Bin membership and restrictive parents", async () => {
  await assert.rejects(connection.execute("INSERT INTO inventory_stocktake_bins (stocktake_id, bin_id, bin_code_snapshot, created_at) VALUES (?, 1, 'BIN-1', 1)", [first]), { code: "ER_DUP_ENTRY" });
  await assert.rejects(connection.execute("UPDATE inventory_stocktake_bins SET stocktake_id = 999999 WHERE id = ?", [otherScope]), { code: "ER_NO_REFERENCED_ROW_2" });
  await assert.rejects(connection.execute("UPDATE inventory_stocktake_bins SET bin_id = 999999 WHERE id = ?", [otherScope]), { code: "ER_NO_REFERENCED_ROW_2" });
  await assert.rejects(connection.execute("DELETE FROM inventory_stocktake_bins WHERE id = ?", [scope]), { code: "ER_ROW_IS_REFERENCED_2" });
});
integrationTest("MIG035-D06 only one active lock exists per Bin while released history can coexist", async () => {
  const active = await lock();
  await assert.rejects(lock(second, otherScope), { code: "ER_DUP_ENTRY" });
  await connection.execute("UPDATE inventory_bin_locks SET released_at = 3, release_reason = 'CANCELLED' WHERE id = ?", [active]);
  await lock(first, scope, 1, 4); const newOwner = await lock(second, otherScope);
  const [rows] = await connection.query("SELECT active_scope FROM inventory_bin_locks ORDER BY id");
  assert.deepEqual(rows.map(row => row.active_scope), [null, null, null, 1]);
  await connection.execute("UPDATE inventory_bin_locks SET released_at = 5, release_reason = 'POSTED' WHERE id = ?", [newOwner]);
});
integrationTest("MIG035-D07 composite Lock owner rejects another header or Bin", async () => {
  await assert.rejects(lock(second, scope), { code: "ER_NO_REFERENCED_ROW_2" });
  await assert.rejects(lock(first, scope, 2), { code: "ER_NO_REFERENCED_ROW_2" });
  const id = await lock();
  await assert.rejects(connection.execute("UPDATE inventory_bin_locks SET lock_type = 'OTHER' WHERE id = ?", [id]), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  await connection.execute("UPDATE inventory_bin_locks SET released_at = 6 WHERE id = ?", [id]);
});
integrationTest("MIG035-D08 composite Line owner rejects another header or Bin", async () => {
  await assert.rejects(countLine(second, scope, 1, 2), { code: "ER_NO_REFERENCED_ROW_2" });
  await assert.rejects(countLine(first, scope, 2, 2), { code: "ER_NO_REFERENCED_ROW_2" });
  await assert.rejects(connection.execute("UPDATE inventory_stocktake_lines SET stocktake_id = ? WHERE id = ?", [second, line]), { code: "ER_NO_REFERENCED_ROW_2" });
});
integrationTest("MIG035-D09 NULL Lot cannot bypass dimension uniqueness; zero and uncounted stay distinct", async () => {
  await assert.rejects(countLine(), { code: "ER_DUP_ENTRY" });
  const [[uncounted]] = await connection.execute("SELECT lot_scope, counted_quantity, is_not_found FROM inventory_stocktake_lines WHERE id = ?", [line]);
  assert.equal(Number(uncounted.lot_scope), 0); assert.equal(uncounted.counted_quantity, null); assert.equal(uncounted.is_not_found, 0);
  await connection.execute("UPDATE inventory_stocktake_lines SET counted_quantity = 0 WHERE id = ?", [line]);
  assert.equal(Number((await connection.execute("SELECT counted_quantity FROM inventory_stocktake_lines WHERE id = ?", [line]))[0][0].counted_quantity), 0);
  await assert.rejects(connection.execute("UPDATE inventory_stocktake_lines SET counted_quantity = -1 WHERE id = ?", [line]), { code: "ER_WARN_DATA_OUT_OF_RANGE" });
  await assert.rejects(connection.execute("UPDATE inventory_stocktake_lines SET is_not_found = 2 WHERE id = ?", [line]), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  await assert.rejects(connection.execute("UPDATE inventory_stocktake_lines SET version = 0 WHERE id = ?", [line]), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  await assert.rejects(connection.execute("UPDATE inventory_stocktake_lines SET stock_status = 'UNKNOWN' WHERE id = ?", [line]), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  await countLine(first, scope, 1, 1, "QUARANTINED");
});
integrationTest("MIG035-D10 Line SKU/Lot, Balance and Movement references reject nonexistent parents", async () => {
  for (const name of ["stock_balance_id", "sku_id", "lot_id", "movement_id"]) {
    await assert.rejects(connection.execute(`UPDATE inventory_stocktake_lines SET ${name} = 999999 WHERE id = ?`, [line]), { code: "ER_NO_REFERENCED_ROW_2" });
  }
  await assert.rejects(connection.execute("UPDATE inventory_stocktake_lines SET lot_id = 1 WHERE id = ?", [line]), { code: "ER_NO_REFERENCED_ROW_2" });
  await connection.execute("UPDATE inventory_stocktake_lines SET stock_balance_id = 1 WHERE id = ?", [line]);
  await assert.rejects(connection.query("DELETE FROM inventory_stock_balances WHERE id = 1"), { code: "ER_ROW_IS_REFERENCED_2" });
  const lotLine = await countLine(first, scope, 1, 2);
  await connection.execute("UPDATE inventory_stocktake_lines SET lot_id = 1 WHERE id = ?", [lotLine]);
  await assert.rejects(countLine(first, scope, 1, 2).then(async id => {
    await connection.execute("UPDATE inventory_stocktake_lines SET lot_id = 1 WHERE id = ?", [id]);
  }), { code: "ER_DUP_ENTRY" });
});
integrationTest("MIG035-D11 optional Movement attachment resumes safely and immutable history is unchanged", async () => {
  const sql = "INSERT INTO inventory_movements (movement_group_id, operation_request_id, movement_type, location_kind, warehouse_id, bin_id, sku_id, stock_status, direction, quantity, balance_before, balance_after, balance_version_after, stocktake_id, stocktake_line_id, sku_code_snapshot, sku_name_snapshot, warehouse_code_snapshot, bin_code_snapshot, posted_at, posted_by_label) VALUES (?, ?, 'STOCKTAKE_VARIANCE', 'BIN', 1, 1, 1, 'AVAILABLE', 'IN', 1, 5, 6, 2, ?, ?, 'SKU-1', 'Synthetic', 'SYNTHETIC', 'BIN-1', 1, 'synthetic')";
  for (const ids of [[999999, null], [first, 999999]]) await assert.rejects(connection.execute(sql, [randomUUID(), await operation(), ...ids]), { code: "ER_NO_REFERENCED_ROW_2" });
  await connection.execute(sql, [randomUUID(), await operation(), null, null]);
  const [movement] = await connection.execute(sql, [randomUUID(), await operation(), first, line]);
  await connection.execute("UPDATE inventory_stocktake_lines SET movement_id = ? WHERE id = ?", [movement.insertId, line]);
  const original = (await connection.query("SELECT * FROM inventory_movements ORDER BY id"))[0];
  await connection.query("ALTER TABLE inventory_movements DROP FOREIGN KEY fk_inventory_movements_stocktake_line");
  assert.equal(await inspectInventoryStocktakeSchema(connection), false); await up(connection);
  assert.equal(await inspectInventoryStocktakeSchema(connection), true);
  assert.deepEqual((await connection.query("SELECT * FROM inventory_movements ORDER BY id"))[0], original);
  await assert.rejects(connection.execute("DELETE FROM inventory_stocktake_lines WHERE id = ?", [line]), { code: "ER_ROW_IS_REFERENCED_2" });
});
integrationTest("MIG035-D12 incompatible existing metadata rejects before additional DDL", async () => {
  await rejectDrift("ALTER TABLE inventory_stocktakes MODIFY reason VARCHAR(499) NOT NULL DEFAULT ''", "ALTER TABLE inventory_stocktakes MODIFY reason VARCHAR(500) NOT NULL DEFAULT ''", /Incompatible.*columns/u);
  await rejectDrift("ALTER TABLE inventory_stocktake_lines ALTER COLUMN counted_quantity SET DEFAULT 0", "ALTER TABLE inventory_stocktake_lines ALTER COLUMN counted_quantity SET DEFAULT NULL", /Incompatible.*default/u);
  await rejectDrift("ALTER TABLE inventory_stocktakes DROP INDEX idx_inventory_stocktakes_status", "ALTER TABLE inventory_stocktakes ADD INDEX idx_inventory_stocktakes_status (status,updated_at,id)", /Incompatible.*index/u);
  await rejectDrift("ALTER TABLE inventory_stocktakes ALTER CHECK chk_inventory_stocktakes_status NOT ENFORCED", "ALTER TABLE inventory_stocktakes ALTER CHECK chk_inventory_stocktakes_status ENFORCED", /Incompatible.*check/u);
  await connection.execute("UPDATE inventory_stocktakes SET status = 'COUNTING' WHERE id = ?", [second]);
  await connection.query("ALTER TABLE inventory_stocktakes DROP CHECK chk_inventory_stocktakes_status");
  await rejectDrift("ALTER TABLE inventory_stocktakes ADD CONSTRAINT chk_inventory_stocktakes_status CHECK (status IN ('_asciiDRAFT','COUNTING','READY_TO_POST','POSTED','CANCELLED'))", "ALTER TABLE inventory_stocktakes DROP CHECK chk_inventory_stocktakes_status", /Incompatible.*check/u);
  await connection.query("ALTER TABLE inventory_stocktakes ADD CONSTRAINT chk_inventory_stocktakes_status CHECK (status IN ('DRAFT','COUNTING','READY_TO_POST','POSTED','CANCELLED'))");
  await connection.query("ALTER TABLE inventory_bin_locks DROP INDEX uq_inventory_bin_active_lock");
  await rejectDrift("ALTER TABLE inventory_bin_locks MODIFY active_scope TINYINT GENERATED ALWAYS AS (0) STORED", "ALTER TABLE inventory_bin_locks MODIFY active_scope TINYINT GENERATED ALWAYS AS (IF(released_at IS NULL,1,NULL)) STORED", /Incompatible.*generated/u);
  await connection.query("ALTER TABLE inventory_bin_locks ADD UNIQUE INDEX uq_inventory_bin_active_lock (bin_id,active_scope)");
  await connection.query("ALTER TABLE inventory_bin_locks DROP FOREIGN KEY fk_inventory_bin_locks_owner");
  await rejectDrift("ALTER TABLE inventory_bin_locks ADD CONSTRAINT fk_inventory_bin_locks_owner FOREIGN KEY (stocktake_bin_id) REFERENCES inventory_stocktake_bins (id) ON DELETE RESTRICT", "ALTER TABLE inventory_bin_locks DROP FOREIGN KEY fk_inventory_bin_locks_owner", /Incompatible.*foreign key/u);
  await connection.query("ALTER TABLE inventory_bin_locks ADD CONSTRAINT fk_inventory_bin_locks_owner FOREIGN KEY (stocktake_bin_id,stocktake_id,bin_id) REFERENCES inventory_stocktake_bins (id,stocktake_id,bin_id) ON DELETE RESTRICT");
  assert.equal(await inspectInventoryStocktakeSchema(connection), true);
});
