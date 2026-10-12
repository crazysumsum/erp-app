import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { up } from "../../database/migrations/0080_add_supplier_list_indexes.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

async function indexColumns(connection, name) {
  const [rows] = await connection.query(
    `SELECT column_name AS column_name FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'suppliers' AND index_name = ? ORDER BY seq_in_index`, [name]);
  return rows.map((row) => row.column_name);
}

integrationTest("TASK-050 (HD-088): the list indexes exist, a rerun keeps them, and a same-named index on other columns is refused", async (t) => {
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  await up(connection);
  await up(connection);
  assert.deepEqual(await indexColumns(connection, "idx_suppliers_updated_id"), ["updated_at", "id"]);
  assert.deepEqual(await indexColumns(connection, "idx_suppliers_name_id"), ["supplier_name", "id"]);

  // 同名但少咗 id：唔可以當成已經有。測完還原。
  t.after(async () => {
    await connection.query("ALTER TABLE suppliers DROP INDEX idx_suppliers_name_id");
    await connection.query("ALTER TABLE suppliers ADD INDEX idx_suppliers_name_id (supplier_name, id)");
  });
  t.after(() => connection.end()); // after hook 按登記次序行：還原之後先關
  await connection.query("ALTER TABLE suppliers DROP INDEX idx_suppliers_name_id, ADD INDEX idx_suppliers_name_id (supplier_name)");
  await assert.rejects(() => up(connection), /suppliers\.idx_suppliers_name_id/u);
});
