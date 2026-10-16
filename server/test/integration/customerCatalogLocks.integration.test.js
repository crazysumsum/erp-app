import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";
import { BusinessMasterProvider } from "../../src/modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../../src/modules/businessMaster/BusinessMasterRepository.js";
import { migrationFixture } from "../sales/phase1/fixtures.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("HD-016 actual Customer catalog SELECT-only assertions preserve shared/current and exclusive owner locking", { timeout: 30_000 }, async t => {
  const f = await migrationFixture(t, []);
  await f.db.execute("UPDATE currencies SET status='ACTIVE' WHERE code=?", [f.currency]);
  const admin = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_ADMIN_USER, password: process.env.DB_ADMIN_PASSWORD, database: process.env.DB_NAME });
  const user = `cm_lock_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const password = randomBytes(24).toString("hex");
  const readers = [];
  t.after(async () => { try { await admin.query("DROP USER IF EXISTS ?@'%'", [user]); } finally { await admin.end(); } });
  await admin.query("CREATE USER ?@'%' IDENTIFIED BY ?", [user, password]);
  for (const table of ["currencies", "payment_terms"]) await admin.query("GRANT SELECT ON ??.?? TO ?@'%'", [process.env.DB_NAME, table, user]);
  await admin.query("GRANT SELECT, UPDATE ON ??.customers TO ?@'%'", [process.env.DB_NAME, user]);
  const [grants] = await admin.query("SELECT TABLE_NAME, PRIVILEGE_TYPE FROM information_schema.table_privileges WHERE GRANTEE=? AND TABLE_NAME IN ('currencies','payment_terms') ORDER BY TABLE_NAME", [`'${user}'@'%'`]);
  assert.deepEqual(grants, [{ TABLE_NAME: "currencies", PRIVILEGE_TYPE: "SELECT" }, { TABLE_NAME: "payment_terms", PRIVILEGE_TYPE: "SELECT" }]);
  const termId = await f.insert("payment_terms", { code: user, code_key: user.toUpperCase(), name: "Lock fixture", calculation_type: "NET_DAYS", due_days: 30, status: "ACTIVE", version: 1, created_at: f.now, updated_at: f.now });
  const repository = new BusinessMasterRepository();
  try {
    for (let index = 0; index < 2; index++) {
      const reader = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user, password, database: process.env.DB_NAME });
      readers.push(reader);
      await reader.query("SET SESSION innodb_lock_wait_timeout=1");
    }
    const [first, second] = readers;
    const provider = new BusinessMasterProvider({ database: first, repository });
    const definitions = [
      ["currencies", "code", f.currency, "getCurrency", "assertCurrencyUsableInTransaction", { code: f.currency }, "CURRENCY_NOT_ACTIVE"],
      ["payment_terms", "id", termId, "getPaymentTerm", "assertPaymentTermUsableInTransaction", { id: termId }, "PAYMENT_TERM_NOT_ACTIVE"]
    ];
    await f.db.query("SET SESSION innodb_lock_wait_timeout=1");
    for (const [table, keyColumn, key, getter, assertion, input, inactive] of definitions) {
      await first.beginTransaction();
      await first.query("SELECT id FROM customers WHERE id=? FOR UPDATE", [f.customerId]);
      assert.equal((await provider[assertion](first, { ...input, expectedVersion: 1 })).status, "ACTIVE");
      await second.beginTransaction();
      assert.equal((await provider[assertion](second, input)).version, 1);
      for (const sql of [`UPDATE ${table} SET version=version+1 WHERE ${keyColumn}=?`, `DELETE FROM ${table} WHERE ${keyColumn}=?`, `INSERT INTO ${table} SELECT * FROM ${table} WHERE ${keyColumn}=? AND 1=0`]) {
        await assert.rejects(() => first.query(sql, [key]), error => error.errno === 1142);
      }
      await assert.rejects(() => repository[getter](first, key, { forUpdate: true }), error => error.errno === 1142);
      await f.db.beginTransaction();
      await assert.rejects(() => f.db.query(`UPDATE ${table} SET status='INACTIVE',version=2 WHERE ${keyColumn}=?`, [key]), error => error.errno === 1205);
      await f.db.rollback();
      await first.rollback(); await second.rollback();

      await first.beginTransaction();
      assert.equal((await repository[getter](first, key)).version, 1);
      await f.db.query(`UPDATE ${table} SET status='INACTIVE',version=2 WHERE ${keyColumn}=?`, [key]);
      assert.equal((await repository[getter](first, key)).version, 1);
      await assert.rejects(() => provider[assertion](first, input), error => error.code === inactive);
      assert.equal((await provider[assertion](first, { ...input, purpose: "history", expectedVersion: 2 })).version, 2);
      await assert.rejects(() => provider[assertion](first, { ...input, purpose: "history", expectedVersion: 1 }), error => error.code === "VERSION_CONFLICT");
      await first.rollback();

      await f.db.query(`UPDATE ${table} SET status='ACTIVE' WHERE ${keyColumn}=?`, [key]);
      await f.db.beginTransaction();
      await repository[getter](f.db, key, { forUpdate: true });
      await second.beginTransaction();
      await assert.rejects(() => provider[assertion](second, input), error => error.errno === 1205);
      await second.rollback(); await f.db.rollback();
      assert.equal((await provider[assertion](second, input)).version, 2);
    }
  } finally {
    await f.db.rollback();
    for (const reader of readers) { await reader.rollback(); await reader.end(); }
  }
});
