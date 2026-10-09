import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import {
  bigramDiceScore,
  hashNameBigrams,
  replaceSupplierNameGrams,
  SupplierDuplicateCandidates
} from "../../src/modules/supplier/supplierDuplicateCandidates.js";

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

integrationTest("indexed name grams recall exact and near Supplier names without making a blocking decision", async (t) => {
  const connection = await mysql.createConnection(config());
  const suffix = String(Date.now());
  const ids = [];
  t.after(async () => {
    if (ids.length > 0) await connection.query(`DELETE FROM suppliers WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    await connection.end();
  });

  for (const [index, name] of ["Alpha Snack Trading", "Alpha Snacks Trading", "Unrelated Health Food"].entries()) {
    const [result] = await connection.execute(
      `INSERT INTO suppliers
        (supplier_code, supplier_code_key, supplier_name, supplier_name_key, default_currency_code,
         status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'HKD', 'draft', 1, ?, ?)`,
      [`DUP-${suffix}-${index}`, `dup-${suffix}-${index}`, name, name.toLowerCase(), Date.now(), Date.now()]
    );
    ids.push(Number(result.insertId));
    await replaceSupplierNameGrams(connection, Number(result.insertId), name.toLowerCase());
  }

  const candidates = await new SupplierDuplicateCandidates({ threshold: 0.8 }).find(connection, { nameKey: "alpha snack trading" });
  assert.deepEqual(candidates.map((row) => row.supplierId), ids.slice(0, 2));
  assert.ok(candidates.every((row) => row.warningOnly));

  const hash = hashNameBigrams("alpha snack trading")[0];
  const [plan] = await connection.query(
    "EXPLAIN FORMAT=JSON SELECT supplier_id FROM supplier_name_grams WHERE gram_hash IN (?)",
    [hash]
  );
  assert.match(JSON.stringify(plan), /idx_supplier_name_grams_lookup/u);
});

integrationTest("TASK-050 (HD-084): the bounded search returns what comparing every Supplier would, among names full of common grams", async (t) => {
  const connection = await mysql.createConnection(config());
  const suffix = String(Date.now());
  const ids = [];
  t.after(async () => {
    for (let start = 0; start < ids.length; start += 500) {
      const chunk = ids.slice(start, start + 500);
      await connection.query("DELETE FROM supplier_name_grams WHERE supplier_id IN (?)", [chunk]);
      await connection.query("DELETE FROM suppliers WHERE id IN (?)", [chunk]);
    }
    await connection.end();
  });

  // 1,200 個名稱由 30 個字砌成，所以每個 gram 都有好多 Supplier 共用：舊做法要掃晒佢哋嘅 posting list。
  const words = ["golden", "harbour", "pacific", "dragon", "eastern", "global", "union", "prime", "sunrise", "lucky", "grand", "royal",
    "pearl", "jade", "ocean", "summit", "star", "wing", "kwong", "hing", "fook", "shun", "wah", "kam", "victoria", "silver", "asia",
    "orient", "metro", "crown"];
  const names = [];
  for (let index = 0; index < 1_200; index += 1) {
    names.push(`${words[(index * 7) % 30]} ${words[(index * 11 + 3) % 30]} ${["trading", "industrial", "supplies"][index % 3]} limited ${index % 97}`);
  }
  // 邊界：呢個名稱嘅 15 個 gram 全部喺查詢「…zxzyx」入面，但缺咗查詢最罕見嗰 5 個（Dice 30/35 ≈ 0.857）。
  // 佢只共有最少要求嘅 gram 數，所以揀少一個罕見 gram 都會漏咗佢。
  names.push("abcdefghijklmnop");
  names.push("golden harbor trading limited", "golden harbour tradings limited", "golden harbour trading ltd");
  const now = Date.now();
  for (let start = 0; start < names.length; start += 400) {
    const chunk = names.slice(start, start + 400);
    const [result] = await connection.query(
      `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, default_currency_code, status, version,
         created_at, updated_at) VALUES ?`,
      [chunk.map((name, offset) => [`DUP50-${suffix}-${start + offset}`, `dup50-${suffix}-${start + offset}`, name, name, "HKD", "draft", 1, now, now])]
    );
    const first = Number(result.insertId);
    chunk.forEach((_, offset) => ids.push(first + offset));
    await connection.query("INSERT INTO supplier_name_grams (supplier_id, gram_hash) VALUES ?",
      [chunk.flatMap((name, offset) => hashNameBigrams(name).map((hash) => [first + offset, hash]))]);
  }

  const [everyone] = await connection.query("SELECT id, supplier_name_key FROM suppliers");
  const truth = (nameKey) => everyone
    .map((row) => ({ id: Number(row.id), exact: row.supplier_name_key === nameKey, score: bigramDiceScore(nameKey, row.supplier_name_key) }))
    .filter((row) => row.exact || row.score >= 0.85)
    .sort((left, right) => Number(right.exact) - Number(left.exact) || right.score - left.score || left.id - right.id)
    .slice(0, 10)
    .map((row) => row.id);
  const finder = new SupplierDuplicateCandidates();
  const queries = ["golden harbour trading limited", "abcdefghijklmnopzxzyx", ...names.filter((_, index) => index % 60 === 0).map((name) => name.replace(/a/u, "e"))];
  let matched = 0;
  for (const nameKey of queries) {
    const expected = truth(nameKey);
    assert.deepEqual((await finder.find(connection, { nameKey })).map((row) => row.supplierId), expected, nameKey);
    matched += expected.length;
  }
  assert.ok(matched >= queries.length, "the queries have real candidates to find, so the comparison is not vacuous");
  assert.deepEqual(truth("golden harbour trading limited").slice(0, 3).sort(), ids.slice(-3).sort());
});
