import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";

import { up as seedInventoryPermissions } from "../../database/migrations/0055_seed_inventory_permissions.js";
import { up as createInventoryOperations } from "../../database/migrations/0056_create_inventory_operations.js";
import { up as createInventoryAudit } from "../../database/migrations/0057_create_inventory_audit.js";
import { up as createInventoryMaster } from "../../database/migrations/0058_create_inventory_master.js";
import {
  inspectInventoryStockSchema,
  up as createInventoryStock
} from "../../database/migrations/0059_create_inventory_stock.js";
import {
  inspectInventoryMovementSchema,
  up as createInventoryMovements
} from "../../database/migrations/0060_create_inventory_movements.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" &&
  process.env.INVENTORY_STOCK_MIGRATION_TESTS === "1" ? test : test.skip;

function config() {
  const database = process.env.DB_NAME;
  if (!/^erp_inventory_task012_[a-z0-9_]+$/u.test(database ?? "")) {
    throw new Error("TASK-012 migration test requires a disposable erp_inventory_task012_* schema");
  }
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database
  };
}

async function createPrerequisites(connection) {
  await connection.query(`
    CREATE TABLE users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(190) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_username (username)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE permissions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(190) NOT NULL,
      description VARCHAR(255) NOT NULL DEFAULT '',
      created_at BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_permissions_name (name)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE item_skus (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      sku_code VARCHAR(190) NOT NULL,
      sku_name VARCHAR(190) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_item_skus_code (sku_code)
    ) ENGINE=InnoDB
  `);
}

async function showCreate(connection, table) {
  const [[row]] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
  return row["Create Table"].replace(/ AUTO_INCREMENT=\d+/gu, "");
}

