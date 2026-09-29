import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";

import { up as seedInventoryPermissions } from "../../database/migrations/0055_seed_inventory_permissions.js";
import { up as createInventoryOperations } from "../../database/migrations/0056_create_inventory_operations.js";
import { up as createInventoryAudit } from "../../database/migrations/0057_create_inventory_audit.js";
import { up as createInventoryMaster } from "../../database/migrations/0058_create_inventory_master.js";
import { up as createInventoryStock } from "../../database/migrations/0059_create_inventory_stock.js";
import { up as createInventoryMovements } from "../../database/migrations/0060_create_inventory_movements.js";
import {
  inspectInventoryReservationSchema,
  up as createInventoryReservations
} from "../../database/migrations/0061_create_inventory_reservations.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" &&
  process.env.INVENTORY_RESERVATION_MIGRATION_TESTS === "1" ? test : test.skip;

function config() {
  const database = process.env.DB_NAME;
  if (!/^erp_inventory_task019_[a-z0-9_]+$/u.test(database ?? "")) {
    throw new Error("TASK-019 migration test requires a disposable erp_inventory_task019_* schema");
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

async function migrate(connection) {
  await seedInventoryPermissions(connection);
  await createInventoryOperations(connection);
  await createInventoryAudit(connection);
  await createInventoryMaster(connection);
  await createInventoryStock(connection);
  await createInventoryMovements(connection);
  await createInventoryReservations(connection);
}

async function showCreate(connection, table) {
  const [[row]] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
  return row["Create Table"].replace(/ AUTO_INCREMENT=\d+/gu, "");
}

async function createOperation(connection, actorId, suffix, commandType) {
  const [result] = await connection.execute(
    `INSERT INTO inventory_operation_requests (
       command_type, source_module, source_document_type, source_document_id,
       source_event_id, request_hash, actor_user_id, actor_label, created_at
     ) VALUES (?, 'SALES', 'SALES_ORDER', ?, ?, ?, ?, ?, ?)`,
    [commandType, `SO-${suffix}`, `${commandType}-${suffix}`, "a".repeat(64),
      actorId, `actor-${suffix}`, Date.now()]
  );
  return result.insertId;
}

integrationTest("TASK-019 creates rerunnable Reservation and Allocation persistence", async (t) => {
  const connection = await mysql.createConnection(config());
  t.after(() => connection.end());

  await createPrerequisites(connection);
  await migrate(connection);
  assert.equal(await inspectInventoryReservationSchema(connection), true);

  const [downstreamPermissions] = await connection.query(
    "SELECT name FROM permissions WHERE name IN ('sales.operation', 'fulfillment.operation') ORDER BY name"
  );
  assert.deepEqual(downstreamPermissions.map(({ name }) => name), ["fulfillment.operation", "sales.operation"]);

  const tables = ["inventory_reservations", "inventory_allocations", "inventory_movements"];
  const beforeRerun = Object.fromEntries(
    await Promise.all(tables.map(async (table) => [table, await showCreate(connection, table)]))
  );
  await createInventoryReservations(connection);
  const [permissionsAfterRerun] = await connection.query(
    "SELECT name FROM permissions WHERE name IN ('sales.operation', 'fulfillment.operation') ORDER BY name"
  );
  assert.deepEqual(permissionsAfterRerun, downstreamPermissions);
  assert.deepEqual(
    Object.fromEntries(
      await Promise.all(tables.map(async (table) => [table, await showCreate(connection, table)]))
    ),
    beforeRerun
  );

  const [indexRows] = await connection.query(
    `SELECT table_name AS table_name, index_name AS index_name, non_unique AS non_unique,
            GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_list
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name IN ('inventory_reservations', 'inventory_allocations')
      GROUP BY table_name, index_name, non_unique`
  );
  const indexes = new Set(indexRows.map((row) =>
    `${row.table_name}:${row.index_name}:${Number(row.non_unique)}:${row.columns_list}`
  ));
  for (const expected of [
    "inventory_reservations:uq_inventory_reservations_operation:0:create_operation_id",
    "inventory_reservations:idx_inventory_reservations_scope:1:warehouse_id,sku_id,status,id",
    "inventory_reservations:idx_inventory_reservations_status:1:status,updated_at,id",
    "inventory_allocations:idx_inventory_allocations_reservation:1:reservation_id,status,id",
    "inventory_allocations:idx_inventory_allocations_balance:1:stock_balance_id,status,id",
    "inventory_allocations:idx_inventory_allocations_operation:1:create_operation_id,id"
  ]) assert.equal(indexes.has(expected), true, expected);

  const [quantityColumns] = await connection.query(
    `SELECT table_name AS table_name, column_name AS column_name, column_type AS column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name IN ('inventory_reservations', 'inventory_allocations')
        AND column_name IN (
          'original_quantity', 'allocated_quantity', 'consumed_quantity',
          'released_quantity', 'outstanding_quantity'
        )`
  );
  assert.equal(quantityColumns.length, 8);
  assert.equal(quantityColumns.every((row) => row.column_type === "bigint unsigned"), true);

  const [foreignKeyRows] = await connection.query(
    `SELECT table_name AS table_name, constraint_name AS constraint_name,
            referenced_table_name AS referenced_table_name, delete_rule AS delete_rule
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE()
        AND table_name IN ('inventory_reservations', 'inventory_allocations', 'inventory_movements')`
  );
  const foreignKeys = new Map(foreignKeyRows.map((row) => [
    `${row.table_name}:${row.constraint_name}`,
    `${row.referenced_table_name}:${row.delete_rule}`
  ]));
  for (const [name, rule] of [
    ["inventory_reservations:fk_inventory_reservations_create_operation", "inventory_operation_requests:RESTRICT"],
    ["inventory_reservations:fk_inventory_reservations_warehouse", "inventory_warehouses:RESTRICT"],
    ["inventory_reservations:fk_inventory_reservations_sku", "item_skus:RESTRICT"],
    ["inventory_reservations:fk_inventory_reservations_created_by", "users:SET NULL"],
    ["inventory_reservations:fk_inventory_reservations_updated_by", "users:SET NULL"],
    ["inventory_allocations:fk_inventory_allocations_create_operation", "inventory_operation_requests:RESTRICT"],
    ["inventory_allocations:fk_inventory_allocations_reservation", "inventory_reservations:RESTRICT"],
    ["inventory_allocations:fk_inventory_allocations_stock_balance", "inventory_stock_balances:RESTRICT"],
    ["inventory_allocations:fk_inventory_allocations_created_by", "users:SET NULL"],
    ["inventory_allocations:fk_inventory_allocations_updated_by", "users:SET NULL"],
    ["inventory_movements:fk_inventory_movements_reservation", "inventory_reservations:RESTRICT"],
    ["inventory_movements:fk_inventory_movements_allocation", "inventory_allocations:RESTRICT"]
  ]) assert.equal(foreignKeys.get(name), rule, name);

  const suffix = randomUUID();
  const now = Date.now();
  const [actor] = await connection.execute("INSERT INTO users (username) VALUES (?)", [`task019-${suffix}`]);
  const [sku] = await connection.execute(
    "INSERT INTO item_skus (sku_code, sku_name) VALUES (?, 'Task 019 SKU')",
    [`SKU-${suffix}`]
  );
  const [warehouse] = await connection.execute(
    `INSERT INTO inventory_warehouses (
       warehouse_code, normalized_code, warehouse_name, created_at, updated_at
     ) VALUES (?, ?, 'Main', ?, ?)`,
    [`MAIN-${suffix}`, `main-${suffix}`, now, now]
  );
  const [bin] = await connection.execute(
    `INSERT INTO inventory_bins (
       warehouse_id, bin_code, normalized_code, created_at, updated_at
     ) VALUES (?, 'A-01', ?, ?, ?)`,
    [warehouse.insertId, `a-01-${suffix}`, now, now]
  );
  const [balance] = await connection.execute(
    `INSERT INTO inventory_stock_balances (
       warehouse_id, bin_id, sku_id, stock_status, on_hand_quantity,
       fifo_anchor_date, created_at, updated_at
     ) VALUES (?, ?, ?, 'AVAILABLE', 10, '2026-09-28', ?, ?)`,
    [warehouse.insertId, bin.insertId, sku.insertId, now, now]
  );
  const reservationOperationId = await createOperation(
    connection, actor.insertId, suffix, "RESERVATION_CREATE"
  );
  const allocationOperationId = await createOperation(
    connection, actor.insertId, suffix, "ALLOCATION_CREATE"
  );
  const [reservation] = await connection.execute(
    `INSERT INTO inventory_reservations (
       create_operation_id, warehouse_id, sku_id, original_quantity,
       consumed_quantity, released_quantity, outstanding_quantity,
       minimum_remaining_days, purpose, status, created_at, updated_at, created_by, updated_by
     ) VALUES (?, ?, ?, 10, 2, 3, 5, 0, 'SALE', 'PARTIALLY_CONSUMED', ?, ?, ?, ?)`,
    [reservationOperationId, warehouse.insertId, sku.insertId, now, now, actor.insertId, actor.insertId]
  );
  const [allocation] = await connection.execute(
    `INSERT INTO inventory_allocations (
       create_operation_id, reservation_id, stock_balance_id,
       allocated_quantity, consumed_quantity, released_quantity, outstanding_quantity,
       selection_strategy, recommended_rank_snapshot, status,
       created_at, updated_at, created_by, updated_by
     ) VALUES (?, ?, ?, 5, 1, 1, 3, 'FEFO', 1, 'PARTIALLY_CONSUMED', ?, ?, ?, ?)`,
    [allocationOperationId, reservation.insertId, balance.insertId,
      now, now, actor.insertId, actor.insertId]
  );
  assert.ok(reservation.insertId > 0 && allocation.insertId > 0);

  await assert.rejects(
    () => connection.execute(
      `INSERT INTO inventory_reservations (
         create_operation_id, warehouse_id, sku_id, original_quantity, outstanding_quantity,
         minimum_remaining_days, purpose, status, created_at, updated_at
       ) VALUES (?, ?, ?, 10, 9, 0, 'SALE', 'ACTIVE', ?, ?)`,
      [allocationOperationId, warehouse.insertId, sku.insertId, now, now]
    ),
    (error) => error.code === "ER_CHECK_CONSTRAINT_VIOLATED"
  );
  await assert.rejects(
    () => connection.execute(
      `INSERT INTO inventory_allocations (
         create_operation_id, reservation_id, stock_balance_id,
         allocated_quantity, outstanding_quantity, selection_strategy,
         is_sequence_override, recommended_rank_snapshot, recommended_summary,
         override_reason, status, created_at, updated_at
       ) VALUES (?, ?, ?, 1, 1, 'FEFO', 1, 0, JSON_OBJECT('balanceId', ?),
                 'bad', 'ACTIVE', ?, ?)`,
      [allocationOperationId, reservation.insertId, balance.insertId, balance.insertId, now, now]
    ),
    (error) => error.code === "ER_CHECK_CONSTRAINT_VIOLATED"
  );
  await assert.rejects(
    () => connection.execute(
      `INSERT INTO inventory_allocations (
         create_operation_id, reservation_id, stock_balance_id,
         allocated_quantity, outstanding_quantity, selection_strategy, status, created_at, updated_at
       ) VALUES (?, ?, ?, 5, 4, 'FEFO', 'ACTIVE', ?, ?)`,
      [allocationOperationId, reservation.insertId, balance.insertId, now, now]
    ),
    (error) => error.code === "ER_CHECK_CONSTRAINT_VIOLATED"
  );
  await assert.rejects(
    () => connection.execute(
      "DELETE FROM inventory_operation_requests WHERE id = ?",
      [reservationOperationId]
    ),
    (error) => error.code === "ER_ROW_IS_REFERENCED_2"
  );

  await connection.execute("DELETE FROM users WHERE id = ?", [actor.insertId]);
  const [[storedReservation]] = await connection.execute(
    "SELECT version, created_by, updated_by FROM inventory_reservations WHERE id = ?",
    [reservation.insertId]
  );
  const [[storedAllocation]] = await connection.execute(
    `SELECT version, is_sequence_override, override_reason, created_by, updated_by
       FROM inventory_allocations WHERE id = ?`,
    [allocation.insertId]
  );
  assert.deepEqual(storedReservation, { version: 1, created_by: null, updated_by: null });
  assert.deepEqual(storedAllocation, {
    version: 1,
    is_sequence_override: 0,
    override_reason: "",
    created_by: null,
    updated_by: null
  });
});
