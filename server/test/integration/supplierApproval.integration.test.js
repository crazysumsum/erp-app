import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

import { BusinessMasterProvider } from "../../src/modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../../src/modules/businessMaster/BusinessMasterRepository.js";
import { BusinessMasterLookupProvider } from "../../src/modules/supplier/providers/BusinessMasterLookupProvider.js";
import { SupplierAdminService } from "../../src/modules/supplier/SupplierAdminService.js";
import { getActivationPolicy } from "../../src/modules/supplier/SupplierSettingsService.js";
import { SupplierApprovalService, buildApprovalSummary } from "../../src/modules/supplier/SupplierApprovalService.js";

/**
 * 呢個 domain 對併發極敏感，而假連線證明唔到兩件事：SQL 本身跑唔跑得，同埋鎖序
 * 啱唔啱。REV-021 就係喺真 MySQL 上面砌到一個 ER_LOCK_DEADLOCK，而當時成套單元
 * 測試係全綠嘅；佢亦都示範咗將欄位改錯名（decided_bxy）之後 20/20 照樣過。
 */

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

function config() {
  return {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  };
}

function serviceOn(connection, { actorId, permissions = ["supplier.approval"] }) {
  return new SupplierApprovalService({
    database: {
      query: (sql, params) => connection.query(sql, params),
      async withTransaction(work) {
        await connection.beginTransaction();
        try {
          const result = await work(connection);
          await connection.commit();
          return result;
        } catch (error) {
          await connection.rollback();
          throw error;
        }
      }
    },
    logger: { warn() {} },
    time: { nowMs: () => Date.now() },
    authorize: async () => ({ id: actorId, username: "integration", permissions }),
    loadPermissions: async () => ["supplier.approval"],
    // businessMaster 係必需嘅：設計 4.5 要求批准時重新確認 Supplier 仍可啟用。
    businessMaster: {
      async assertSupplierDefaultsInTransaction() {
        return { currency: { code: "HKD", status: "ACTIVE" }, paymentTerm: null };
      }
    }
  });
}

async function actors(connection) {
  const [rows] = await connection.query("SELECT id FROM users WHERE status = 'active' ORDER BY id LIMIT 2");
  assert.equal(rows.length, 2, "this suite needs two active users in erp_dev");
  return { requesterId: Number(rows[0].id), approverId: Number(rows[1].id) };
}

async function seed(connection, suffix, { requesterId, approverId }) {
  const [[currency]] = await connection.query("SELECT code FROM currencies LIMIT 1");
  const now = Date.now();
  const [supplier] = await connection.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key,
       default_currency_code, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending_approval', ?, ?)`,
    [`APR-${suffix}`, `apr-${suffix}`, `Approval ${suffix}`, `approval ${suffix}`, currency.code ?? currency.CODE, now, now]
  );
  const supplierId = supplier.insertId;
  const [[row]] = await connection.query("SELECT * FROM suppliers WHERE id = ?", [supplierId]);
  const [request] = await connection.execute(
    `INSERT INTO supplier_activation_requests (supplier_id, requested_by, assigned_approver_id,
       supplier_version, summary, status, requested_at)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), 'pending', ?)`,
    [supplierId, requesterId, approverId, row.version, JSON.stringify(buildApprovalSummary(row)), now]
  );
  return { supplierId, requestId: request.insertId, supplierVersion: row.version };
}

async function cleanup(connection, supplierId) {
  // supplier_audit_logs has no FK to suppliers, so an audit row committed by a
  // connection that is still finishing would be orphaned by a supplier-id-only
  // delete. The request_id sweep catches it whichever order they land in.
  await connection.execute("DELETE FROM supplier_audit_logs WHERE supplier_id = ? OR request_id IN ('req-int', 'req-race')", [supplierId]);
  await connection.execute("DELETE FROM supplier_activation_requests WHERE supplier_id = ?", [supplierId]);
  await connection.execute("DELETE FROM suppliers WHERE id = ?", [supplierId]);
}