integrationTest("TASK-012 applies Inventory 0055-0060 with owned stock and immutable movements", async (t) => {
  const connection = await mysql.createConnection(config());
  t.after(() => connection.end());

  await createPrerequisites(connection);
  await seedInventoryPermissions(connection);
  await createInventoryOperations(connection);
  await createInventoryAudit(connection);
  await createInventoryMaster(connection);
  await createInventoryStock(connection);
  await createInventoryMovements(connection);

  assert.equal(await inspectInventoryStockSchema(connection), true);
  assert.equal(await inspectInventoryMovementSchema(connection), true);

  const tables = [
    "inventory_operation_requests",
    "inventory_audit_logs",
    "inventory_warehouses",
    "inventory_bins",
    "inventory_lots",
    "inventory_stock_controls",
    "inventory_stock_balances",
    "inventory_movements"
  ];
  const beforeRerun = Object.fromEntries(
    await Promise.all(tables.map(async (table) => [table, await showCreate(connection, table)]))
  );
  await seedInventoryPermissions(connection);
  await createInventoryOperations(connection);
  await createInventoryAudit(connection);
  await createInventoryMaster(connection);
  await createInventoryStock(connection);
  await createInventoryMovements(connection);
  assert.deepEqual(
    Object.fromEntries(
      await Promise.all(tables.map(async (table) => [table, await showCreate(connection, table)]))
    ),
    beforeRerun
  );

  const [[lotScope]] = await connection.query(
    `SELECT extra AS extra, generation_expression AS generation_expression
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'inventory_stock_balances'
        AND column_name = 'lot_scope'`
  );
  assert.match(lotScope.extra, /STORED GENERATED/iu);
  assert.match(lotScope.generation_expression, /ifnull\(`lot_id`,0\)/iu);

  const [movementIndexRows] = await connection.query(
    `SELECT index_name AS index_name,
            GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_list
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'inventory_movements'
      GROUP BY index_name`
  );
  assert.deepEqual(
    Object.fromEntries(movementIndexRows.map((row) => [row.index_name, row.columns_list])),
    {
      PRIMARY: "id",
      idx_inventory_movements_actor: "posted_by,posted_at,id",
      idx_inventory_movements_bin: "bin_id,posted_at,id",
      idx_inventory_movements_bin_owner: "bin_id,warehouse_id",
      idx_inventory_movements_group: "movement_group_id,id",
      idx_inventory_movements_lot: "lot_id,posted_at,id",
      idx_inventory_movements_lot_owner: "lot_id,sku_id",
      idx_inventory_movements_operation: "operation_request_id,id",
      idx_inventory_movements_sku: "sku_id,posted_at,id",
      idx_inventory_movements_time: "posted_at,id",
      idx_inventory_movements_type: "movement_type,posted_at,id",
      idx_inventory_movements_warehouse: "warehouse_id,posted_at,id",
      uq_inventory_movement_reversal: "reversal_of_movement_id"
    }
  );

  const [foreignKeyRows] = await connection.query(
    `SELECT kcu.table_name AS table_name, kcu.constraint_name AS constraint_name,
            GROUP_CONCAT(kcu.column_name ORDER BY kcu.ordinal_position) AS columns_list,
            rc.referenced_table_name AS referenced_table_name,
            GROUP_CONCAT(kcu.referenced_column_name ORDER BY kcu.ordinal_position) AS referenced_columns,
            rc.delete_rule AS delete_rule
       FROM information_schema.referential_constraints rc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_schema = rc.constraint_schema
        AND kcu.table_name = rc.table_name
        AND kcu.constraint_name = rc.constraint_name
      WHERE rc.constraint_schema = DATABASE()
        AND kcu.table_name IN ('inventory_stock_balances', 'inventory_movements')
      GROUP BY kcu.table_name, kcu.constraint_name, rc.referenced_table_name, rc.delete_rule`
  );
  const foreignKeys = new Map(foreignKeyRows.map((row) => [
    `${row.table_name}:${row.constraint_name}`,
    `${row.columns_list}->${row.referenced_table_name}:${row.referenced_columns}:${row.delete_rule}`
  ]));
  assert.equal(
    foreignKeys.get("inventory_stock_balances:fk_inventory_stock_balances_bin"),
    "bin_id,warehouse_id->inventory_bins:id,warehouse_id:RESTRICT"
  );
  assert.equal(
    foreignKeys.get("inventory_stock_balances:fk_inventory_stock_balances_lot"),
    "lot_id,sku_id->inventory_lots:id,sku_id:RESTRICT"
  );
  assert.equal(
    foreignKeys.get("inventory_movements:fk_inventory_movements_bin"),
    "bin_id,warehouse_id->inventory_bins:id,warehouse_id:RESTRICT"
  );
  assert.equal(
    foreignKeys.get("inventory_movements:fk_inventory_movements_lot"),
    "lot_id,sku_id->inventory_lots:id,sku_id:RESTRICT"
  );

  const suffix = randomUUID();
  const now = Date.now();
  const [actor] = await connection.execute(
    "INSERT INTO users (username) VALUES (?)",
    [`task012-${suffix}`]
  );
  const [firstSku] = await connection.execute(
    "INSERT INTO item_skus (sku_code, sku_name) VALUES (?, ?)",
    [`SKU-A-${suffix}`, "SKU A"]
  );
  const [secondSku] = await connection.execute(
    "INSERT INTO item_skus (sku_code, sku_name) VALUES (?, ?)",
    [`SKU-B-${suffix}`, "SKU B"]
  );
  const [firstWarehouse] = await connection.execute(
    `INSERT INTO inventory_warehouses (
       warehouse_code, normalized_code, warehouse_name, created_at, updated_at
     ) VALUES (?, ?, 'Main', ?, ?)`,
    [`MAIN-${suffix}`, `main-${suffix}`, now, now]
  );
  const [secondWarehouse] = await connection.execute(
    `INSERT INTO inventory_warehouses (
       warehouse_code, normalized_code, warehouse_name, created_at, updated_at
     ) VALUES (?, ?, 'Overflow', ?, ?)`,
    [`OVERFLOW-${suffix}`, `overflow-${suffix}`, now, now]
  );
  const [firstBin] = await connection.execute(
    `INSERT INTO inventory_bins (
       warehouse_id, bin_code, normalized_code, created_at, updated_at
     ) VALUES (?, 'A-01', ?, ?, ?)`,
    [firstWarehouse.insertId, `a-01-${suffix}`, now, now]
  );
  const [lot] = await connection.execute(
    `INSERT INTO inventory_lots (
       sku_id, lot_number, normalized_lot_number, first_receipt_date,
       sku_code_snapshot, created_at, created_by
     ) VALUES (?, ?, ?, '2026-09-25', ?, ?, ?)`,
    [firstSku.insertId, `LOT-${suffix}`, `lot-${suffix}`, `SKU-A-${suffix}`, now, actor.insertId]
  );

  const balanceValues = [
    firstWarehouse.insertId,
    firstBin.insertId,
    firstSku.insertId,
    "AVAILABLE",
    10,
    "2026-09-25",
    now,
    now
  ];
  await connection.execute(
    `INSERT INTO inventory_stock_balances (
       warehouse_id, bin_id, sku_id, stock_status, on_hand_quantity,
       fifo_anchor_date, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    balanceValues
  );
  await assert.rejects(
    () => connection.execute(
      `INSERT INTO inventory_stock_balances (
         warehouse_id, bin_id, sku_id, stock_status, on_hand_quantity,
         fifo_anchor_date, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      balanceValues
    ),
    (error) => error.code === "ER_DUP_ENTRY"
  );
  await assert.rejects(
    () => connection.execute(
      `INSERT INTO inventory_stock_balances (
         warehouse_id, bin_id, sku_id, lot_id, stock_status,
         on_hand_quantity, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'AVAILABLE', 1, ?, ?)`,
      [firstWarehouse.insertId, firstBin.insertId, secondSku.insertId, lot.insertId, now, now]
    ),
    (error) => error.code === "ER_NO_REFERENCED_ROW_2"
  );
  await assert.rejects(
    () => connection.execute(
      `INSERT INTO inventory_stock_balances (
         warehouse_id, bin_id, sku_id, stock_status,
         on_hand_quantity, fifo_anchor_date, created_at, updated_at
       ) VALUES (?, ?, ?, 'AVAILABLE', 1, '2026-09-25', ?, ?)`,
      [secondWarehouse.insertId, firstBin.insertId, firstSku.insertId, now, now]
    ),
    (error) => error.code === "ER_NO_REFERENCED_ROW_2"
  );

  const [operation] = await connection.execute(
    `INSERT INTO inventory_operation_requests (
       command_type, source_module, source_document_type, source_document_id,
       source_event_id, request_hash, actor_user_id, actor_label, created_at
     ) VALUES ('RECEIPT_POST', 'RECEIVING', 'GOODS_RECEIPT', ?, ?, ?, ?, ?, ?)`,
    [`GR-${suffix}`, `event-${suffix}`, "a".repeat(64), actor.insertId, `actor-${suffix}`, now]
  );
  const [movement] = await connection.execute(
    `INSERT INTO inventory_movements (
       movement_group_id, operation_request_id, movement_type, location_kind,
       warehouse_id, bin_id, sku_id, lot_id, stock_status, direction, quantity,
       balance_before, balance_after, balance_version_after,
       sku_code_snapshot, sku_name_snapshot, warehouse_code_snapshot,
       bin_code_snapshot, lot_number_snapshot, expiry_date_snapshot,
       posted_at, posted_by, posted_by_label
     ) VALUES (?, ?, 'RECEIPT', 'BIN', ?, ?, ?, ?, 'AVAILABLE', 'IN', 10,
               0, 10, 1, ?, 'SKU A', ?, 'A-01', ?, '2027-09-25', ?, ?, ?)`,
    [
      randomUUID(), operation.insertId, firstWarehouse.insertId, firstBin.insertId,
      firstSku.insertId, lot.insertId, `SKU-A-${suffix}`, `MAIN-${suffix}`,
      `LOT-${suffix}`, now, actor.insertId, `actor-${suffix}`
    ]
  );
  const [[storedMovement]] = await connection.query(
    `SELECT operation_request_id, posted_by, posted_by_label,
            sku_code_snapshot, warehouse_code_snapshot, bin_code_snapshot, lot_number_snapshot
       FROM inventory_movements WHERE id = ?`,
    [movement.insertId]
  );
  assert.deepEqual(storedMovement, {
    operation_request_id: operation.insertId,
    posted_by: actor.insertId,
    posted_by_label: `actor-${suffix}`,
    sku_code_snapshot: `SKU-A-${suffix}`,
    warehouse_code_snapshot: `MAIN-${suffix}`,
    bin_code_snapshot: "A-01",
    lot_number_snapshot: `LOT-${suffix}`
  });
  await assert.rejects(
    () => connection.execute(
      "UPDATE inventory_movements SET reason_text = 'changed' WHERE id = ?",
      [movement.insertId]
    ),
    (error) => error.code === "ER_SIGNAL_EXCEPTION" && /immutable/u.test(error.message)
  );
  await assert.rejects(
    () => connection.execute("DELETE FROM inventory_movements WHERE id = ?", [movement.insertId]),
    (error) => error.code === "ER_SIGNAL_EXCEPTION" && /immutable/u.test(error.message)
  );
});
