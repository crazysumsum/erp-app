import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import mysql from "mysql2/promise";
import { up } from "../../database/migrations/0082_add_customer_search_indexes.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const config = () => ({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

async function indexes(connection) {
  const [rows] = await connection.query(
    `SELECT table_name AS table_name, index_name AS index_name, column_name AS column_name,
            sub_part AS sub_part, non_unique AS non_unique, is_visible AS is_visible
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND index_name LIKE 'idx_customer%search%'
      ORDER BY table_name, index_name, seq_in_index`
  );
  return rows;
}

integrationTest("TC-028 Customer prefix indexes install, rerun safely and reject an incompatible real index", async (t) => {
  const connection = await mysql.createConnection(config());
  try {
    const started = performance.now();
    await up(connection);
    t.diagnostic(`Customer search index up elapsed ${performance.now() - started}ms (existing row count must be considered separately)`);
    const actual = await indexes(connection);
    assert.equal(new Set(actual.map((row) => row.index_name)).size, 10);
    assert.ok(actual.every((row) => row.sub_part === null && Number(row.non_unique) === 1 && row.is_visible === "YES"));
    await up(connection);
    assert.deepEqual(await indexes(connection), actual);
    await connection.query("ALTER TABLE customers DROP INDEX idx_customers_search_email, ADD INDEX idx_customers_search_email (general_email(8), id)");
    await assert.rejects(() => up(connection), /Incompatible existing Customer search index: customers.idx_customers_search_email/);
  } finally {
    const actual = (await indexes(connection)).filter((row) => row.index_name === "idx_customers_search_email");
    if (actual.some((row) => row.sub_part !== null)) await connection.query("ALTER TABLE customers DROP INDEX idx_customers_search_email");
    await up(connection);
    await connection.end();
  }
});

integrationTest("TC-028 Customer index migration bounds a real metadata-lock wait and restores its session", async () => {
  const [connection, holder] = await Promise.all([mysql.createConnection(config()), mysql.createConnection(config())]);
  let attempt;
  try {
    await connection.query("ALTER TABLE customers DROP INDEX idx_customers_search_email");
    const [[{ previous }]] = await connection.query("SELECT @@SESSION.lock_wait_timeout AS previous");
    await holder.beginTransaction();
    await holder.query("SELECT id FROM customers LIMIT 1");
    attempt = up(connection, { lockWaitSeconds: 1 });
    const outcome = await Promise.race([
      attempt.then(() => "unexpected success", (error) => error),
      new Promise((resolve) => setTimeout(() => resolve("still waiting after 10 seconds"), 10_000).unref())
    ]);
    assert.match(String(outcome?.message ?? outcome), /metadata lock/);
    const [[{ current }]] = await connection.query("SELECT @@SESSION.lock_wait_timeout AS current");
    assert.equal(Number(current), Number(previous));
    await holder.rollback();
    await up(connection);
    assert.equal((await indexes(connection)).filter((row) => row.index_name === "idx_customers_search_email").length, 2);
  } finally {
    await holder.rollback();
    await attempt?.catch(() => {});
    await up(connection);
    await Promise.all([connection.end(), holder.end()]);
  }
});
