import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { BusinessMasterProvider } from "../../src/modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "../../src/modules/businessMaster/BusinessMasterReadinessService.js";
import { BusinessMasterRepository } from "../../src/modules/businessMaster/BusinessMasterRepository.js";
import { BusinessMasterLookupProvider } from "../../src/modules/supplier/providers/BusinessMasterLookupProvider.js";
import { SupplierAdminService } from "../../src/modules/supplier/SupplierAdminService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

function config() {
  return { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME };
}

function database(pool) {
  return {
    query: (...args) => pool.query(...args),
    execute: (...args) => pool.execute(...args),
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

function serviceFor(pool, overrides = {}) {
  const db = database(pool);
  const provider = new BusinessMasterProvider({ database: db, repository: new BusinessMasterRepository() });
  const businessMaster = new BusinessMasterLookupProvider({ provider, readiness: new BusinessMasterReadinessService({ database: db, checkerIds: ["supplier"] }) });
  return new SupplierAdminService({
    database: db,
    logger: { warn() {} },
    time: { nowMs: () => Date.now() },
    businessMaster,
    authorize: async () => ({ id: null, username: "integration" }),
    ...overrides
  });
}

integrationTest("Supplier create atomically persists root, grams and audit while duplicate codes and audit failure leave no partial data", async (t) => {
  const pool = mysql.createPool({ ...config(), connectionLimit: 5 });
  const suffix = String(Date.now());
  const codes = [`INT-${suffix}-A`, `INT-${suffix}-B`];
  t.after(async () => {
    const [rows] = await pool.query("SELECT id FROM suppliers WHERE supplier_code_key IN (?, ?)", codes.map((code) => code.toLowerCase()));
    const ids = rows.map((row) => Number(row.id));
    if (ids.length > 0) {
      await pool.query(`DELETE FROM supplier_audit_logs WHERE supplier_id IN (${ids.map(() => "?").join(",")})`, ids);
      await pool.query(`DELETE FROM suppliers WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    }
    await pool.end();
  });
  const service = serviceFor(pool);
  const [[actor]] = await pool.query("SELECT id FROM users WHERE status = 'active' ORDER BY id LIMIT 1");
  assert.ok(actor, "erp_dev must contain an active synthetic test user");
  const actorId = Number(actor.id);
  const created = await service.createSupplier({
    actorId, claimedRoles: [], claimedPermissions: [], supplierCode: codes[0], supplierName: "Integration Snacks Supplier",
    defaultCurrencyCode: "HKD", defaultCurrencyVersion: 1, activate: true, requestId: `req-${suffix}`
  });
  assert.equal(created.status, "active");
  const [[counts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM supplier_name_grams WHERE supplier_id = ?) AS grams,
       (SELECT COUNT(*) FROM supplier_audit_logs WHERE supplier_id = ?) AS audits`,
    [created.id, created.id]
  );
  assert.ok(Number(counts.grams) > 0);
  assert.equal(Number(counts.audits), 1);

  const listed = await service.listSuppliers({
    actorId,
    claimedRoles: [],
    claimedPermissions: [],
    q: codes[0],
    page: 1,
    pageSize: 20,
    sortBy: "supplierCode",
    descending: false
  });
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].supplierCode, codes[0]);
  assert.equal("supplierCodeKey" in listed.items[0], false);

  const detail = await service.getSupplier({ actorId, claimedRoles: [], claimedPermissions: [], id: created.id });
  assert.equal(detail.id, created.id);
  assert.deepEqual(detail.bankAccounts, []);
  assert.ok(detail.warnings.some((warning) => warning.code === "BANK_ACCOUNT_MISSING"));

  const duplicateCheck = await service.findSupplierDuplicateCandidates({
    actorId,
    claimedRoles: [],
    claimedPermissions: [],
    supplierCode: codes[0],
    supplierName: "Integration Snacks Supplier"
  });
  assert.equal(duplicateCheck.codeConflict.supplierId, created.id);
  assert.ok(duplicateCheck.duplicateCandidates.some((candidate) => candidate.supplierId === created.id));

  await assert.rejects(
    () => service.createSupplier({ actorId, claimedRoles: [], claimedPermissions: [], supplierCode: codes[0].toLowerCase(), supplierName: "Duplicate", defaultCurrencyCode: "HKD" }),
    (error) => error.publicCode === "SUPPLIER_CODE_TAKEN"
  );

  const failing = serviceFor(pool, { audit: { async record() { throw new Error("audit unavailable"); } } });
  await assert.rejects(
    () => failing.createSupplier({ actorId, claimedRoles: [], claimedPermissions: [], supplierCode: codes[1], supplierName: "Rollback Supplier", defaultCurrencyCode: "HKD" }),
    /audit unavailable/u
  );
  const [[rollbackCount]] = await pool.query("SELECT COUNT(*) AS total FROM suppliers WHERE supplier_code_key = ?", [codes[1].toLowerCase()]);
  assert.equal(Number(rollbackCount.total), 0);
});
