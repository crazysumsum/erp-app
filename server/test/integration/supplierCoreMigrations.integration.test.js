import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { up as createSuppliers } from "../../database/migrations/0029_create_suppliers.js";
import { up as createSupplierNameGrams } from "../../database/migrations/0030_create_supplier_name_grams.js";

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

integrationTest("0029 and 0030 create the exact Supplier root and owned gram schema and converge on rerun", async (t) => {
  const connection = await mysql.createConnection(config());
  t.after(() => connection.end());
  await createSuppliers(connection);
  await createSupplierNameGrams(connection);
  await createSuppliers(connection);
  await createSupplierNameGrams(connection);

  const [supplierIndexes] = await connection.query(
    "SELECT index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'suppliers' GROUP BY index_name ORDER BY index_name"
  );
  assert.deepEqual(supplierIndexes.map((row) => row.index_name ?? row.INDEX_NAME), [
    "fk_suppliers_created_by",
    "fk_suppliers_updated_by",
    "idx_suppliers_currency_status",
    "idx_suppliers_name_key",
    "idx_suppliers_payment_term_status",
    "idx_suppliers_status_updated_id",
    "PRIMARY",
    "uq_suppliers_code_key"
  ]);

  const [gramIndexes] = await connection.query(
    "SELECT index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'supplier_name_grams' GROUP BY index_name ORDER BY index_name"
  );
  assert.deepEqual(gramIndexes.map((row) => row.index_name ?? row.INDEX_NAME), ["idx_supplier_name_grams_lookup", "PRIMARY"]);

  const [foreignKeys] = await connection.query(
    `SELECT table_name, referenced_table_name, delete_rule
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE()
        AND table_name IN ('suppliers', 'supplier_name_grams')
      ORDER BY table_name, referenced_table_name`
  );
  assert.deepEqual(foreignKeys.map((row) => [
    row.table_name ?? row.TABLE_NAME,
    row.referenced_table_name ?? row.REFERENCED_TABLE_NAME,
    row.delete_rule ?? row.DELETE_RULE
  ]), [
    ["supplier_name_grams", "suppliers", "CASCADE"],
    ["suppliers", "currencies", "RESTRICT"],
    ["suppliers", "payment_terms", "RESTRICT"],
    ["suppliers", "users", "SET NULL"],
    ["suppliers", "users", "SET NULL"]
  ]);
});
