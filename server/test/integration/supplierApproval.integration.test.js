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

/**
 * 種返自己嘅 actor，唔好靠 erp_dev 入面啱啱好有人。CI 嘅 schema 係新嘅，一個 user
 * 都冇 —— 而本機開發嘅 erp_dev 有一堆舊 user，所以「SELECT ... LIMIT 2」喺本機
 * 跑五次都綠，一上 CI 就 0 !== 2。呢個測試需要兩個唔同嘅人（提交人同審批人），
 * 佢就自己整兩個。
 */
async function seedActors(connection, suffix) {
  const now = Date.now();
  const ids = [];
  for (const role of ["requester", "approver"]) {
    const [result] = await connection.execute(
      "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [`supplier-approval-it-${role}-${suffix}`, "not-used-by-this-test", `Approval IT ${role}`, now, now]
    );
    ids.push(Number(result.insertId));
  }
  return { requesterId: ids[0], approverId: ids[1] };
}

async function cleanupActors(connection, who) {
  if (!who) return;
  for (const id of [who.requesterId, who.approverId]) {
    await connection.execute("DELETE FROM supplier_audit_logs WHERE actor_user_id = ?", [id]);
    await connection.execute("DELETE FROM user_roles WHERE user_id = ?", [id]);
    await connection.execute("DELETE FROM users WHERE id = ?", [id]);
  }
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
  let who = null;
  t.after(async () => {
    if (supplierId) await cleanup(connection, supplierId);
    await cleanupActors(connection, who);
    await connection.end();
  });

  who = await seedActors(connection, randomUUID().slice(0, 8));
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
  let who = null;
  t.after(async () => {
    if (supplierId) await cleanup(connection, supplierId);
    await cleanupActors(connection, who);
    await connection.end();
  });

  who = await seedActors(connection, randomUUID().slice(0, 8));
  const seeded = await seed(connection, randomUUID().slice(0, 8), who);
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
  let who = null;
  t.after(async () => {
    if (supplierId) await cleanup(setup, supplierId);
    await cleanupActors(setup, who);
    await editor.end(); await approver.end(); await setup.end();
  });

  who = await seedActors(setup, randomUUID().slice(0, 8));
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
  let who = null;
  t.after(async () => {
    if (supplierId) await cleanup(connection, supplierId);
    await cleanupActors(connection, who);
    await connection.end();
  });

  who = await seedActors(connection, randomUUID().slice(0, 8));
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

// A previous revision had an interleaving test here that replayed the three-way
// settings/currency cycle across raw connections. It was removed: its body issued
// only inline SQL and imported nothing from src/, so no production change could turn
// it red, and it cost 3.3s of a 4.8s suite while its assertion was satisfied by a
// lock-wait timeout. The cycle it characterised was measured by REV-023 (41
// ER_LOCK_DEADLOCK in 960 iterations of the old order) and REV-024 (2880 iterations,
// 0 deadlocks, of the current one). What guards the branch is the test below, which
// drives the real service and fails when the lock order is reverted.
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

integrationTest("a Supplier created with activate can actually be approved", async (t) => {
  // The submit path exists twice -- createSupplier and activateSupplier -- and the
  // round trip was only covered on the second. Mutating createSupplier's snapshot
  // version leaves the whole suite green while making every Supplier created this
  // way permanently unapprovable, which is the third time on this branch that
  // version arithmetic has been green and broken.
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  let who = null;
  t.after(async () => {
    if (supplierId) await cleanup(connection, supplierId);
    await cleanupActors(connection, who);
    await connection.end();
  });

  who = await seedActors(connection, randomUUID().slice(0, 8));
  const [[currency]] = await connection.query("SELECT code FROM currencies WHERE status = 'ACTIVE' LIMIT 1");
  const suffix = randomUUID().slice(0, 8);

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
    authorize: async () => ({ id: who.requesterId, username: "integration", permissions: ["supplier.mgmt"] }),
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

  const created = await admin.createSupplier({
    actorId: who.requesterId, claimedRoles: [], claimedPermissions: ["supplier.mgmt"],
    supplierCode: `APR-${suffix}`, supplierName: `Create Approve ${suffix}`,
    defaultCurrencyCode: currency.code ?? currency.CODE, activate: true,
    approverUserId: who.approverId, requestNote: "建檔即提交審批",
    requestId: "req-int", ip: "127.0.0.1"
  });
  supplierId = created.id;

  const [[supplier]] = await connection.query("SELECT status, version FROM suppliers WHERE id = ?", [supplierId]);
  assert.equal(supplier.status, "pending_approval");
  const [[request]] = await connection.query(
    "SELECT id, supplier_version, request_note FROM supplier_activation_requests WHERE supplier_id = ?", [supplierId]
  );
  assert.equal(Number(request.supplier_version), Number(supplier.version),
    "the snapshot must pin the version the create actually produced, or approval is impossible");
  assert.equal(request.request_note, "建檔即提交審批");

  const result = await serviceOn(connection, { actorId: who.approverId }).approveRequest({
    actorId: who.approverId, claimedRoles: [], claimedPermissions: ["supplier.approval"],
    id: request.id, version: 1, reason: "整合測試批准原因", requestId: "req-int", ip: "127.0.0.1"
  });
  assert.equal(result.status, "approved");
  const [[approved]] = await connection.query("SELECT status FROM suppliers WHERE id = ?", [supplierId]);
  assert.equal(approved.status, "active");
});

// ---- T29 read paths against real MySQL -------------------------------------

/**
 * Queue、detail 同 approver lookup 全部係 join：兩個 users self-join 加一個
 * suppliers join，approver lookup 仲要行 user_roles → role_permissions →
 * permissions。假連線用 sql.includes(...) 派送，所以一個打錯咗嘅欄位名或者一個
 * 唔存在嘅 join 照樣「成功」。呢度會真係出 ER_BAD_FIELD_ERROR。
 *
 * erp_dev 係共用嘅，`node --test` 亦會並行行唔同檔案，所以每個斷言都收窄到自己
 * 種落去嘅 id：`scope=all` 唔可以斷言總數，但 `requesterId` 收窄之後可以。
 */
async function seedQueue(connection, suffix, { requesterId, approverId }) {
  const [[currency]] = await connection.query("SELECT code FROM currencies LIMIT 1");
  const code = currency.code ?? currency.CODE;
  const now = Date.now();
  const created = [];
  for (const [index, approver] of [approverId, null, approverId].entries()) {
    const [supplier] = await connection.execute(
      `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key,
         default_currency_code, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending_approval', ?, ?)`,
      [`QUE-${suffix}-${index}`, `que-${suffix}-${index}`, `Queue ${suffix} ${index}`, `queue ${suffix} ${index}`, code, now, now]
    );
    const supplierId = Number(supplier.insertId);
    const [[row]] = await connection.query("SELECT * FROM suppliers WHERE id = ?", [supplierId]);
    const [request] = await connection.execute(
      `INSERT INTO supplier_activation_requests (supplier_id, requested_by, assigned_approver_id,
         supplier_version, summary, status, request_note, requested_at)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), 'pending', ?, ?)`,
      [supplierId, requesterId, approver, row.version, JSON.stringify(buildApprovalSummary(row)), `note ${index}`, now + index]
    );
    created.push({ supplierId, requestId: Number(request.insertId), assignedApproverId: approver, supplierVersion: Number(row.version) });
  }
  return created;
}

integrationTest("the queue scopes resolve against real MySQL joins", async (t) => {
  const connection = await mysql.createConnection(config());
  let who = null;
  let created = [];
  t.after(async () => {
    for (const row of created) await cleanup(connection, row.supplierId);
    await cleanupActors(connection, who);
    await connection.end();
  });
  const suffix = randomUUID().slice(0, 8);
  who = await seedActors(connection, suffix);
  created = await seedQueue(connection, suffix, who);
  const mine = created.filter((row) => row.assignedApproverId === who.approverId).map((row) => row.requestId).sort();
  const service = serviceOn(connection, { actorId: who.approverId });

  // approver 係啱啱種出嚟嘅，所以冇第二個測試可以指派嘢俾佢：mine 可以斷言精確集合。
  const queue = await service.listRequests({ actorId: who.approverId, claimedRoles: [], claimedPermissions: ["supplier.approval"] });
  assert.deepEqual(queue.items.map((item) => item.id).sort(), mine);
  assert.equal(queue.total, mine.length);
  assert.deepEqual(queue.items[0].requester, { id: who.requesterId, username: `supplier-approval-it-requester-${suffix}`, displayName: "Approval IT requester" },
    "the requester name must come from the users join, not from the request row");

  const unassigned = await service.listRequests({ actorId: who.approverId, claimedRoles: [], claimedPermissions: ["supplier.approval"], scope: "unassigned" });
  const ours = new Set(created.map((row) => row.requestId));
  const unassignedOurs = unassigned.items.filter((item) => ours.has(item.id));
  assert.deepEqual(unassignedOurs.map((item) => item.id), created.filter((row) => row.assignedApproverId === null).map((row) => row.requestId));
  assert.equal(unassignedOurs[0].assignedApprover, null, "an unassigned request must read as nobody");
});

integrationTest("the queue counts and pages the same filtered set", async (t) => {
  const connection = await mysql.createConnection(config());
  let who = null;
  let created = [];
  t.after(async () => {
    for (const row of created) await cleanup(connection, row.supplierId);
    await cleanupActors(connection, who);
    await connection.end();
  });
  const suffix = randomUUID().slice(0, 8);
  who = await seedActors(connection, suffix);
  created = await seedQueue(connection, suffix, who);
  const service = serviceOn(connection, { actorId: who.approverId });
  const filter = { actorId: who.approverId, claimedRoles: [], claimedPermissions: ["supplier.approval"], scope: "all", requesterId: who.requesterId };

  const first = await service.listRequests({ ...filter, page: 1, pageSize: 2 });
  const second = await service.listRequests({ ...filter, page: 2, pageSize: 2 });
  assert.equal(first.total, 3, "COUNT must see the whole filtered set, not the page");
  assert.equal(second.total, 3);
  assert.equal(first.items.length, 2);
  assert.equal(second.items.length, 1);
  const seen = [...first.items, ...second.items].map((item) => item.id).sort();
  assert.deepEqual(seen, created.map((row) => row.requestId).sort(), "the two pages must partition the set");
});

integrationTest("the detail reads the snapshot, the current Supplier and the real difference", async (t) => {
  const connection = await mysql.createConnection(config());
  let who = null;
  let seeded = null;
  t.after(async () => {
    if (seeded) await cleanup(connection, seeded.supplierId);
    await cleanupActors(connection, who);
    await connection.end();
  });
  const suffix = randomUUID().slice(0, 8);
  who = await seedActors(connection, suffix);
  seeded = await seed(connection, suffix, who);
  const service = serviceOn(connection, { actorId: who.approverId });
  const reader = { actorId: who.approverId, claimedRoles: [], claimedPermissions: ["supplier.approval"] };

  const fresh = await service.getRequest({ ...reader, id: seeded.requestId });
  assert.equal(fresh.stale, false);
  assert.deepEqual(fresh.changedFields, []);
  assert.equal(fresh.assignedApprover.id, who.approverId);

  // 一次真正嘅 approval-significant 改動：名同 version 一齊郁，snapshot 留喺原地。
  await connection.execute(
    "UPDATE suppliers SET supplier_name = ?, supplier_name_key = ?, version = version + 1 WHERE id = ?",
    [`Renamed ${suffix}`, `renamed ${suffix}`, seeded.supplierId]
  );
  const stale = await service.getRequest({ ...reader, id: seeded.requestId });
  assert.equal(stale.stale, true, "AC-012: a Supplier edited after submission makes the request stale");
  assert.deepEqual(stale.changedFields, ["supplierName"]);
  assert.equal(stale.current.supplierName, `Renamed ${suffix}`);
  assert.equal(stale.submitted.supplierName, `Approval ${suffix}`);
});

integrationTest("the eligible approver lookup is decided by the real role and permission rows", async (t) => {
  const connection = await mysql.createConnection(config());
  let who = null;
  let roleId = null;
  t.after(async () => {
    if (roleId) await connection.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    await cleanupActors(connection, who);
    await connection.end();
  });
  const suffix = randomUUID().slice(0, 8);
  who = await seedActors(connection, suffix);
  const [[permission]] = await connection.query("SELECT id FROM permissions WHERE name = 'supplier.approval'");
  assert.ok(permission, "migration 0034 must have seeded supplier.approval");
  const [role] = await connection.execute(
    "INSERT INTO roles (name, description, created_at) VALUES (?, '', ?)",
    [`supplier-approval-it-${suffix}`, Date.now()]
  );
  roleId = Number(role.insertId);
  // user_roles 同 role_permissions 都係 CASCADE，所以刪 role 就會連帶清走。
  await connection.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permission.id]);
  await connection.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [who.approverId, roleId]);

  const service = serviceOn(connection, { actorId: who.requesterId });
  const reader = { actorId: who.requesterId, claimedRoles: [], claimedPermissions: ["supplier.mgmt"] };

  const { items } = await service.listEligibleApprovers({ ...reader, q: `supplier-approval-it-` });
  const ours = items.filter((item) => item.id === who.approverId || item.id === who.requesterId);
  assert.deepEqual(ours, [{ id: who.approverId, username: `supplier-approval-it-approver-${suffix}`, displayName: "Approval IT approver" }],
    "only the user who really holds supplier.approval may be listed");

  const excluded = await service.listEligibleApprovers({ ...reader, q: "supplier-approval-it-", excludeUserId: who.approverId });
  assert.ok(!excluded.items.some((item) => item.id === who.approverId), "excludeUserId must drop that user");
});

