import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

import { down, up } from "../../database/migrations/0087_fix_supplier_sku_refs_sku_foreign_key.js";

/**
 * DEF-029／HD-113：0087 喺一張 `supplier_sku_refs` 嘅複製表上做，唔郁真表（其他測試檔可能同時用緊佢）。
 * 真表修好咗冇，由 TC-082 嘅直接 DB 寫入釘住。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const config = () => ({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

/** 複製表，還原 0081 嘅樣：冇 `(sku_id)` index，FK 由複合 index 負責。 */
async function originalProbe(connection) {
  const table = `skr87_${randomUUID().slice(0, 8)}`;
  await connection.query(`CREATE TABLE \`${table}\` LIKE supplier_sku_refs`);
  await connection.query(`ALTER TABLE \`${table}\` DROP INDEX idx_supplier_sku_refs_sku`);
  await connection.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`fk_${table}_sku\` FOREIGN KEY (sku_id) REFERENCES item_skus (id) ON DELETE RESTRICT`);
  return table;
}

const indexOrder = async (connection, table) =>
  [...new Set((await connection.query(`SHOW INDEX FROM \`${table}\``))[0].map((row) => row.Key_name))].filter((name) => name.startsWith("idx_"));

const hasForeignKey = async (connection, table) => (await connection.query(
  `SELECT 1 FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ?`,
  [table, `fk_${table}_sku`]))[0].length === 1;

/** 寫一行指向唔存在 SKU 嘅關係；回傳 server 有冇擋。 */
async function orphanRefused(connection, table) {
  try {
    await connection.query(`INSERT INTO \`${table}\` (supplier_id, sku_id, created_at, updated_at) VALUES (1, 999999999, 1, 1)`);
    return false;
  } catch (error) {
    if ((error?.cause?.code ?? error?.code) !== "ER_NO_REFERENCED_ROW_2") throw error;
    return true;
  }
}

integrationTest("DEF-029 (HD-113): 0087 makes the SKU foreign key refuse an orphan, a rerun and a half-done run both finish, and down restores the 0081 keys", async () => {
  const connection = await mysql.createConnection(config());
  let table = null;
  try {
    table = await originalProbe(connection);
    // 對照：0081 嘅定義喺 MySQL 26.7.0 擋唔到孤兒。呢度轉咗紅，代表 server 行為變咗，要重新評估 DEF-029。
    assert.equal(await orphanRefused(connection, table), false, "control: the original definition accepts an orphan");
    await connection.query(`DELETE FROM \`${table}\``);

    await up(connection, { table });
    assert.equal(await orphanRefused(connection, table), true);
    assert.deepEqual(await indexOrder(connection, table), ["idx_supplier_sku_refs_sku", "idx_supplier_sku_refs_sku_status_supplied"]);
    await up(connection, { table });
    assert.equal(await orphanRefused(connection, table), true, "a rerun keeps it");

    // 做完第 1 步、未加 FK 就停咗：重跑只補 FK。
    await connection.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`fk_${table}_sku\``);
    await up(connection, { table });
    assert.equal(await hasForeignKey(connection, table), true);
    assert.equal(await orphanRefused(connection, table), true);

    // 有人手加過 (sku_id) index，但排喺複合 index 後面：照樣修。
    await down(connection, { table });
    await connection.query(`ALTER TABLE \`${table}\` ADD INDEX idx_supplier_sku_refs_sku (sku_id)`);
    assert.equal(await orphanRefused(connection, table), false, "control: an index added after the composite one does not help");
    await connection.query(`DELETE FROM \`${table}\``);
    await up(connection, { table });
    assert.equal(await orphanRefused(connection, table), true);

    await down(connection, { table });
    assert.deepEqual(await indexOrder(connection, table), ["idx_supplier_sku_refs_sku_status_supplied"]);
    assert.equal(await hasForeignKey(connection, table), true);
    await down(connection, { table });
    assert.equal(await hasForeignKey(connection, table), true, "a second down changes nothing");
  } finally {
    if (table) await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
    await connection.end();
  }
});

integrationTest("DEF-029 (HD-113): with orphan rows 0087 stops and lists them without changing anything, and a same-named index on other columns is refused", async () => {
  const connection = await mysql.createConnection(config());
  let table = null;
  try {
    table = await originalProbe(connection);
    // 0081 嘅定義擋唔到，所以孤兒係真係會出現嘅資料。
    await connection.query(`INSERT INTO \`${table}\` (supplier_id, sku_id, created_at, updated_at) VALUES (7, 999999999, 1, 1)`);
    const [[{ id }]] = await connection.query(`SELECT id FROM \`${table}\``);
    await assert.rejects(() => up(connection, { table }), new RegExp(`id=${id} supplier_id=7 sku_id=999999999`, "u"));
    assert.deepEqual(await indexOrder(connection, table), ["idx_supplier_sku_refs_sku_status_supplied"], "nothing changed");
    assert.equal(await hasForeignKey(connection, table), true);
    const [[{ n }]] = await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    assert.equal(Number(n), 1, "the orphan is reported, not deleted");

    await connection.query(`DELETE FROM \`${table}\``);
    await connection.query(`ALTER TABLE \`${table}\` ADD INDEX idx_supplier_sku_refs_sku (sku_id, relationship_status)`);
    await assert.rejects(() => up(connection, { table }), /Incompatible existing Supplier schema index: skr87_[0-9a-f]+\.idx_supplier_sku_refs_sku/u);
  } finally {
    if (table) await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
    await connection.end();
  }
});

integrationTest("DEF-029 (HD-113): 0087 gives up after its lock wait instead of stalling writers", async () => {
  const [migrating, holder] = [await mysql.createConnection(config()), await mysql.createConnection(config())];
  let table = null;
  let attempt = null;
  try {
    table = await originalProbe(migrating);
    await holder.beginTransaction();
    await holder.query(`SELECT id FROM \`${table}\` LIMIT 1`);
    attempt = up(migrating, { table, lockWaitSeconds: 1 });
    const outcome = await Promise.race([attempt.then(() => "changed while the lock was held", (error) => error),
      new Promise((resolve) => { setTimeout(() => resolve("still waiting after 10 s"), 10_000).unref(); })]);
    assert.match(String(outcome?.message ?? outcome), new RegExp(`metadata lock on ${table}`, "u"));
    await holder.rollback();
    await up(migrating, { table });
    assert.equal(await orphanRefused(migrating, table), true, "a rerun after the transaction ends succeeds");
  } finally {
    await holder.rollback().catch(() => {});
    await attempt?.catch(() => {});
    if (table) await migrating.query(`DROP TABLE IF EXISTS \`${table}\``);
    await Promise.all([migrating.end(), holder.end()]);
  }
});
