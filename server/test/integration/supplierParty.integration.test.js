import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { SupplierAddressService } from "../../src/modules/supplier/SupplierAddressService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

function config() {
  return { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME };
}

function database(pool) {
  return {
    query: (...args) => pool.query(...args),
    async withTransaction(work) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  };
}

integrationTest("Address ownership, primary switching, concurrency and deactivation are enforced by service and MySQL", async (t) => {
  const pool = mysql.createPool({ ...config(), connectionLimit: 6 });
  const suffix = String(Date.now());
  const supplierIds = [];
  t.after(async () => {
    if (supplierIds.length) {
      await pool.query(`DELETE FROM supplier_audit_logs WHERE supplier_id IN (${supplierIds.map(() => "?").join(",")})`, supplierIds);
      await pool.query(`DELETE FROM suppliers WHERE id IN (${supplierIds.map(() => "?").join(",")})`, supplierIds);
    }
    await pool.end();
  });

  const [[actor]] = await pool.query("SELECT id, username FROM users WHERE status = 'active' ORDER BY id LIMIT 1");
  const now = Date.now();
  for (const code of [`ADDR-${suffix}-A`, `ADDR-${suffix}-B`]) {
    const [result] = await pool.execute(
      `INSERT INTO suppliers
        (supplier_code, supplier_code_key, supplier_name, supplier_name_key, default_currency_code,
         status, version, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, 'HKD', 'active', 1, ?, ?, ?, ?)`,
      [code, code.toLowerCase(), code, code.toLowerCase(), now, now, actor.id, actor.id]
    );
    supplierIds.push(Number(result.insertId));
  }

  const service = new SupplierAddressService({
    database: database(pool), logger: { warn() {} }, time: { nowMs: () => Date.now() },
    authorize: async () => ({ id: Number(actor.id), username: actor.username })
  });
  const base = { actorId: Number(actor.id), claimedRoles: [], claimedPermissions: [], supplierId: supplierIds[0], addressLine1: "1 Test Road", purposes: [{ purposeCode: "ordering", isPrimary: true }] };
  const first = await service.create({ ...base, label: "A" });
  const second = await service.create({ ...base, label: "B" });
  const [[primaryCount]] = await pool.query(
    "SELECT COUNT(*) AS total FROM supplier_address_purposes WHERE supplier_id = ? AND purpose_code = 'ordering' AND is_primary = 1",
    [supplierIds[0]]
  );
  assert.equal(Number(primaryCount.total), 1);

  await assert.rejects(
    () => service.update({ ...base, supplierId: supplierIds[1], addressId: first.id, version: first.version, label: "Wrong owner" }),
    (error) => error.publicCode === "SUPPLIER_ADDRESS_NOT_FOUND" && error.statusCode === 404
  );

  const deactivated = await service.deactivate({ ...base, addressId: second.id, version: second.version });
  assert.equal(deactivated.status, "inactive");
  const [[mapping]] = await pool.query(
    "SELECT COUNT(*) AS total, SUM(is_primary) AS primary_total FROM supplier_address_purposes WHERE address_id = ?",
    [second.id]
  );
  assert.equal(Number(mapping.total), 1);
  assert.equal(Number(mapping.primary_total), 0);

  const concurrent = await Promise.all([
    service.create({ ...base, label: "C" }),
    service.create({ ...base, label: "D" })
  ]);
  assert.equal(concurrent.length, 2);
  const [[afterConcurrent]] = await pool.query(
    "SELECT COUNT(*) AS total FROM supplier_address_purposes WHERE supplier_id = ? AND purpose_code = 'ordering' AND is_primary = 1",
    [supplierIds[0]]
  );
  assert.equal(Number(afterConcurrent.total), 1);
});