integrationTest("approving runs against real MySQL: every column exists and the row really moves", async (t) => {
  // 假連線用 sql.includes(...) 派送，所以一個打錯咗嘅欄位名照樣「成功」。呢度會
  // 真係出 ER_BAD_FIELD_ERROR。
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => { if (supplierId) await cleanup(connection, supplierId); await connection.end(); });

  const who = await actors(connection);
  const seeded = await seed(connection, randomUUID().slice(0, 8), who);
  supplierId = seeded.supplierId;

  const service = serviceOn(connection, { actorId: who.approverId });
  const result = await service.approveRequest({
    actorId: who.approverId, claimedRoles: [], claimedPermissions: ["supplier.approval"],
    id: seeded.requestId, version: 1, reason: "整合測試批准原因", requestId: "req-int", ip: "127.0.0.1"
  });
  assert.equal(result.status, "approved");

  const [[request]] = await connection.query("SELECT status, decided_at, version FROM supplier_activation_requests WHERE id = ?", [seeded.requestId]);
  assert.equal(request.status, "approved");
  assert.ok(Number(request.decided_at) > 0, "decided_at must actually be written");
  assert.equal(Number(request.version), 2);
  const [[supplier]] = await connection.query("SELECT status FROM suppliers WHERE id = ?", [supplierId]);
  assert.equal(supplier.status, "active");
  const [[audit]] = await connection.query(
    "SELECT action FROM supplier_audit_logs WHERE supplier_id = ? ORDER BY id DESC LIMIT 1", [supplierId]
  );
  assert.equal(audit.action, "approval.approve");
});

integrationTest("the database refuses a second pending request for one Supplier", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => { if (supplierId) await cleanup(connection, supplierId); await connection.end(); });

  const seeded = await seed(connection, randomUUID().slice(0, 8), await actors(connection));
  supplierId = seeded.supplierId;
  await assert.rejects(
    () => connection.execute(
      `INSERT INTO supplier_activation_requests (supplier_id, supplier_version, summary, status, requested_at)
       VALUES (?, 1, JSON_OBJECT(), 'pending', ?)`,
      [supplierId, Date.now()]
    ),
    (error) => error.code === "ER_DUP_ENTRY",
    "uq_supplier_activation_pending is the backstop for a double submit"
  );
});

integrationTest("an approve interleaved with an editing transaction does not deadlock", async (t) => {
  // REV-021 H1: #decide used to lock the request before the Supplier, the reverse of
  // updateSupplier. Crossing the two produced ER_LOCK_DEADLOCK on real MySQL while
  // every unit test stayed green. This reproduces that exact interleaving.
  const editor = await mysql.createConnection(config());
  const approver = await mysql.createConnection(config());
  const setup = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => {
    if (supplierId) await cleanup(setup, supplierId);
    await editor.end(); await approver.end(); await setup.end();
  });

  const who = await actors(setup);
  const seeded = await seed(setup, randomUUID().slice(0, 8), who);
  supplierId = seeded.supplierId;

  // The editor takes the documented order: suppliers first.
  await editor.beginTransaction();
  await editor.query("SELECT * FROM suppliers WHERE id = ? FOR UPDATE", [supplierId]);

  // The approver starts while the editor holds the Supplier. With the correct order
  // it blocks on suppliers -- its first lock -- and never holds the request while
  // waiting, so the editor can still take the request and finish.
  const approving = serviceOn(approver, { actorId: who.approverId }).approveRequest({
    actorId: who.approverId, claimedRoles: [], claimedPermissions: ["supplier.approval"],
    id: seeded.requestId, version: 1, reason: "併發測試批准原因", requestId: "req-race", ip: "127.0.0.1"
  }).then(() => "approved", (error) => `${error.code ?? error.publicCode ?? error.message}`);

  await new Promise((resolve) => { setTimeout(resolve, 300); });
  await editor.query("SELECT * FROM supplier_activation_requests WHERE id = ? FOR UPDATE", [seeded.requestId]);
  await editor.commit();

  const outcome = await approving;
  assert.notEqual(outcome, "ER_LOCK_DEADLOCK", "the approve path re-inverted the lock order");
  assert.equal(outcome, "approved");
});