/**
 * T31 起呢個檔案要覆蓋 SUP-CAP-02 嘅併發同安全出口，所以多咗兩件工具：
 *
 *   - `realAuthServiceOn` 用真正嘅 `assertActorFresh`。撤權測試用 stub 係證明唔到
 *     嘢嘅 —— stub 就係「而家嘅權限」嘅答案本身，改咗 `user_roles` 佢都唔會知。
 *   - `seedRole` / `grantRole` 種真嘅 role → permission → user 鏈，因為 `assertActorFresh`
 *     同 `assertEligibleApprover` 都係行呢三張表，唔係行任何 claim。
 */
function realAuthServiceOn(connection) {
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
    // authorize／loadPermissions 都刻意唔傳：用 service 自己嘅預設，即係真嘢。
    businessMaster: {
      async assertSupplierDefaultsInTransaction() {
        return { currency: { code: "HKD", status: "ACTIVE" }, paymentTerm: null };
      }
    }
  });
}

async function seedRole(connection, suffix) {
  const [[permission]] = await connection.query("SELECT id FROM permissions WHERE name = 'supplier.approval'");
  assert.ok(permission, "migration 0034 must have seeded supplier.approval");
  const [role] = await connection.execute(
    "INSERT INTO roles (name, description, created_at) VALUES (?, '', ?)",
    [`supplier-t31-it-${suffix}`, Date.now()]
  );
  const roleId = Number(role.insertId);
  await connection.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permission.id]);
  return roleId;
}

