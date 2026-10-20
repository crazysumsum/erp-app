import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

import { down, up } from "../../database/migrations/0087_fix_supplier_sku_refs_sku_foreign_key.js";

/**
 * DEF-029／HD-113：0087 喺一張 `supplier_sku_refs` 嘅複製表上做，唔郁真表（其他測試檔可能同時用緊佢）。
 * 真表修好咗冇，由 TC-082 嘅直接 DB 寫入釘住。複製表靠 CI 已經跑咗 0087（真表有 `(sku_id)` index）。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const config = () => ({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

/** 複製表，還原 0081 嘅樣：冇 `(sku_id)` index，FK 由複合 index 負責。`table` 一開始就定好，失敗都清得走。 */
async function originalProbe(connection, table) {
  await connection.query(`CREATE TABLE \`${table}\` LIKE supplier_sku_refs`);
  await connection.query(`ALTER TABLE \`${table}\` DROP INDEX idx_supplier_sku_refs_sku`);
  await connection.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`fk_${table}_sku\` FOREIGN KEY (sku_id) REFERENCES item_skus (id) ON DELETE RESTRICT`);
}
const probeName = () => `skr87_${randomUUID().slice(0, 8)}`;

const indexOrder = async (connection, table) =>
  [...new Set((await connection.query(`SHOW INDEX FROM \`${table}\``))[0].map((row) => row.Key_name))].filter((name) => name.startsWith("idx_"));

const hasForeignKey = async (connection, table) => (await connection.query(
  `SELECT 1 FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ?`,
  [table, `fk_${table}_sku`]))[0].length === 1;

/** 寫一行指向唔存在 SKU 嘅關係；回傳 server 有冇擋。入到就即刻刪返。 */
async function orphanRefused(connection, table) {
  try {
    await connection.query(`INSERT INTO \`${table}\` (supplier_id, sku_id, created_at, updated_at) VALUES (1, 999999999, 1, 1)`);
  } catch (error) {
    if ((error?.cause?.code ?? error?.code) !== "ER_NO_REFERENCED_ROW_2") throw error;
    return true;
  }
  await connection.query(`DELETE FROM \`${table}\``);
  return false;
}

/** 記低 ALTER 語句，用嚟證明重跑冇再郁張表。 */
const recording = (connection) => {
  const statements = [];
  return { statements, query: (sql, ...rest) => { statements.push(sql); return connection.query(sql, ...rest); } };
};

integrationTest("DEF-029 (HD-113, HD-114): 0087 makes the SKU foreign key refuse an orphan without ever dropping it, a rerun changes nothing, and down restores the 0081 keys", async () => {
  const connection = await mysql.createConnection(config());
  const table = probeName();
  try {
    await originalProbe(connection, table);
    // 對照：0081 嘅定義喺 MySQL 26.7.0 擋唔到孤兒。呢度轉咗紅，代表 server 行為變咗，要重新評估 DEF-029。
    assert.equal(await orphanRefused(connection, table), false, "control: the original definition accepts an orphan");

    const first = recording(connection);
    await up(first, { table });
    assert.equal(await orphanRefused(connection, table), true);
    assert.deepEqual(await indexOrder(connection, table), ["idx_supplier_sku_refs_sku", "idx_supplier_sku_refs_sku_status_supplied"]);
    const alters = first.statements.filter((sql) => /^ALTER TABLE/u.test(sql));
    assert.equal(alters.length, 1, "one atomic statement");
    assert.doesNotMatch(alters[0], /FOREIGN KEY/u, "the foreign key is never dropped, so deletes stay refused throughout");
    assert.match(alters[0], /ALGORITHM=INPLACE, LOCK=NONE$/u);

    const rerun = recording(connection);
    await up(rerun, { table });
    assert.equal(rerun.statements.some((sql) => /^ALTER TABLE/u.test(sql)), false, "a rerun only checks");
    assert.equal(await orphanRefused(connection, table), true);

    // 有人手加過 (sku_id) index，但排喺複合 index 後面：照樣修。
    await down(connection, { table });
    await connection.query(`ALTER TABLE \`${table}\` ADD INDEX idx_supplier_sku_refs_sku (sku_id)`);
    assert.equal(await orphanRefused(connection, table), false, "control: an index added after the composite one does not help");
    await up(connection, { table });
    assert.equal(await orphanRefused(connection, table), true);

    // down 只刪 (sku_id) index：FK 一直都喺度，退返用複合 index。
    await down(connection, { table });
    assert.deepEqual(await indexOrder(connection, table), ["idx_supplier_sku_refs_sku_status_supplied"]);
    assert.equal(await hasForeignKey(connection, table), true);
    assert.equal(await orphanRefused(connection, table), false, "down is the 0081 definition again");
    await down(connection, { table });
    assert.equal(await hasForeignKey(connection, table), true, "a second down changes nothing");
  } finally {
    await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
    await connection.end();
  }
});

