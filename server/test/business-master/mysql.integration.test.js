import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { BusinessMasterAdminService } from "../../src/modules/businessMaster/BusinessMasterAdminService.js";
import { BusinessMasterAuditLogService } from "../../src/modules/businessMaster/BusinessMasterAuditLogService.js";
import { BusinessMasterImpactRegistry } from "../../src/modules/businessMaster/BusinessMasterImpactRegistry.js";
import { BusinessMasterProvider } from "../../src/modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "../../src/modules/businessMaster/BusinessMasterReadinessService.js";
import { BusinessMasterRepository } from "../../src/modules/businessMaster/BusinessMasterRepository.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1";
const integrationTest = enabled ? test : test.skip;

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
  const repository = new BusinessMasterRepository();
  const time = { nowMs: () => Date.now() };
  const impactRegistry = new BusinessMasterImpactRegistry({
    time,
    requiredCheckerIds: ["fixture"],
    checkers: [{ id: "fixture", async check() { return { status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0, watermark: "fixture-not-installed" }; } }]
  });
  return new BusinessMasterAdminService({
    database: database(pool),
    repository,
    audit: overrides.audit ?? new BusinessMasterAuditLogService(),
    impactRegistry,
    authorize: async () => ({ id: null, username: "integration" }),
    time,
    logger: { info() {}, warn() {}, error() {} }
  });
}

function poolConfig() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 5
  };
}

integrationTest("TC-001 real MySQL migration has exact HKD and no Payment Term seed", async (t) => {
  const pool = mysql.createPool(poolConfig());
  t.after(() => pool.end());
  const [currencies] = await pool.query("SELECT code, decimal_places, status FROM currencies WHERE code = 'HKD'");
  const [termCount] = await pool.query("SELECT COUNT(*) AS total FROM payment_terms");
  assert.deepEqual(currencies.map((row) => ({ code: row.code, decimalPlaces: Number(row.decimal_places), status: row.status })), [{ code: "HKD", decimalPlaces: 2, status: "ACTIVE" }]);
  assert.equal(Number(termCount[0].total), 0);
});

integrationTest("TC-015 real MySQL readiness recognizes information_schema aliases", async (t) => {
  const pool = mysql.createPool(poolConfig());
  t.after(() => pool.end());
  const readiness = new BusinessMasterReadinessService({ database: pool, checkerIds: ["customer", "supplier", "sales", "purchasing", "ar", "ap"] });
  const result = await readiness.inspect();
  assert.equal(result.status, "READY");
  assert.equal(result.schemaReady, true);
  assert.equal(result.hkdReady, true);
  assert.equal(result.permissionsReady, true);
});

integrationTest("TC-003 real MySQL prefix search treats wildcard characters literally", async (t) => {
  const pool = mysql.createPool(poolConfig());
  t.after(() => pool.end());
  const repository = new BusinessMasterRepository();
  const result = await repository.listCurrencies(pool, { q: "%_", page: 1, pageSize: 10 });
  assert.equal(result.total, 0);
});

integrationTest("TC-004 real MySQL concurrent CAS has one winner and one atomic audit", async (t) => {
  const pool = mysql.createPool(poolConfig());
  const code = "USD";
  t.after(async () => {
    await pool.query("DELETE FROM business_master_audit_logs WHERE entity_type = 'CURRENCY' AND entity_key = ?", [code]);
    await pool.query("DELETE FROM currencies WHERE code = ?", [code]);
    await pool.end();
  });
  const service = serviceFor(pool);
  const actor = { actorId: 0, claimedRoles: [], claimedPermissions: [] };
  await service.createCurrency({ ...actor, code, name: "US Dollar", decimalPlaces: 2 });
  const results = await Promise.allSettled([
    service.updateCurrency({ ...actor, code, name: "Dollar A", version: 1 }),
    service.updateCurrency({ ...actor, code, name: "Dollar B", version: 1 })
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.publicCode === "VERSION_CONFLICT").length, 1);
  const [rows] = await pool.query("SELECT version FROM currencies WHERE code = ?", [code]);
  const [audits] = await pool.query("SELECT action FROM business_master_audit_logs WHERE entity_type = 'CURRENCY' AND entity_key = ? ORDER BY id", [code]);
  assert.equal(Number(rows[0].version), 2);
  assert.deepEqual(audits.map((row) => row.action), ["CREATE", "UPDATE"]);
});

integrationTest("TC-014 unique conflict and audit failure leave no partial Payment Term", async (t) => {
  const pool = mysql.createPool(poolConfig());
  const code = `NET${String(Date.now()).slice(-8)}`;
  let createdId = null;
  t.after(async () => {
    try {
      if (createdId !== null) {
        await pool.query("DELETE FROM business_master_audit_logs WHERE entity_type = 'PAYMENT_TERM' AND entity_key = ?", [String(createdId)]);
      }
      await pool.query("DELETE FROM payment_terms WHERE code_key IN (?, ?)", [code, `${code}X`]);
    } finally {
      await pool.end();
    }
  });
  const service = serviceFor(pool);
  const actor = { actorId: 0, claimedRoles: [], claimedPermissions: [] };
  const created = await service.createPaymentTerm({ ...actor, code, name: "Net", description: "", calculationType: "NET_DAYS", dueDays: 1 });
  createdId = created.id;
  await assert.rejects(
    () => service.createPaymentTerm({ ...actor, code: ` ${code.toLowerCase()} `, name: "Duplicate", description: "", calculationType: "NET_DAYS", dueDays: 1 }),
    (error) => error.publicCode === "PAYMENT_TERM_CODE_TAKEN"
  );
  const failingService = serviceFor(pool, { audit: { async record() { throw new Error("audit unavailable"); } } });
  await assert.rejects(() => failingService.createPaymentTerm({ ...actor, code: `${code}X`, name: "Rollback", description: "", calculationType: "IMMEDIATE", dueDays: null }), /audit unavailable/);
  const [rows] = await pool.query("SELECT code_key FROM payment_terms WHERE code_key IN (?, ?)", [code, `${code}X`]);
  assert.deepEqual(rows.map((row) => row.code_key), [code]);
});

integrationTest("TC-011 provider locks and revalidates current Active state", async (t) => {
  const pool = mysql.createPool(poolConfig());
  const code = "AUD";
  t.after(async () => {
    await pool.query("DELETE FROM business_master_audit_logs WHERE entity_type = 'CURRENCY' AND entity_key = ?", [code]);
    await pool.query("DELETE FROM currencies WHERE code = ?", [code]);
    await pool.end();
  });
  const service = serviceFor(pool);
  const actor = { actorId: 0, claimedRoles: [], claimedPermissions: [] };
  await service.createCurrency({ ...actor, code, name: "Australian Dollar", decimalPlaces: 2 });
  const repository = new BusinessMasterRepository();
  const provider = new BusinessMasterProvider({ database: database(pool), repository });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const snapshot = await provider.assertCurrencyUsableInTransaction(connection, { code, expectedVersion: 1 });
    assert.deepEqual({ code: snapshot.code, status: snapshot.status, version: snapshot.version }, { code, status: "ACTIVE", version: 1 });
    await connection.rollback();
  } finally {
    connection.release();
  }
});