async function countAudit(connection, supplierId, action) {
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE supplier_id = ? AND action = ?",
    [supplierId, action]
  );
  return Number(row.n);
}

/**
 * AC-010／FR-APPROVAL-007：兩個人同時撳批准。設計靠 `suppliers` 嘅 FOR UPDATE 排序
 * 佢哋，之後第二個先讀到已經批咗嘅 row 並且行重送分支。呢度要證嘅唔係「兩個都唔
 * 死」，而係**只有一個 transition 同一筆 decision audit** —— 兩筆 audit 就係兩次
 * 決定，即使最終狀態睇落一樣。
 */
integrationTest("two concurrent approves produce one transition and exactly one decision audit", async (t) => {
  const first = await mysql.createConnection(config());
  const second = await mysql.createConnection(config());
  const setup = await mysql.createConnection(config());
  let supplierId = null;
  let who = null;
  t.after(async () => {
    if (supplierId) await cleanup(setup, supplierId);
    await cleanupActors(setup, who);
    await first.end(); await second.end(); await setup.end();
  });

  who = await seedActors(setup, randomUUID().slice(0, 8));
  const seeded = await seed(setup, randomUUID().slice(0, 8), who);
  supplierId = seeded.supplierId;

  const decision = (connection) => serviceOn(connection, { actorId: who.approverId }).approveRequest({
    actorId: who.approverId, claimedRoles: [], claimedPermissions: ["supplier.approval"],
    id: seeded.requestId, version: 1, reason: "併發批准原因", requestId: "req-race", ip: "127.0.0.1"
  }).then((result) => ({ ok: true, result }), (error) => ({ ok: false, code: error.publicCode ?? error.code ?? error.message }));

  const [a, b] = await Promise.all([decision(first), decision(second)]);
  const outcomes = [a, b];
  assert.ok(outcomes.every((o) => o.ok), `both calls must resolve; got ${JSON.stringify(outcomes)}`);
  assert.ok(outcomes.every((o) => o.result.status === "approved"), "both callers must end up seeing the same terminal status");

  const applied = outcomes.filter((o) => o.result.replayed === false);
  const replayed = outcomes.filter((o) => o.result.replayed === true);
  assert.equal(applied.length, 1, "exactly one call may perform the transition");
  assert.equal(replayed.length, 1, "the loser must replay the terminal state, not transition again");

  const [[request]] = await setup.query("SELECT status, version FROM supplier_activation_requests WHERE id = ?", [seeded.requestId]);
  assert.equal(request.status, "approved");
  assert.equal(Number(request.version), 2, "a second transition would have bumped the version again");
  const [[supplier]] = await setup.query("SELECT status, version FROM suppliers WHERE id = ?", [supplierId]);
  assert.equal(supplier.status, "active");
  assert.equal(await countAudit(setup, supplierId, "approval.approve"), 1, "one decision, one audit row");
});

