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

integrationTest("TASK-050 (HD-088): the list indexes exist, a rerun keeps them, and a same-named index on other columns is refused", async () => {
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  // try/finally：up() 拋錯都要還原 index 同關連線，否則測試會卡住而唔係失敗（REV-084 L-4）。
  try {
    await up(connection);
    await up(connection);
    assert.deepEqual(await indexColumns(connection, "idx_suppliers_updated_id"), ["updated_at", "id"]);
    assert.deepEqual(await indexColumns(connection, "idx_suppliers_name_id"), ["supplier_name", "id"]);
    // 同名但少咗 id：唔可以當成已經有。
    await connection.query("ALTER TABLE suppliers DROP INDEX idx_suppliers_name_id, ADD INDEX idx_suppliers_name_id (supplier_name)");
    await assert.rejects(() => up(connection), /suppliers\.idx_suppliers_name_id/u);
  } finally {
    if ((await indexColumns(connection, "idx_suppliers_name_id")).join(",") !== "supplier_name,id") {
      await connection.query("ALTER TABLE suppliers DROP INDEX idx_suppliers_name_id, ADD INDEX idx_suppliers_name_id (supplier_name, id)");
    }
    await connection.end();
  }
});

integrationTest("TASK-050 (REV-084 L-3): the migration gives up after its lock wait instead of stalling every Supplier query", async () => {
  const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME };
  const [migrating, holder] = [await mysql.createConnection(config), await mysql.createConnection(config)];
  let attempt = null;
  try {
    await migrating.query("ALTER TABLE suppliers DROP INDEX idx_suppliers_name_id");
    // 一個開住冇做完嘅 transaction 揸住 suppliers 嘅 metadata lock。
    await holder.beginTransaction();
    await holder.query("SELECT id FROM suppliers LIMIT 1");
    // 限時 10 秒：冇咗自己嘅 lock wait，ALTER 會等 server 嘅預設（一年），測試要失敗而唔係卡住。
    attempt = up(migrating, { lockWaitSeconds: 1 });
    const outcome = await Promise.race([attempt.then(() => "added while the lock was held", (error) => error),
      new Promise((resolve) => { setTimeout(() => resolve("still waiting after 10 s"), 10_000).unref(); })]);
    assert.match(String(outcome?.message ?? outcome), /metadata lock on suppliers/u);
    await holder.rollback();
    await up(migrating);
    assert.deepEqual(await indexColumns(migrating, "idx_suppliers_name_id"), ["supplier_name", "id"], "a rerun after the transaction ends succeeds");
  } finally {
    await holder.rollback().catch(() => {});
    await attempt?.catch(() => {});
    if ((await indexColumns(migrating, "idx_suppliers_name_id")).length === 0) {
      await migrating.query("ALTER TABLE suppliers ADD INDEX idx_suppliers_name_id (supplier_name, id)");
    }
    await Promise.all([migrating.end(), holder.end()]);
  }
});
