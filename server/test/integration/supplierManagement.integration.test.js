import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { BusinessMasterProvider } from "../../src/modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "../../src/modules/businessMaster/BusinessMasterReadinessService.js";
import { BusinessMasterRepository } from "../../src/modules/businessMaster/BusinessMasterRepository.js";
import { BusinessMasterLookupProvider } from "../../src/modules/supplier/providers/BusinessMasterLookupProvider.js";
import { SupplierAdminService } from "../../src/modules/supplier/SupplierAdminService.js";
import { SupplierBusinessMasterImpactChecker } from "../../src/modules/supplier/SupplierBusinessMasterImpactChecker.js";
import { SupplierLookupService } from "../../src/modules/supplier/SupplierLookupService.js";

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

function lookupFor(pool) {
  const db = database(pool);
  const provider = new BusinessMasterProvider({ database: db, repository: new BusinessMasterRepository() });
  const businessMaster = new BusinessMasterLookupProvider({ provider, readiness: new BusinessMasterReadinessService({ database: db, checkerIds: ["supplier"] }) });
  return {
    database: db,
    service: new SupplierLookupService({
      database: db,
      logger: { error() {} },
      time: { nowMs: () => Date.now() },
      businessMaster
    })
  };
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

integrationTest("Supplier root update and controlled Code correction enforce CAS, global uniqueness and reference guard", async (t) => {
  const pool = mysql.createPool({ ...config(), connectionLimit: 5 });
  const suffix = String(Date.now());
  const originalCode = `UPD-${suffix}-A`;
  const changedCode = `UPD-${suffix}-B`;
  const occupiedCode = `UPD-${suffix}-C`;
  const ids = [];
  t.after(async () => {
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
  const base = {
    actorId,
    claimedRoles: [],
    claimedPermissions: [],
    defaultCurrencyCode: "HKD",
    defaultCurrencyVersion: 1,
    defaultPaymentTermId: null,
    website: "",
    generalPhone: "",
    generalEmail: "",
    notes: "",
    requestId: `req-${suffix}`
  };
  const created = await service.createSupplier({ ...base, supplierCode: originalCode, supplierName: "Update Integration Supplier" });
  ids.push(created.id);
  const occupied = await service.createSupplier({ ...base, supplierCode: occupiedCode, supplierName: "Occupied Code Supplier" });
  ids.push(occupied.id);

  const updated = await service.updateSupplier({
    ...base,
    id: created.id,
    supplierName: "Updated Integration Supplier",
    displayName: "Updated",
    version: created.version
  });
  assert.equal(updated.supplierName, "Updated Integration Supplier");
  assert.equal(updated.version, created.version + 1);
  const [[gramCount]] = await pool.query("SELECT COUNT(*) AS total FROM supplier_name_grams WHERE supplier_id = ?", [created.id]);
  assert.ok(Number(gramCount.total) > 0);

  await assert.rejects(
    () => service.updateSupplier({
      ...base,
      id: created.id,
      supplierName: "Stale Write",
      displayName: "Stale",
      version: created.version
    }),
    (error) => error.publicCode === "VERSION_CONFLICT"
  );
  const [[afterStale]] = await pool.query("SELECT supplier_name, version FROM suppliers WHERE id = ?", [created.id]);
  assert.equal(afterStale.supplier_name, "Updated Integration Supplier");
  assert.equal(Number(afterStale.version), updated.version);

  const changed = await service.changeSupplierCode({
    ...base,
    id: created.id,
    supplierCode: changedCode,
    reason: "Correct an onboarding typo",
    version: updated.version
  });
  assert.equal(changed.supplierCode, changedCode);

  await assert.rejects(
    () => service.changeSupplierCode({
      ...base,
      id: created.id,
      supplierCode: occupiedCode.toLowerCase(),
      reason: "Attempt an occupied code",
      version: changed.version
    }),
    (error) => error.publicCode === "SUPPLIER_CODE_TAKEN"
  );

  const referenced = serviceFor(pool, {
    references: {
      async describeReferences() {
        return { references: { purchaseOrders: 1 }, total: 1 };
      }
    }
  });
  await assert.rejects(
    () => referenced.changeSupplierCode({
      ...base,
      id: created.id,
      supplierCode: `${changedCode}-REF`,
      reason: "Referenced Supplier must reject",
      version: changed.version
    }),
    (error) => error.publicCode === "SUPPLIER_REFERENCED"
  );
  const [[afterRejectedChanges]] = await pool.query("SELECT supplier_code, version FROM suppliers WHERE id = ?", [created.id]);
  assert.equal(afterRejectedChanges.supplier_code, changedCode);
  assert.equal(Number(afterRejectedChanges.version), changed.version);

  const [audits] = await pool.query(
    "SELECT action, reason FROM supplier_audit_logs WHERE supplier_id = ? ORDER BY id",
    [created.id]
  );
  assert.deepEqual(audits.map((row) => row.action), ["supplier.create", "supplier.update", "supplier.code.change"]);
  assert.equal(audits.at(-1).reason, "Correct an onboarding typo");
});

integrationTest("Supplier lifecycle is atomic, idempotent at the target state and preserves delete audit", async (t) => {
  const pool = mysql.createPool({ ...config(), connectionLimit: 5 });
  const suffix = String(Date.now());
  const ids = [];
  t.after(async () => {
    if (ids.length > 0) {
      await pool.query(`DELETE FROM supplier_audit_logs WHERE supplier_id IN (${ids.map(() => "?").join(",")})`, ids);
      await pool.query(`DELETE FROM suppliers WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    }
    await pool.end();
  });
  const service = serviceFor(pool);
  const [[actor]] = await pool.query("SELECT id FROM users WHERE status = 'active' ORDER BY id LIMIT 1");
  const actorId = Number(actor.id);
  const base = { actorId, claimedRoles: [], claimedPermissions: [], defaultCurrencyCode: "HKD", supplierName: "Lifecycle Supplier", requestId: `life-${suffix}` };
  const created = await service.createSupplier({ ...base, supplierCode: `LIFE-${suffix}` });
  ids.push(created.id);
  const command = { actorId, claimedRoles: [], claimedPermissions: [], id: created.id, reason: "Integration lifecycle reason", requestId: `life-${suffix}` };

  const active = await service.activateSupplier({ ...command, version: created.version });
  assert.equal(active.status, "active");
  const replay = await service.activateSupplier({ ...command, version: created.version });
  assert.equal(replay.version, active.version);
  const suspended = await service.suspendSupplier({ ...command, version: active.version });
  const reactivated = await service.reactivateSupplier({ ...command, version: suspended.version });
  const blocked = await service.blockSupplier({ ...command, version: reactivated.version });
  const unblocked = await service.unblockSupplier({ ...command, version: blocked.version });
  assert.equal(unblocked.status, "suspended");
  const archived = await service.archiveSupplier({ ...command, version: unblocked.version });
  const restored = await service.restoreSupplier({ ...command, version: archived.version });
  assert.equal(restored.status, "suspended");

  const [audits] = await pool.query("SELECT action FROM supplier_audit_logs WHERE supplier_id = ? ORDER BY id", [created.id]);
  assert.deepEqual(audits.map((row) => row.action), [
    "supplier.create", "supplier.activate", "supplier.suspend", "supplier.reactivate",
    "supplier.block", "supplier.unblock", "supplier.archive", "supplier.restore"
  ]);

  const openFlowService = serviceFor(pool, {
    openFlows: { async describeReferences() { return { references: { openPurchaseOrders: 1 }, total: 1 }; } }
  });
  await assert.rejects(
    () => openFlowService.archiveSupplier({ ...command, version: restored.version }),
    (error) => error.publicCode === "SUPPLIER_OPEN_FLOWS"
  );
  const [[afterOpenFlow]] = await pool.query("SELECT status, version FROM suppliers WHERE id = ?", [created.id]);
  assert.equal(afterOpenFlow.status, "suspended");
  assert.equal(Number(afterOpenFlow.version), restored.version);

  const deleteCandidate = await service.createSupplier({ ...base, supplierCode: `DEL-${suffix}`, supplierName: "Delete Candidate" });
  ids.push(deleteCandidate.id);
  const referencedDelete = serviceFor(pool, {
    references: { async describeReferences() { return { references: { purchaseOrders: 1 }, total: 1 }; } }
  });
  await assert.rejects(
    () => referencedDelete.deleteSupplier({ ...command, id: deleteCandidate.id, version: deleteCandidate.version }),
    (error) => error.publicCode === "SUPPLIER_REFERENCED"
  );
  assert.deepEqual(
    await service.deleteSupplier({ ...command, id: deleteCandidate.id, version: deleteCandidate.version }),
    { id: deleteCandidate.id }
  );
  const [[deletedRoot]] = await pool.query("SELECT id FROM suppliers WHERE id = ?", [deleteCandidate.id]);
  assert.equal(deletedRoot, undefined);
  const [[deleteAudit]] = await pool.query("SELECT action, reason FROM supplier_audit_logs WHERE supplier_id = ? AND action = 'supplier.delete'", [deleteCandidate.id]);
  assert.equal(deleteAudit.action, "supplier.delete");
  assert.equal(deleteAudit.reason, command.reason);

  const rollback = serviceFor(pool, { audit: { async record() { throw new Error("lifecycle audit failed"); } } });
  await assert.rejects(
    () => rollback.archiveSupplier({ ...command, version: restored.version }),
    /lifecycle audit failed/u
  );
  const [[afterRollback]] = await pool.query("SELECT status, version FROM suppliers WHERE id = ?", [created.id]);
  assert.equal(afterRollback.status, "suspended");
  assert.equal(Number(afterRollback.version), restored.version);
});

integrationTest("Supplier core lookup keeps history visible and revalidates purchase eligibility in the caller transaction", async (t) => {
  const pool = mysql.createPool({ ...config(), connectionLimit: 5 });
  const suffix = String(Date.now());
  const code = `LOOK-${suffix}`;
  const supplierIds = [];
  t.after(async () => {
    if (supplierIds.length > 0) {
      await pool.query("DELETE FROM supplier_audit_logs WHERE supplier_id = ?", [supplierIds[0]]);
      await pool.query("DELETE FROM suppliers WHERE id = ?", [supplierIds[0]]);
    }
    await pool.end();
  });
  const admin = serviceFor(pool);
  const lookup = lookupFor(pool);
  const [[actor]] = await pool.query("SELECT id FROM users WHERE status = 'active' ORDER BY id LIMIT 1");
  const actorId = Number(actor.id);
  const created = await admin.createSupplier({
    actorId,
    claimedRoles: [],
    claimedPermissions: [],
    supplierCode: code,
    supplierName: "Lookup Integration Supplier",
    defaultCurrencyCode: "HKD",
    defaultCurrencyVersion: 1,
    activate: true,
    requestId: `lookup-${suffix}`
  });
  const supplierId = created.id;
  supplierIds.push(supplierId);
  const now = Date.now();
  const [addressResult] = await pool.execute(
    `INSERT INTO supplier_addresses
       (supplier_id, label, address_line1, city, country_code, status, version, created_at, updated_at, created_by, updated_by)
     VALUES (?, 'Ordering', '1 Integration Road', 'Hong Kong', 'HK', 'active', 1, ?, ?, ?, ?)`,
    [supplierId, now, now, actorId, actorId]
  );
  await pool.execute(
    `INSERT INTO supplier_address_purposes
       (address_id, supplier_id, purpose_code, is_primary, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, 'ordering', 1, ?, ?, ?, ?)`,
    [addressResult.insertId, supplierId, now, now, actorId, actorId]
  );

  const byId = await lookup.service.findById(supplierId, { purpose: "purchase" });
  const byCode = await lookup.service.findByCode(code.toLowerCase(), { purpose: "history" });
  const many = await lookup.service.findManyByIds([supplierId, supplierId], { purpose: "purchase" });
  assert.equal(byId.usable, true);
  assert.equal(byCode.supplierId, supplierId);
  assert.equal(many.size, 1);
  assert.equal("bankAccounts" in byId, false);

  const defaults = await lookup.service.getPurchaseDefaults(supplierId);
  assert.equal(defaults.currency.code, "HKD");
  assert.equal(defaults.paymentTerm, null);
  assert.equal(defaults.orderingAddress.addressLine1, "1 Integration Road");

  const lockOwner = await pool.getConnection();
  const contender = await pool.getConnection();
  try {
    await lockOwner.beginTransaction();
    const locked = await lookup.service.assertUsableInTransaction(lockOwner, supplierId, { purpose: "purchase" });
    assert.equal(locked.status, "active");
    await contender.query("SET SESSION innodb_lock_wait_timeout = 1");
    await contender.beginTransaction();
    await assert.rejects(
      () => contender.query("UPDATE suppliers SET status = 'suspended' WHERE id = ?", [supplierId]),
      (error) => error.errno === 1205 || error.code === "ER_LOCK_WAIT_TIMEOUT"
    );
    await contender.rollback();
    await lockOwner.commit();
  } finally {
    await contender.rollback().catch(() => undefined);
    await lockOwner.rollback().catch(() => undefined);
    contender.release();
    lockOwner.release();
  }

  const suspended = await admin.suspendSupplier({
    actorId,
    claimedRoles: [],
    claimedPermissions: [],
    id: supplierId,
    version: created.version,
    reason: "Verify submit-time status change",
    requestId: `lookup-suspend-${suffix}`
  });
  assert.equal(suspended.status, "suspended");
  const purchaseAfterSuspend = await lookup.service.findById(supplierId, { purpose: "purchase" });
  const historyAfterSuspend = await lookup.service.findById(supplierId, { purpose: "history" });
  assert.deepEqual(purchaseAfterSuspend.reasons, ["STATUS_NOT_ACTIVE"]);
  assert.equal(historyAfterSuspend.usable, true);

  await assert.rejects(
    () => lookup.database.withTransaction((connection) =>
      lookup.service.assertUsableInTransaction(connection, supplierId, { purpose: "purchase" })
    ),
    (error) => error.code === "SUPPLIER_NOT_USABLE" && error.details.supplierId === supplierId
  );
});

integrationTest("Supplier Business Master impact checks fail closed for unclassified persisted statuses", async (t) => {
  const pool = mysql.createPool({ ...config(), connectionLimit: 2 });
  const suffix = String(Date.now());
  const supplierIds = [];
  t.after(async () => {
    if (supplierIds.length > 0) await pool.query("DELETE FROM suppliers WHERE id = ?", [supplierIds[0]]);
    await pool.end();
  });
  const [[actor]] = await pool.query("SELECT id FROM users WHERE status = 'active' ORDER BY id LIMIT 1");
  const [result] = await pool.execute(
    `INSERT INTO suppliers
       (supplier_code, supplier_code_key, supplier_name, supplier_name_key, default_currency_code,
        status, version, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, 'Future Status Supplier', 'future status supplier', 'HKD', 'future_status', 1, ?, ?, ?, ?)`,
    [`STATE-${suffix}`, `state-${suffix}`, Date.now(), Date.now(), actor.id, actor.id]
  );
  supplierIds.push(Number(result.insertId));
  const checker = new SupplierBusinessMasterImpactChecker({ database: database(pool) });

  await assert.rejects(
    () => checker.check({ entityType: "CURRENCY", entityKey: "HKD" }),
    /unclassified status/u
  );
});
