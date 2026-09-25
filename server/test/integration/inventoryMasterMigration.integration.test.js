import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";

import {
  inspectInventoryMasterSchema,
  up
} from "../../database/migrations/0058_create_inventory_master.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" &&
  process.env.INVENTORY_MASTER_MIGRATION_TESTS === "1" ? test : test.skip;

function config() {
  const database = process.env.DB_NAME;
  if (!/^erp_inventory_task008_[a-z0-9_]+$/u.test(database ?? "")) {
    throw new Error("TASK-008 migration test requires a disposable erp_inventory_task008_* schema");
  }
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database
  };
}

async function showCreate(connection, table) {
  const [[row]] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
  return row["Create Table"].replace(/ AUTO_INCREMENT=\d+/gu, "");
}

integrationTest("TASK-008 creates rerunnable Warehouse and Bin persistence constraints", async (t) => {
  const connection = await mysql.createConnection(config());
  t.after(() => connection.end());

  await connection.query(`
    CREATE TABLE users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(190) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_username (username)
    ) ENGINE=InnoDB
  `);

  await up(connection);
  assert.equal(await inspectInventoryMasterSchema(connection), true);
  const firstWarehouseDefinition = await showCreate(connection, "inventory_warehouses");
  const firstBinDefinition = await showCreate(connection, "inventory_bins");

  await up(connection);
  assert.equal(await showCreate(connection, "inventory_warehouses"), firstWarehouseDefinition);
  assert.equal(await showCreate(connection, "inventory_bins"), firstBinDefinition);

  await connection.query("DROP TABLE inventory_bins");
  await up(connection);
  assert.equal(await inspectInventoryMasterSchema(connection), true);
  assert.equal(await showCreate(connection, "inventory_warehouses"), firstWarehouseDefinition);
  assert.equal(await showCreate(connection, "inventory_bins"), firstBinDefinition);

  const [indexRows] = await connection.query(
    `SELECT table_name AS table_name, index_name AS index_name,
            non_unique AS non_unique,
            GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_list
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name IN ('inventory_warehouses', 'inventory_bins')
      GROUP BY table_name, index_name, non_unique`
  );
  const indexes = new Map(indexRows.map((row) => [
    `${row.table_name}:${row.index_name}`,
    `${Number(row.non_unique)}:${row.columns_list}`
  ]));
  assert.equal(indexes.get("inventory_warehouses:uq_inventory_warehouses_code"), "0:normalized_code");
  assert.equal(indexes.get("inventory_warehouses:idx_inventory_warehouses_list"), "1:status,warehouse_name,id");
  assert.equal(indexes.get("inventory_bins:uq_inventory_bins_code"), "0:warehouse_id,normalized_code");
  assert.equal(indexes.get("inventory_bins:uq_inventory_bins_id_warehouse"), "0:id,warehouse_id");
  assert.equal(indexes.get("inventory_bins:idx_inventory_bins_list"), "1:warehouse_id,status,bin_code,id");

  const [foreignKeyRows] = await connection.query(
    `SELECT table_name AS table_name, constraint_name AS constraint_name,
            referenced_table_name AS referenced_table_name, delete_rule AS delete_rule
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE()
        AND table_name IN ('inventory_warehouses', 'inventory_bins')
      ORDER BY table_name, constraint_name`
  );
  assert.deepEqual(foreignKeyRows.map((row) => [
    row.table_name,
    row.constraint_name,
    row.referenced_table_name,
    row.delete_rule
  ]), [
    ["inventory_bins", "fk_inventory_bins_created_by", "users", "SET NULL"],
    ["inventory_bins", "fk_inventory_bins_updated_by", "users", "SET NULL"],
    ["inventory_bins", "fk_inventory_bins_warehouse", "inventory_warehouses", "RESTRICT"],
    ["inventory_warehouses", "fk_inventory_warehouses_created_by", "users", "SET NULL"],
    ["inventory_warehouses", "fk_inventory_warehouses_updated_by", "users", "SET NULL"]
  ]);

  const suffix = randomUUID();
  const now = Date.now();
  const [actor] = await connection.execute(
    "INSERT INTO users (username) VALUES (?)",
    [`task008-${suffix}`]
  );
  const [firstWarehouse] = await connection.execute(
    `INSERT INTO inventory_warehouses (
       warehouse_code, normalized_code, warehouse_name, created_at, updated_at, created_by, updated_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`Main-${suffix}`, `main-${suffix}`, "Main", now, now, actor.insertId, actor.insertId]
  );
  const [secondWarehouse] = await connection.execute(
    `INSERT INTO inventory_warehouses (
       warehouse_code, normalized_code, warehouse_name, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?)`,
    [`Overflow-${suffix}`, `overflow-${suffix}`, "Overflow", now, now]
  );
  await assert.rejects(
    () => connection.execute(
      `INSERT INTO inventory_warehouses (
         warehouse_code, normalized_code, warehouse_name, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)`,
      [`MAIN-${suffix}`, `main-${suffix}`, "Duplicate", now, now]
    ),
    (error) => error.code === "ER_DUP_ENTRY"
  );

  const binValues = (warehouseId, code, actorId = null) => [
    warehouseId, code, `a-${suffix}`, code, now, now, actorId, actorId
  ];
  const [firstBin] = await connection.execute(
    `INSERT INTO inventory_bins (
       warehouse_id, bin_code, normalized_code, bin_name, created_at, updated_at, created_by, updated_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    binValues(firstWarehouse.insertId, `A-${suffix}`, actor.insertId)
  );
  await connection.execute(
    `INSERT INTO inventory_bins (
       warehouse_id, bin_code, normalized_code, bin_name, created_at, updated_at, created_by, updated_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    binValues(secondWarehouse.insertId, `A-${suffix}`)
  );
  await assert.rejects(
    () => connection.execute(
      `INSERT INTO inventory_bins (
         warehouse_id, bin_code, normalized_code, bin_name, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [firstWarehouse.insertId, `a-${suffix}`, `a-${suffix}`, "Duplicate", now, now]
    ),
    (error) => error.code === "ER_DUP_ENTRY"
  );
  await assert.rejects(
    () => connection.execute("DELETE FROM inventory_warehouses WHERE id = ?", [firstWarehouse.insertId]),
    (error) => error.code === "ER_ROW_IS_REFERENCED_2"
  );
  await assert.rejects(
    () => connection.execute(
      `INSERT INTO inventory_warehouses (
         warehouse_code, normalized_code, warehouse_name, status, created_at, updated_at
       ) VALUES (?, ?, 'Invalid', 'invalid', ?, ?)`,
      [`Invalid-${suffix}`, `invalid-${suffix}`, now, now]
    ),
    (error) => error.code === "ER_CHECK_CONSTRAINT_VIOLATED"
  );

  await connection.execute("DELETE FROM users WHERE id = ?", [actor.insertId]);
  const [[warehouse]] = await connection.execute(
    "SELECT status, version, created_by, updated_by FROM inventory_warehouses WHERE id = ?",
    [firstWarehouse.insertId]
  );
  const [[bin]] = await connection.execute(
    "SELECT status, version, created_by, updated_by FROM inventory_bins WHERE id = ?",
    [firstBin.insertId]
  );
  assert.deepEqual(warehouse, { status: "ACTIVE", version: 1, created_by: null, updated_by: null });
  assert.deepEqual(bin, { status: "ACTIVE", version: 1, created_by: null, updated_by: null });
});