/**
 * AC-010／FR-APPROVAL-007：重送同一個決定。上面嗰個併發測試靠真實鎖排序，所以佢
 * 邊一邊贏係唔固定嘅；呢個係確定性嘅控制 —— 同一個 version 送兩次，第二次一定要
 * 行重送分支，唔可以再寫一筆 audit。
 */
integrationTest("resending the same decision is idempotent and writes no second audit row", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  let who = null;
  t.after(async () => {
    if (supplierId) await cleanup(connection, supplierId);
    await cleanupActors(connection, who);
    await connection.end();
  });

  who = await seedActors(connection, randomUUID().slice(0, 8));
  const seeded = await seed(connection, randomUUID().slice(0, 8), who);
  supplierId = seeded.supplierId;

  const service = serviceOn(connection, { actorId: who.approverId });
  const decision = {
    actorId: who.approverId, claimedRoles: [], claimedPermissions: ["supplier.approval"],
    id: seeded.requestId, version: 1, reason: "重送測試批准原因", requestId: "req-int", ip: "127.0.0.1"
  };
  const applied = await service.approveRequest(decision);
  assert.equal(applied.replayed, false);
  assert.equal(applied.version, 2);

  const resent = await service.approveRequest(decision);
  assert.equal(resent.replayed, true, "FR-APPROVAL-007: a resend returns the current state");
  assert.equal(resent.status, "approved");
  assert.equal(resent.version, 2, "the replay must report the stored version, not input.version + 1");

  const [[request]] = await connection.query("SELECT version FROM supplier_activation_requests WHERE id = ?", [seeded.requestId]);
  assert.equal(Number(request.version), 2, "the resend must not transition again");
  assert.equal(await countAudit(connection, supplierId, "approval.approve"), 1, "a resend is not a second decision");
});