integrationTest("DEF-029 (HD-113): with orphan rows 0087 stops and lists them without changing anything, also on a rerun of a fixed table", async () => {
  const connection = await mysql.createConnection(config());
  const table = probeName();
  try {
    await originalProbe(connection, table);
    // 0081 嘅定義擋唔到，所以孤兒係真係會出現嘅資料。
    await connection.query(`INSERT INTO \`${table}\` (supplier_id, sku_id, created_at, updated_at) VALUES (7, 999999999, 1, 1)`);
    const [[{ id }]] = await connection.query(`SELECT id FROM \`${table}\``);
    await assert.rejects(() => up(connection, { table }), new RegExp(`id=${id} supplier_id=7 sku_id=999999999`, "u"));
    assert.deepEqual(await indexOrder(connection, table), ["idx_supplier_sku_refs_sku_status_supplied"], "nothing changed");
    const [[{ n }]] = await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    assert.equal(Number(n), 1, "the orphan is reported, not deleted");

    // 已修好嘅表都照查：例如有人用 foreign_key_checks=0 寫入咗。
    await connection.query(`DELETE FROM \`${table}\``);
    await up(connection, { table });
    await connection.query("SET SESSION foreign_key_checks = 0");
    await connection.query(`INSERT INTO \`${table}\` (supplier_id, sku_id, created_at, updated_at) VALUES (8, 999999998, 1, 1)`);
    await assert.rejects(() => up(connection, { table }), /foreign_key_checks must be 1/u, "a session without foreign key checks is refused");
    await connection.query("SET SESSION foreign_key_checks = 1");
    await assert.rejects(() => up(connection, { table }), /supplier_id=8 sku_id=999999998/u);
  } finally {
    await connection.query("SET SESSION foreign_key_checks = 1");
    await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
    await connection.end();
  }
});

integrationTest("DEF-029 (HD-113, REV-100 L-1): 0087 refuses a same-named index on other columns, a missing foreign key, and an index that would keep serving the key", async () => {
  const connection = await mysql.createConnection(config());
  const tables = [probeName(), probeName(), probeName()];
  try {
    const [columns, noKey, unique] = tables;
    await originalProbe(connection, columns);
    await connection.query(`ALTER TABLE \`${columns}\` ADD INDEX idx_supplier_sku_refs_sku (sku_id, relationship_status)`);
    await assert.rejects(() => up(connection, { table: columns }), /Incompatible existing Supplier schema index: skr87_[0-9a-f]+\.idx_supplier_sku_refs_sku/u);

    await originalProbe(connection, noKey);
    await connection.query(`ALTER TABLE \`${noKey}\` DROP FOREIGN KEY \`fk_${noKey}_sku\``);
    await assert.rejects(() => up(connection, { table: noKey }), new RegExp(`${noKey} has no foreign key fk_${noKey}_sku`, "u"));

    // MySQL 將 UNIQUE 排喺普通 index 前面：(sku_id, id) 會繼續負責 FK，0087 一定要講出嚟，唔可以當修好。
    await originalProbe(connection, unique);
    await connection.query(`ALTER TABLE \`${unique}\` ADD UNIQUE INDEX uq_probe_sku_id (sku_id, id)`);
    await assert.rejects(() => up(connection, { table: unique }), /uq_probe_sku_id still serves/u);
  } finally {
    for (const table of tables) await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
    await connection.end();
  }
});

integrationTest("DEF-029 (HD-113): 0087 gives up after its lock wait instead of stalling writers", async () => {
  const [migrating, holder] = [await mysql.createConnection(config()), await mysql.createConnection(config())];
  const table = probeName();
  let attempt = null;
  try {
    await originalProbe(migrating, table);
    await holder.beginTransaction();
    await holder.query(`SELECT id FROM \`${table}\` LIMIT 1`);
    attempt = up(migrating, { table, lockWaitSeconds: 1 });
    const outcome = await Promise.race([attempt.then(() => "changed while the lock was held", (error) => error),
      new Promise((resolve) => { setTimeout(() => resolve("still waiting after 10 s"), 10_000).unref(); })]);
    assert.match(String(outcome?.message ?? outcome), new RegExp(`metadata lock on ${table}`, "u"));
    assert.equal(await hasForeignKey(migrating, table), true, "the foreign key is still there after the timeout");
    await holder.rollback();
    await up(migrating, { table });
    assert.equal(await orphanRefused(migrating, table), true, "a rerun after the transaction ends succeeds");
  } finally {
    await holder.rollback().catch(() => {});
    await attempt?.catch(() => {});
    await migrating.query(`DROP TABLE IF EXISTS \`${table}\``);
    await Promise.all([migrating.end(), holder.end()]);
  }
});
