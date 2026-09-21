import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

import { up as createSuppliers } from "../../database/migrations/0029_create_suppliers.js";
import { up as createSupplierNameGrams } from "../../database/migrations/0030_create_supplier_name_grams.js";
import { up as createSupplierActivationRequests } from "../../database/migrations/0035_create_supplier_activation_requests.js";
import { up as createSupplierSettings } from "../../database/migrations/0036_create_supplier_settings.js";

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

integrationTest("0035 gives the database the one-pending-request guarantee and converges on rerun", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  // One hook: node:test runs after-hooks in registration order, so a separate
  // cleanup hook registered later would find the connection already closed.
  t.after(async () => {
    if (supplierId !== null) {
      await connection.execute("DELETE FROM supplier_activation_requests WHERE supplier_id = ?", [supplierId]);
      await connection.execute("DELETE FROM suppliers WHERE id = ?", [supplierId]);
    }
    await connection.end();
  });
  await createSupplierActivationRequests(connection);
  await createSupplierActivationRequests(connection);

  const [[slot]] = await connection.query(
    `SELECT extra FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'supplier_activation_requests' AND column_name = 'pending_slot'`
  );
  assert.match(String(slot.extra ?? slot.EXTRA).toUpperCase(), /GENERATED/u);

  const [slotIndex] = await connection.query(
    `SELECT non_unique, column_name FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'supplier_activation_requests'
        AND index_name = 'uq_supplier_activation_pending'
      ORDER BY seq_in_index`
  );
  assert.deepEqual(slotIndex.map((row) => row.column_name ?? row.COLUMN_NAME), ["supplier_id", "pending_slot"]);
  assert.deepEqual([...new Set(slotIndex.map((row) => Number(row.non_unique ?? row.NON_UNIQUE)))], [0]);

  const [[restrictRule]] = await connection.query(
    `SELECT delete_rule FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND constraint_name = 'fk_supplier_activation_supplier'`
  );
  assert.equal(restrictRule.delete_rule ?? restrictRule.DELETE_RULE, "RESTRICT");

  // The index only enforces anything if the generated slot really is recomputed on
  // UPDATE, so exercise it against real rows rather than reading the DDL back.
  const suffix = randomUUID().slice(0, 8);
  const [[currency]] = await connection.query("SELECT code FROM currencies LIMIT 1");
  const now = Date.now();
  const [supplier] = await connection.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key,
       default_currency_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`MIG-${suffix}`, `mig-${suffix}`, `Migration ${suffix}`, `migration ${suffix}`, currency.code ?? currency.CODE, now, now]
  );
  supplierId = supplier.insertId;

  const insertPending = () => connection.execute(
    `INSERT INTO supplier_activation_requests (supplier_id, supplier_version, summary, requested_at)
     VALUES (?, 1, JSON_OBJECT(), ?)`,
    [supplierId, Date.now()]
  );
  const [first] = await insertPending();
  await assert.rejects(insertPending, (error) => error.code === "ER_DUP_ENTRY");

  // A hard delete must not slip past the reference rules while a request is open.
  await assert.rejects(
    () => connection.execute("DELETE FROM suppliers WHERE id = ?", [supplierId]),
    (error) => error.code === "ER_ROW_IS_REFERENCED_2"
  );

  await connection.execute("UPDATE supplier_activation_requests SET status = 'approved' WHERE id = ?", [first.insertId]);
  await insertPending();
  const [[counts]] = await connection.query(
    `SELECT COUNT(*) AS total, COUNT(pending_slot) AS pending
       FROM supplier_activation_requests WHERE supplier_id = ?`,
    [supplierId]
  );
  assert.equal(Number(counts.total ?? counts.TOTAL), 2);
  assert.equal(Number(counts.pending ?? counts.PENDING), 1);
});

integrationTest("0036 seeds the settings singleton once and a rerun neither duplicates nor resets it", async (t) => {
  const connection = await mysql.createConnection(config());
  t.after(() => connection.end());
  await createSupplierSettings(connection);

  // node --test runs test FILES in parallel against this one shared erp_dev, and
  // supplier_settings is a singleton every Settings caller will read. Re-exercising
  // the seed means deleting and rewriting that row, so it happens inside a
  // transaction that is always rolled back: no other connection ever observes the
  // intermediate values, and nothing depends on an after-hook running.
  await connection.beginTransaction();
  try {
    await connection.execute("DELETE FROM supplier_settings WHERE id = 1");
    await createSupplierSettings(connection);
    const [[seeded]] = await connection.query("SELECT require_activation_approval FROM supplier_settings WHERE id = 1");
    assert.equal(Number(seeded.require_activation_approval ?? seeded.REQUIRE_ACTIVATION_APPROVAL), 0,
      "the seed must leave existing activation behaviour unchanged");

    await connection.execute("UPDATE supplier_settings SET require_activation_approval = 1 WHERE id = 1");
    await createSupplierSettings(connection);
    const [rows] = await connection.query("SELECT id, require_activation_approval FROM supplier_settings");
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].require_activation_approval ?? rows[0].REQUIRE_ACTIVATION_APPROVAL), 1,
      "a rerun overwrote an operator's setting");
  } finally {
    await connection.rollback();
  }
});
