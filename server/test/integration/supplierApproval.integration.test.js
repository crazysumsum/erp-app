import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

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