/**
 * AC-012／設計 §4.5：批准撞正一個關鍵資料改動。呢度刻意令編輯方贏（佢先攞
 * `suppliers` 鎖），因為咁樣先有確定性嘅斷言：一個 terminal 結果 = invalidated，
 * 而唔係「approved 同 invalidated 兩樣都發生過」。
 */
integrationTest("an approve racing a significant edit yields one terminal result, not both", async (t) => {
  const editor = await mysql.createConnection(config());
  const approver = await mysql.createConnection(config());
  const setup = await mysql.createConnection(config());
  let supplierId = null;
  let who = null;
  t.after(async () => {
    if (supplierId) await cleanup(setup, supplierId);
    await cleanupActors(setup, who);
    await editor.end(); await approver.end(); await setup.end();
  });

  who = await seedActors(setup, randomUUID().slice(0, 8));
  const suffix = randomUUID().slice(0, 8);
  const seeded = await seed(setup, suffix, who);
  supplierId = seeded.supplierId;

  // 編輯方跟設計 2.6 嘅鎖序：suppliers 行先。
  await editor.beginTransaction();
  await editor.query("SELECT * FROM suppliers WHERE id = ? FOR UPDATE", [supplierId]);

  const approving = serviceOn(approver, { actorId: who.approverId }).approveRequest({
    actorId: who.approverId, claimedRoles: [], claimedPermissions: ["supplier.approval"],
    id: seeded.requestId, version: 1, reason: "併發批准原因", requestId: "req-race", ip: "127.0.0.1"
  }).then(() => ({ ok: true }), (error) => ({ ok: false, code: error.publicCode ?? error.code ?? error.message }));

  // 俾批准方真係塞喺 suppliers 鎖度，唔係喺佢開始之前就完咗事。
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  await editor.execute(
    "UPDATE suppliers SET supplier_name = ?, supplier_name_key = ?, version = version + 1, updated_at = ? WHERE id = ?",
    [`Renamed ${suffix}`, `renamed ${suffix}`, Date.now(), supplierId]
  );
  await serviceOn(editor, { actorId: who.requesterId }).invalidateOpenRequest(editor, {
    supplierId, actorId: who.requesterId, actorUsername: "integration",
    supplierCode: `APR-${suffix}`, changedFields: ["supplierName"], requestId: "req-race", ip: "127.0.0.1"
  });
  await editor.execute("UPDATE suppliers SET status = 'draft' WHERE id = ? AND status = 'pending_approval'", [supplierId]);
  await editor.commit();

  const outcome = await approving;
  assert.equal(outcome.ok, false, "the edit won the Supplier lock, so the approve must not also succeed");
  assert.equal(outcome.code, "APPROVAL_REQUEST_NOT_OPEN", `unexpected failure: ${outcome.code}`);

  const [[request]] = await setup.query("SELECT status FROM supplier_activation_requests WHERE id = ?", [seeded.requestId]);
  assert.equal(request.status, "invalidated", "exactly one terminal status, and it is the edit's");
  const [[supplier]] = await setup.query("SELECT status FROM suppliers WHERE id = ?", [supplierId]);
  assert.equal(supplier.status, "draft", "a Supplier must never end up active on an invalidated request");
  assert.equal(await countAudit(setup, supplierId, "approval.approve"), 0, "the losing decision must leave no audit");
  assert.equal(await countAudit(setup, supplierId, "approval.invalidate"), 1);
});

