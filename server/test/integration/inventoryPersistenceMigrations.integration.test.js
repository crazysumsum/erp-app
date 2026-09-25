import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

import { up as seedInventoryPermissions } from "../../database/migrations/0055_seed_inventory_permissions.js";
import { up as createInventoryOperations } from "../../database/migrations/0056_create_inventory_operations.js";
import { up as createInventoryAudit } from "../../database/migrations/0057_create_inventory_audit.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

function config() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  };
}

async function createPrerequisites(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(190) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_username (username)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(190) NOT NULL,
      description VARCHAR(255) NOT NULL DEFAULT '',
      created_at BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_permissions_name (name)
    ) ENGINE=InnoDB
  `);
}

async function showCreate(connection, table) {
  const [[row]] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
  return row["Create Table"].replace(/ AUTO_INCREMENT=\d+/gu, "");
}

integrationTest("TASK-005 creates durable operation identity and immutable Inventory audit persistence", async (t) => {
  const first = await mysql.createConnection(config());
  const second = await mysql.createConnection(config());
  t.after(async () => Promise.all([first.end(), second.end()]));

  await createPrerequisites(first);
  await seedInventoryPermissions(first);
  await createInventoryOperations(first);
  await createInventoryAudit(first);

  const beforeRerun = {
    operations: await showCreate(first, "inventory_operation_requests"),
    audit: await showCreate(first, "inventory_audit_logs")
  };
  await seedInventoryPermissions(first);
  await createInventoryOperations(first);
  await createInventoryAudit(first);
  assert.deepEqual({
    operations: await showCreate(first, "inventory_operation_requests"),
    audit: await showCreate(first, "inventory_audit_logs")
  }, beforeRerun);

  const [permissions] = await first.query(
    "SELECT name FROM permissions WHERE name LIKE 'inventory.%' ORDER BY name"
  );
  assert.deepEqual(permissions.map(({ name }) => name), [
    "inventory.adjust",
    "inventory.fefo.override",
    "inventory.mgmt",
    "inventory.operation",
    "inventory.view"
  ]);

  const [columns] = await first.query(
    `SELECT table_name AS table_name, column_name AS column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name IN ('inventory_operation_requests', 'inventory_audit_logs')
      ORDER BY table_name, ordinal_position`
  );
  const columnsByTable = Object.groupBy(columns, ({ table_name }) => table_name);
  assert.deepEqual(columnsByTable.inventory_operation_requests.map(({ column_name }) => column_name), [
    "id", "command_type", "source_module", "source_document_type", "source_document_id",
    "source_line_id", "source_event_id", "request_hash", "result_type", "result_id",
    "result_summary", "completed_at", "actor_user_id", "actor_label", "request_id",
    "correlation_id", "created_at"
  ]);
  assert.deepEqual(columnsByTable.inventory_audit_logs.map(({ column_name }) => column_name), [
    "id", "occurred_at", "actor_user_id", "actor_label", "action", "target_type",
    "target_id", "target_label", "outcome", "reason_category", "reason_text",
    "before_summary", "after_summary", "operation_request_id", "request_id",
    "correlation_id", "ip"
  ]);

  const [operationIndexes] = await first.query(
    `SELECT index_name AS index_name, non_unique AS non_unique,
            GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_list
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'inventory_operation_requests'
      GROUP BY index_name, non_unique`
  );
  const operationIndexMap = new Map(operationIndexes.map((row) => [row.index_name, row]));
  assert.equal(Number(operationIndexMap.get("uq_inventory_source_operation").non_unique), 0);
  assert.equal(
    operationIndexMap.get("uq_inventory_source_operation").columns_list,
    "source_module,source_document_type,source_document_id,source_line_id,source_event_id"
  );
  assert.equal(
    operationIndexMap.get("idx_inventory_operations_source").columns_list,
    "source_module,source_document_type,source_document_id,source_line_id,id"
  );
  assert.equal(operationIndexMap.get("idx_inventory_operations_created").columns_list, "created_at,id");

  const [auditIndexes] = await first.query(
    `SELECT index_name AS index_name,
            GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_list
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'inventory_audit_logs'
      GROUP BY index_name`
  );
  assert.deepEqual(
    Object.fromEntries(auditIndexes.map((row) => [row.index_name, row.columns_list])),
    {
      PRIMARY: "id",
      idx_inventory_audit_actor: "actor_user_id,occurred_at,id",
      idx_inventory_audit_operation: "operation_request_id,id",
      idx_inventory_audit_target: "target_type,target_id,occurred_at,id",
      idx_inventory_audit_time: "occurred_at,id"
    }
  );

  const [foreignKeys] = await first.query(
    `SELECT table_name AS table_name, constraint_name AS constraint_name,
            referenced_table_name AS referenced_table_name, delete_rule AS delete_rule
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE()
        AND table_name IN ('inventory_operation_requests', 'inventory_audit_logs')
      ORDER BY table_name, constraint_name`
  );
  assert.deepEqual(foreignKeys.map((row) => [
    row.table_name,
    row.constraint_name,
    row.referenced_table_name,
    row.delete_rule
  ]), [
    ["inventory_audit_logs", "fk_inventory_audit_actor", "users", "SET NULL"],
    ["inventory_audit_logs", "fk_inventory_audit_operation", "inventory_operation_requests", "RESTRICT"],
    ["inventory_operation_requests", "fk_inventory_operations_actor", "users", "SET NULL"]
  ]);

  const suffix = randomUUID();
  const [actor] = await first.execute(
    "INSERT INTO users (username) VALUES (?)",
    [`inventory-migration-${suffix}`]
  );
  const insertOperation = (connection, commandType, requestHash) => connection.execute(
    `INSERT INTO inventory_operation_requests (
       command_type, source_module, source_document_type, source_document_id,
       source_event_id, request_hash, actor_user_id, actor_label, created_at
     ) VALUES (?, 'RECEIVING', 'PURCHASE_RECEIPT', ?, ?, ?, ?, ?, ?)`,
    [commandType, `receipt-${suffix}`, `event-${suffix}`, requestHash, actor.insertId, `actor-${suffix}`, Date.now()]
  );
  const race = await Promise.allSettled([
    insertOperation(first, "RECEIPT_POST", "a".repeat(64)),
    insertOperation(second, "ISSUE_POST", "b".repeat(64))
  ]);
  assert.equal(race.filter(({ status }) => status === "fulfilled").length, 1);
  const loser = race.find(({ status }) => status === "rejected");
  assert.equal(loser.reason.code, "ER_DUP_ENTRY");

  const [[operation]] = await first.query(
    `SELECT id, source_line_id FROM inventory_operation_requests
      WHERE source_module = 'RECEIVING' AND source_document_type = 'PURCHASE_RECEIPT'
        AND source_document_id = ? AND source_event_id = ?`,
    [`receipt-${suffix}`, `event-${suffix}`]
  );
  assert.equal(operation.source_line_id, "");

  const [audit] = await first.execute(
    `INSERT INTO inventory_audit_logs (
       occurred_at, actor_user_id, actor_label, action, target_type, target_id,
       target_label, outcome, operation_request_id
     ) VALUES (?, ?, ?, 'receipt.post', 'movement_group', 1, ?, 'SUCCEEDED', ?)`,
    [Date.now(), actor.insertId, `actor-${suffix}`, `movement-${suffix}`, operation.id]
  );
  await assert.rejects(
    () => first.execute(
      `INSERT INTO inventory_audit_logs (
         occurred_at, actor_label, action, target_type, target_label, outcome
       ) VALUES (?, 'system', 'receipt.post', 'movement_group', 'invalid', 'UNKNOWN')`,
      [Date.now()]
    ),
    (error) => error.code === "ER_CHECK_CONSTRAINT_VIOLATED"
  );
  await assert.rejects(
    () => first.execute(
      `INSERT INTO inventory_audit_logs (
         occurred_at, actor_label, action, target_type, target_label, outcome
       ) VALUES (?, 'system', 'receipt.post', 'movement_group', 'invalid', 'succeeded')`,
      [Date.now()]
    ),
    (error) => error.code === "ER_CHECK_CONSTRAINT_VIOLATED"
  );
  await assert.rejects(
    () => first.execute("UPDATE inventory_audit_logs SET target_label = 'changed' WHERE id = ?", [audit.insertId]),
    (error) => error.code === "ER_SIGNAL_EXCEPTION" && /immutable/u.test(error.message)
  );
  await assert.rejects(
    () => first.execute("DELETE FROM inventory_audit_logs WHERE id = ?", [audit.insertId]),
    (error) => error.code === "ER_SIGNAL_EXCEPTION" && /immutable/u.test(error.message)
  );
  await assert.rejects(
    () => first.execute("DELETE FROM inventory_operation_requests WHERE id = ?", [operation.id]),
    (error) => error.code === "ER_ROW_IS_REFERENCED_2"
  );

  await first.execute("DELETE FROM users WHERE id = ?", [actor.insertId]);
  const [[snapshots]] = await first.query(
    `SELECT operation.actor_user_id AS operation_actor_id,
            operation.actor_label AS operation_actor_label,
            audit.actor_user_id AS audit_actor_id,
            audit.actor_label AS audit_actor_label
       FROM inventory_operation_requests operation
       JOIN inventory_audit_logs audit ON audit.operation_request_id = operation.id
      WHERE operation.id = ? AND audit.id = ?`,
    [operation.id, audit.insertId]
  );
  assert.deepEqual(snapshots, {
    operation_actor_id: null,
    operation_actor_label: `actor-${suffix}`,
    audit_actor_id: null,
    audit_actor_label: `actor-${suffix}`
  });

  const [[movement]] = await first.query(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'inventory_movements'"
  );
  assert.equal(Number(movement.count), 0);
});
