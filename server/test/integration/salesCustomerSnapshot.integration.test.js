import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { CustomerLookupService } from "../../src/modules/customer/CustomerLookupService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("Sales Customer snapshot serializes status and absent/created/cleared credit, and rolls back with its caller", async (t) => {
  const source = defaultConfigurationSource();
  const app = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 } } });
  const database = app.services.require("mysqldatabase");
  const lookup = new CustomerLookupService({ database: { query() { throw new Error("pool reads forbidden"); } } });
  const code = `SALES-${randomUUID().slice(0, 8)}`;
  const nowMs = Date.now();
  const [inserted] = await database.execute(
    `INSERT INTO customers (customer_code, customer_code_key, legal_name, legal_name_key,
       default_currency_code, status, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'HKD', 'active', 1, ?, ?)`,
    [code, code.toLowerCase(), code, code.toLowerCase(), nowMs, nowMs]
  );
  const customerId = Number(inserted.insertId);
  t.after(async () => {
    await database.execute("DELETE FROM customers WHERE id = ?", [customerId]);
    await app.shutdown("sales_customer_snapshot_complete");
  });

  for (const mutation of ["create", "update", "clear", "status"]) {
    await database.withTransaction(async (transaction) => {
      const before = await lookup.getSalesSnapshotInTransaction(transaction, customerId, { atMs: nowMs });
      assert.equal(before.credit.configured, ["update", "clear"].includes(mutation));
      if (mutation === "update") assert.deepEqual(before.credit, { configured: true, creditLimit: "0.0000", currencyCode: "HKD", status: "on_hold", policyVersion: 1 });
      if (mutation === "clear") assert.deepEqual(before.credit, { configured: true, creditLimit: null, currencyCode: null, status: "normal", policyVersion: 2 });
      // The owner credit/status writers acquire this root first, including absent-credit creation.
      await assert.rejects(() => database.withTransaction(async (writer) => {
        const [[{ lockWait }]] = await writer.query("SELECT @@SESSION.innodb_lock_wait_timeout AS lockWait");
        try {
          await writer.query("SET SESSION innodb_lock_wait_timeout = 1");
          await writer.query("SELECT id FROM customers WHERE id = ? FOR UPDATE", [customerId]);
        } finally {
          await writer.query("SET SESSION innodb_lock_wait_timeout = ?", [Number(lockWait)]);
        }
      }), error => error.code === "ER_LOCK_WAIT_TIMEOUT" || error.cause?.code === "ER_LOCK_WAIT_TIMEOUT");
      assert.deepEqual(await lookup.getSalesSnapshotInTransaction(transaction, customerId), before);
    });
    await database.withTransaction(async (writer) => {
      await writer.query("SELECT id FROM customers WHERE id = ? FOR UPDATE", [customerId]);
      if (mutation === "create") {
        await writer.execute(
          `INSERT INTO customer_credit_profiles (customer_id, credit_limit, credit_currency_code,
             credit_status, credit_notes, last_change_reason, version, created_at, updated_at)
           VALUES (?, '0.0000', 'HKD', 'on_hold', 'private', 'synthetic setup', 1, ?, ?)`,
          [customerId, nowMs, nowMs]
        );
      } else if (mutation === "update") {
        await writer.execute("UPDATE customer_credit_profiles SET credit_limit = NULL, credit_currency_code = NULL, credit_status = 'normal', version = 2 WHERE customer_id = ?", [customerId]);
      } else if (mutation === "clear") {
        await writer.execute("DELETE FROM customer_credit_profiles WHERE customer_id = ?", [customerId]);
      } else {
        await writer.execute("UPDATE customers SET status = 'blocked', version = version + 1 WHERE id = ?", [customerId]);
      }
    });
  }
  await assert.rejects(() => database.withTransaction(async (transaction) => {
    const snapshot = await lookup.getSalesSnapshotInTransaction(transaction, customerId);
    assert.equal(snapshot.status, "blocked");
    assert.equal(snapshot.customerVersion, 2);
    assert.deepEqual(snapshot.credit, { configured: false, creditLimit: null, currencyCode: null, status: "not_configured", policyVersion: null });
    await transaction.execute("UPDATE customers SET status = 'active' WHERE id = ?", [customerId]);
    throw new Error("caller rollback");
  }), error => error.code === "DATABASE_TRANSACTION_FAILED" && error.cause?.message === "caller rollback");
  assert.equal((await database.query("SELECT status FROM customers WHERE id = ?", [customerId]))[0][0].status, "blocked");
});