/**
 * SEC-004／設計 §4.5：token 派發之後先撤權。呢個測試唔用 stub authorize —— 用
 * stub 嘅話「而家嘅權限」就係測試自己嗌出嚟嘅答案，改 `user_roles` 佢一無所知。
 *
 * 兩層都要證，因為佢哋擋嘅係兩件唔同嘅事：
 *   - 第一層 `assertActorFresh` 擋「claim 同現況唔夾」，即係揸住舊 token 嘅人。
 *   - 第二層 `#assertActorMayDecide` 擋「claim 同現況夾晒，但個人根本冇審批權」，
 *     即係一個誠實地冇權嘅 caller。淨係有第一層嘅話，佢會直接批到。
 */
integrationTest("a decision made after the approver's permission is revoked fails at both guards", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  let who = null;
  let roleId = null;
  t.after(async () => {
    if (supplierId) await cleanup(connection, supplierId);
    if (roleId) await connection.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    await cleanupActors(connection, who);
    await connection.end();
  });

  const suffix = randomUUID().slice(0, 8);
  who = await seedActors(connection, suffix);
  roleId = await seedRole(connection, suffix);
  await connection.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [who.approverId, roleId]);
  const seeded = await seed(connection, suffix, who);
  supplierId = seeded.supplierId;

  const service = realAuthServiceOn(connection);
  const decision = {
    actorId: who.approverId, id: seeded.requestId, version: 1,
    reason: "撤權測試批准原因", requestId: "req-int", ip: "127.0.0.1"
  };

  // 撤權：個 token 仲係講緊佢有 supplier.approval。
  await connection.execute("DELETE FROM user_roles WHERE user_id = ? AND role_id = ?", [who.approverId, roleId]);
  await assert.rejects(
    () => service.approveRequest({ ...decision, claimedRoles: [`supplier-t31-it-${suffix}`], claimedPermissions: ["supplier.approval"] }),
    (error) => error.publicCode === "PERMISSION_STALE",
    "a stale token must be refused before the decision is considered"
  );

  // 同一個人，今次誠實地 claim 返佢而家真係有嘅嘢（乜都冇）。第一層過到 —— claim
  // 同現況一致 —— 所以擋佢嘅一定要係第二層。
  await assert.rejects(
    () => service.approveRequest({ ...decision, claimedRoles: [], claimedPermissions: [] }),
    (error) => error.publicCode === "APPROVAL_PERMISSION_LOST",
    "an honest caller without supplier.approval must still be refused"
  );

  const [[request]] = await connection.query("SELECT status FROM supplier_activation_requests WHERE id = ?", [seeded.requestId]);
  assert.equal(request.status, "pending", "neither refused call may have decided anything");
  const [[supplier]] = await connection.query("SELECT status FROM suppliers WHERE id = ?", [supplierId]);
  assert.equal(supplier.status, "pending_approval");
  assert.equal(await countAudit(connection, supplierId, "approval.approve"), 0);
});