integrationTest("a Supplier submitted through activateSupplier can actually be approved", async (t) => {
  // Every other test in this file seeds the request by hand, so the version the
  // submit path writes was never compared against the version the approve path
  // reads. Both off-by-one mutations of that arithmetic left the whole suite green,
  // and either one makes every approval impossible forever.
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => { if (supplierId) await cleanup(connection, supplierId); await connection.end(); });

  const who = await actors(connection);
  const [[currency]] = await connection.query("SELECT code FROM currencies LIMIT 1");
  const suffix = randomUUID().slice(0, 8);
  const now = Date.now();
  const [created] = await connection.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key,
       default_currency_code, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
    [`APR-${suffix}`, `apr-${suffix}`, `Round Trip ${suffix}`, `round trip ${suffix}`, currency.code ?? currency.CODE, now, now]
  );
  supplierId = created.insertId;

  const admin = new SupplierAdminService({
    database: {
      query: (sql, params) => connection.query(sql, params),
      async withTransaction(work) {
        await connection.beginTransaction();
        try { const result = await work(connection); await connection.commit(); return result; }
        catch (error) { await connection.rollback(); throw error; }
      }
    },
    logger: { warn() {} },
    time: { nowMs: () => Date.now() },
    authorize: async () => ({ id: who.requesterId, username: "integration", permissions: ["supplier.mgmt", "supplier.approval"] }),
    businessMaster: {
      async assertSupplierDefaultsInTransaction() { return { currency: { code: "HKD", status: "ACTIVE" }, paymentTerm: null }; }
    },
    approvalRequired: async () => true,
    approvals: new SupplierApprovalService({
      database: { query: (sql, params) => connection.query(sql, params) },
      logger: { warn() {} }, time: { nowMs: () => Date.now() },
      loadPermissions: async () => ["supplier.approval"],
      businessMaster: {
        async assertSupplierDefaultsInTransaction() { return { currency: { code: "HKD", status: "ACTIVE" }, paymentTerm: null }; }
      }
    })
  });

  await admin.activateSupplier({
    actorId: who.requesterId, claimedRoles: [], claimedPermissions: ["supplier.mgmt"],
    id: supplierId, version: 1, approverUserId: who.approverId,
    reason: "整合測試提交審批", requestId: "req-int", ip: "127.0.0.1"
  });

  const [[supplier]] = await connection.query("SELECT status, version FROM suppliers WHERE id = ?", [supplierId]);
  assert.equal(supplier.status, "pending_approval");
  const [[request]] = await connection.query(
    "SELECT id, supplier_version, status FROM supplier_activation_requests WHERE supplier_id = ?", [supplierId]
  );
  assert.equal(Number(request.supplier_version), Number(supplier.version),
    "the snapshot must pin the version the submit actually produced, or approval is impossible");

  const result = await serviceOn(connection, { actorId: who.approverId }).approveRequest({
    actorId: who.approverId, claimedRoles: [], claimedPermissions: ["supplier.approval"],
    id: request.id, version: 1, reason: "整合測試批准原因", requestId: "req-int", ip: "127.0.0.1"
  });
  assert.equal(result.status, "approved");
  const [[approved]] = await connection.query("SELECT status FROM suppliers WHERE id = ?", [supplierId]);
  assert.equal(approved.status, "active");
});

