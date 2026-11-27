import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";
import { asciiPredicate } from "../../src/services/mysqldatabase/asciiPredicate.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("MySQL preserves matching product codes, multilingual names and parameter order", async t => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), socketPath: process.env.DB_SOCKET_PATH,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });
  t.after(() => db.end());
  await db.query(`CREATE TEMPORARY TABLE catalogue_search (
    id INT PRIMARY KEY, shop INT NOT NULL, code VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL
  )`);
  await db.query("INSERT INTO catalogue_search VALUES (1, 1, 'TEA', '春茶'), (2, 1, 'COFFEE', 'Café'), (3, 2, 'TEA', '春茶')");

  async function matches(predicate, namePrefix = "") {
    const [rows] = await db.execute(
      `SELECT id FROM catalogue_search WHERE shop=? AND (${predicate.sql} OR name LIKE ?) AND id<=? ORDER BY id`,
      [1, ...predicate.params, namePrefix, 3]
    );
    return rows.map(row => row.id);
  }
  assert.deepEqual(await matches(asciiPredicate("code = ?", "TEA")), [1]);
  assert.deepEqual(await matches(asciiPredicate("code = ?", "春茶")), []);
  assert.deepEqual(await matches(asciiPredicate("code LIKE ?", "COF%")), [2]);
  assert.deepEqual(await matches(asciiPredicate("code LIKE ?", "春%"), "春%"), [1]);
  assert.deepEqual(await matches(asciiPredicate("code IN (?, ?)", "TEA", "COFFEE")), [1, 2]);
  assert.deepEqual(await matches(asciiPredicate("code IN (?, ?)", "紅茶", "咖啡"), "Café"), [2]);
});