/**
 * BR-012／AC-008：審批人被停用。`assertEligibleApprover` 查嘅係 `status = 'active'`，
 * 所以呢度要真嘅 users row 先證得到 —— 一個 stub loadPermissions 係唔會睇 status 嘅。
 */
integrationTest("a disabled user can neither receive a reassignment nor decide", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  let who = null;
  let roleId = null;
  t.after(async () => {
    if (supplierId) await cleanup(connection, supplierId);
    if (roleId) await connection.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    await cleanupActors(connection, who);
    await connection.end();
  });

  const suffix = randomUUID().slice(0, 8);
  who = await seedActors(connection, suffix);
  roleId = await seedRole(connection, suffix);
  await connection.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [who.approverId, roleId]);
  const seeded = await seed(connection, suffix, who);
  supplierId = seeded.supplierId;

  // 佢仲有 supplier.approval —— 唯一變咗嘅係個帳號停用咗。
  await connection.execute("UPDATE users SET status = 'disabled' WHERE id = ?", [who.approverId]);

  const service = realAuthServiceOn(connection);
  await assert.rejects(
    () => service.reassignRequest({
      actorId: who.requesterId, claimedRoles: [], claimedPermissions: [],
      id: seeded.requestId, version: 1, approverUserId: who.approverId,
      reason: "重新指派俾停用帳號", requestId: "req-int", ip: "127.0.0.1"
    }),
    // reassign 第一關係 actor 自己要有 supplier.approval；requester 冇，所以佢會
    // 喺到停低。呢個斷言鎖住嘅係「順序」：actor 檢查行先，唔會借 reassign 去
    // 探測邊個帳號存在。
    (error) => error.publicCode === "APPROVAL_PERMISSION_LOST",
    "reassign must check the actor before it looks the target up"
  );

  // 用一個真係有權嘅 actor 再試一次，今次擋佢嘅一定要係 target 嘅 status。
  await connection.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [who.requesterId, roleId]);
  await assert.rejects(
    () => service.reassignRequest({
      actorId: who.requesterId, claimedRoles: [`supplier-t31-it-${suffix}`], claimedPermissions: ["supplier.approval"],
      id: seeded.requestId, version: 1, approverUserId: who.approverId,
      reason: "重新指派俾停用帳號", requestId: "req-int", ip: "127.0.0.1"
    }),
    (error) => error.publicCode === "APPROVER_NOT_ELIGIBLE",
    "a disabled user must not be assignable"
  );

  // 而佢自己亦都批唔到：停用之後 assertActorFresh 讀返空集合。
  await assert.rejects(
    () => service.approveRequest({
      actorId: who.approverId, claimedRoles: [], claimedPermissions: [],
      id: seeded.requestId, version: 1, reason: "停用帳號批准原因", requestId: "req-int", ip: "127.0.0.1"
    }),
    (error) => error.publicCode === "APPROVAL_PERMISSION_LOST",
    "a disabled approver must not be able to decide"
  );

  const [[request]] = await connection.query("SELECT status, assigned_approver_id FROM supplier_activation_requests WHERE id = ?", [seeded.requestId]);
  assert.equal(request.status, "pending");
  assert.equal(Number(request.assigned_approver_id), who.approverId, "no refused call may have moved the assignment");
});

/**
 * 設計 §6.3／REV-026 H-1：撤回係一條 child route，所以 route 上面嘅 Supplier 同
 * request 嘅 Supplier 要夾得返。呢度用真 row 證：借 Supplier B 條 route 去撤
 * Supplier A 嘅申請，要當「搵唔到」處理，而且 A 嗰個申請要原封不動。
 */
