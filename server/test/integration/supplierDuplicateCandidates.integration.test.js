import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import {
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