integrationTest("createSupplier and activateSupplier take the settings and currency locks in the same order", async (t) => {
  // REV-024 H1: the lock-order fix this branch is named after had no regression
  // test, and every other integration test here stubs both locks -- businessMaster
  // and approvalRequired are faked, so no test ever took a real `currencies FOR
  // UPDATE` or `supplier_settings FOR SHARE`. That is the precise pair behind two of
  // the three High findings this branch produced.
  //
  // createSupplier used to lock currencies (X) before settings (S) while
  // #changeStatus locks settings first. InnoDB will not grant S past a waiting X, so
  // an updateSettings queued between them closes a three-way cycle. This replays
  // that interleaving with the real statements.
  const conns = await Promise.all([0, 1, 2].map(() => mysql.createConnection(config())));
  const [activator, creator, settingsWriter] = conns;
  t.after(async () => { for (const c of conns) { await c.rollback().catch(() => {}); await c.end(); } });

  const [[currency]] = await activator.query("SELECT code FROM currencies LIMIT 1");
  const code = currency.code ?? currency.CODE;
  const settingsRead = "SELECT require_activation_approval FROM supplier_settings WHERE id = 1 FOR SHARE";
  const currencyLock = "SELECT code FROM currencies WHERE code = ? FOR UPDATE";
  const outcome = {};

  for (const c of conns) {
    await c.query("SET SESSION innodb_lock_wait_timeout = 3");
    await c.beginTransaction();
  }
  // #changeStatus order: settings first.
  await activator.query(settingsRead);
  // createSupplier must take settings first too. Taking the currency lock here is
  // what used to close the cycle.
  await creator.query(settingsRead);
  await new Promise((resolve) => { setTimeout(resolve, 150); });
  // An operator saving settings queues an X, which blocks any later S.
  const writing = settingsWriter.query("SELECT version FROM supplier_settings WHERE id = 1 FOR UPDATE")
    .then(() => { outcome.settingsWriter = "ok"; }, (error) => { outcome.settingsWriter = error.code ?? error.message; });
  await new Promise((resolve) => { setTimeout(resolve, 150); });
  const activating = activator.query(currencyLock, [code])
    .then(() => { outcome.activator = "ok"; }, (error) => { outcome.activator = error.code ?? error.message; });
  const creating = creator.query(currencyLock, [code])
    .then(() => { outcome.creator = "ok"; }, (error) => { outcome.creator = error.code ?? error.message; });
  await Promise.all([writing, activating, creating]);

  assert.notEqual(outcome.activator, "ER_LOCK_DEADLOCK", "the settings/currency lock order was re-inverted");
  assert.notEqual(outcome.creator, "ER_LOCK_DEADLOCK", "the settings/currency lock order was re-inverted");
  assert.notEqual(outcome.settingsWriter, "ER_LOCK_DEADLOCK", "the settings/currency lock order was re-inverted");
});

integrationTest("createSupplier really does read the policy before the currency lock", async (t) => {
  // The interleaving test above proves the ORDER is safe; this proves createSupplier
  // is the thing that takes it, by observing the statements the real service issues.
  const connection = await mysql.createConnection(config());
  t.after(() => connection.end());
  const order = [];
  const spy = {
    query: (sql, params) => { order.push(String(sql)); return connection.query(sql, params); },
    execute: (sql, params) => { order.push(String(sql)); return connection.execute(sql, params); },
    beginTransaction: () => connection.beginTransaction(),
    rollback: () => connection.rollback()
  };
  const admin = new SupplierAdminService({
    database: {
      query: (sql, params) => connection.query(sql, params),
      async withTransaction(work) {
        await connection.beginTransaction();
        try { return await work(spy); } finally { await connection.rollback(); }
      }
    },
    logger: { warn() {} },
    time: { nowMs: () => Date.now() },
    authorize: async () => ({ id: null, username: "integration", permissions: ["supplier.mgmt"] }),
    businessMaster: new BusinessMasterLookupProvider({
      provider: new BusinessMasterProvider({ database: connection, repository: new BusinessMasterRepository() }),
      readiness: { async assertReady() { return true; } }
    }),
    approvalRequired: getActivationPolicy
  });

  const [[currency]] = await connection.query("SELECT code FROM currencies WHERE status = 'ACTIVE' LIMIT 1");
  const suffix = randomUUID().slice(0, 8);
  await admin.createSupplier({
    actorId: null, claimedRoles: [], claimedPermissions: ["supplier.mgmt"],
    supplierCode: `APR-${suffix}`, supplierName: `Order Probe ${suffix}`,
    defaultCurrencyCode: currency.code ?? currency.CODE, activate: true,
    requestId: "req-int", ip: "127.0.0.1"
  }).catch(() => {});   // the transaction is rolled back either way; the order is the assertion

  const settingsAt = order.findIndex((sql) => sql.includes("supplier_settings"));
  const currencyAt = order.findIndex((sql) => sql.includes("FROM currencies") && sql.includes("FOR UPDATE"));
  assert.notEqual(settingsAt, -1, "createSupplier did not read the activation policy");
  assert.notEqual(currencyAt, -1, "createSupplier did not take the currency lock");
  assert.ok(settingsAt < currencyAt,
    `design 2.6 puts settings first; saw settings at ${settingsAt} and currency at ${currencyAt}`);
});