integrationTest("withdrawing through another Supplier's route is refused and changes nothing", async (t) => {
  const connection = await mysql.createConnection(config());
  let targetId = null;
  let decoyId = null;
  let who = null;
  t.after(async () => {
    if (targetId) await cleanup(connection, targetId);
    if (decoyId) await cleanup(connection, decoyId);
    await cleanupActors(connection, who);
    await connection.end();
  });

  who = await seedActors(connection, randomUUID().slice(0, 8));
  const target = await seed(connection, randomUUID().slice(0, 8), who);
  targetId = target.supplierId;
  const decoy = await seed(connection, randomUUID().slice(0, 8), who);
  decoyId = decoy.supplierId;

  const service = serviceOn(connection, { actorId: who.requesterId });
  await assert.rejects(
    () => service.withdrawRequest({
      actorId: who.requesterId, claimedRoles: [], claimedPermissions: ["supplier.mgmt"],
      // 真嘅 request id，但係另一個 Supplier 嘅 route。
      id: target.requestId, supplierId: decoyId,
      reason: "IDOR 探測", requestId: "req-int", ip: "127.0.0.1"
    }),
    // publicCode 同「申請搵唔到」共用，所以只比 code 係分唔到嘅；分別喺人睇到嗰句。
    (error) => error.publicCode === "SUPPLIER_NOT_FOUND" && error.publicMessage === "找不到這個供應商",
    "a cross-Supplier withdraw must look like a missing Supplier, not a permission hint"
  );

  const [[request]] = await connection.query("SELECT status, version FROM supplier_activation_requests WHERE id = ?", [target.requestId]);
  assert.equal(request.status, "pending", "the refused withdraw must not have touched the real request");
  assert.equal(Number(request.version), 1);
  assert.equal(await countAudit(connection, targetId, "approval.withdraw"), 0);
});

/**
 * 設計 §6.4：一個冇指派審批人嘅申請。安全失敗（冇人批得到）同恢復（重新指派之後
 * 批得返）係同一條規則嘅兩邊，所以喺同一個測試入面行晒。
 */
integrationTest("an unassigned request refuses every decision until a reassignment restores it", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  let who = null;
  let roleId = null;
  t.after(async () => {
    if (supplierId) await cleanup(connection, supplierId);
    if (roleId) await connection.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    await cleanupActors(connection, who);
    await connection.end();
  });

  const suffix = randomUUID().slice(0, 8);
  who = await seedActors(connection, suffix);
  roleId = await seedRole(connection, suffix);
  // 兩個人都真係有 supplier.approval：requester 攞嚟做重新指派嗰個 actor，
  // approver 係被指派嘅目標。
  await connection.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?), (?, ?)",
    [who.approverId, roleId, who.requesterId, roleId]);
  const seeded = await seed(connection, suffix, who);
  supplierId = seeded.supplierId;
  await connection.execute("UPDATE supplier_activation_requests SET assigned_approver_id = NULL WHERE id = ?", [seeded.requestId]);

  const service = realAuthServiceOn(connection);
  const claims = { claimedRoles: [`supplier-t31-it-${suffix}`], claimedPermissions: ["supplier.approval"] };

  await assert.rejects(
    () => service.approveRequest({
      ...claims, actorId: who.approverId, id: seeded.requestId, version: 1,
      reason: "未指派批准原因", requestId: "req-int", ip: "127.0.0.1"
    }),
    // sameUser(null, id) 一定係 false，所以一個 NULL 指派唔可以等於「邊個都得」。
    (error) => error.publicCode === "APPROVAL_NOT_ASSIGNED",
    "nobody may decide an unassigned request"
  );

  const reassigned = await service.reassignRequest({
    ...claims, actorId: who.requesterId, id: seeded.requestId, version: 1,
    approverUserId: who.approverId, reason: "重新指派俾審批人", requestId: "req-int", ip: "127.0.0.1"
  });
  assert.equal(reassigned.assignedApproverId, who.approverId);
  assert.equal(reassigned.version, 2);

  const approved = await service.approveRequest({
    ...claims, actorId: who.approverId, id: seeded.requestId, version: 2,
    reason: "重新指派後批准原因", requestId: "req-int", ip: "127.0.0.1"
  });
  assert.equal(approved.status, "approved", "the reassignment must actually restore the decision path");
  const [[supplier]] = await connection.query("SELECT status FROM suppliers WHERE id = ?", [supplierId]);
  assert.equal(supplier.status, "active");
  assert.equal(await countAudit(connection, supplierId, "approval.reassign"), 1);
  assert.equal(await countAudit(connection, supplierId, "approval.approve"), 1);
});
