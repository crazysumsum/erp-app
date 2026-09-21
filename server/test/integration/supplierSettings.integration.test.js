import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

import { SupplierApprovalService } from "../../src/modules/supplier/SupplierApprovalService.js";
import { SupplierAuditLogService } from "../../src/modules/supplier/SupplierAuditLogService.js";
import { SupplierSettingsService, getActivationPolicy } from "../../src/modules/supplier/SupplierSettingsService.js";

/**
 * 設定係一個 singleton，而 erp_dev 係共用嘅：`node --test` 會並行跑唔同檔案。
 * 所以呢度每個會改到 id=1 嘅測試都喺一個一定 rollback 嘅交易入面做 —— 其他連線
 * 見唔到中間值，亦唔使靠 after-hook 執手尾。REV-015 就係喺 0036 嗰個測試度指出
 * 呢一點，並且明確講 TASK-026 會令佢由「今日啱啱好冇事」變成真問題。
 */

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

function serviceFor(connection, { username = "integration", audited = [], realAudit = false } = {}) {
  const database = {
    query: (sql, params) => connection.query(sql, params),
    async withTransaction(work) {
      await connection.beginTransaction();
      try {
        const result = await work(connection);
        // 唔 commit：呢個 suite 唔會留低任何改動。Service 已經做晒佢要做嘅寫入。
        return result;
      } finally {
        await connection.rollback();
      }
    }
  };
  const logger = { warn() {} };
  const time = { nowMs: () => Date.now() };
  return new SupplierSettingsService({
    database,
    logger,
    time,
    authorize: async () => ({ id: null, username }),
    // realAudit 行真正嘅 SupplierAuditLogService：action prefix、detail key 白名單、
    // 敏感欄位檢查同 8KB 上限全部由佢執行，唔係由測試自己寫一句 INSERT 模仿。
    audit: realAudit
      ? new SupplierAuditLogService({ database, logger, time, authorize: async () => ({ id: null, username }) })
      : { async record(txn, input) { audited.push(input); await txn.execute(
      `INSERT INTO supplier_audit_logs (occurred_at, actor_user_id, actor_username, action, target_type, target_id, supplier_id, target_label, reason, detail, request_id, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [Date.now(), null, input.actorUsername, input.action, input.targetType, input.targetId, input.supplierId,
       input.targetLabel, input.reason, JSON.stringify(input.detail), input.requestId ?? "", input.ip ?? ""]
    ); } }
  });
}

const actor = { actorId: null, claimedRoles: [], claimedPermissions: ["supplier.settings"], reason: "整合測試變更設定原因", requestId: "req-int", ip: "127.0.0.1" };

integrationTest("the singleton reads back as typed values against real MySQL", async (t) => {
  const connection = await mysql.createConnection(config());
  t.after(() => connection.end());
  const settings = await serviceFor(connection).getSettings(actor);
  assert.equal(typeof settings.requireActivationApproval, "boolean", "TINYINT(1) must not leak as 0/1");
  assert.ok(Number.isInteger(settings.version) && settings.version >= 1);
});

integrationTest("an update bumps the version and writes an audit row the real schema accepts", async (t) => {
  const connection = await mysql.createConnection(config());
  t.after(() => connection.end());
  const [[before]] = await connection.query("SELECT require_activation_approval, version FROM supplier_settings WHERE id = 1");

  // Deliberately NOT asserted here: that no Supplier row was touched. erp_dev is
  // shared and other integration files create Suppliers in parallel, so any global
  // count is racy by construction. That property is proved deterministically in
  // supplierSettingsService.test.js by inspecting the SQL the update issues.
  const audited = [];
  const target = Number(before.require_activation_approval) !== 1;
  const result = await serviceFor(connection, { audited })
    .updateSettings({ ...actor, version: Number(before.version), requireActivationApproval: target });

  assert.equal(result.requireActivationApproval, target);
  assert.equal(result.version, Number(before.version) + 1);

  // The recorder performed a real INSERT inside the rolled-back transaction, so a
  // wrong column or an oversized value would have surfaced as a MySQL error here.
  assert.equal(audited.length, 1);
  assert.equal(audited[0].action, "setting.update");
  assert.equal(audited[0].supplierId, null);
  assert.deepEqual(audited[0].detail, {
    before: { requireActivationApproval: !target },
    after: { requireActivationApproval: target }
  });

  const [[after]] = await connection.query("SELECT require_activation_approval, version FROM supplier_settings WHERE id = 1");
  assert.equal(Number(after.version), Number(before.version), "the rolled-back probe must leave no trace");
  assert.equal(Number(after.require_activation_approval), Number(before.require_activation_approval));
});

integrationTest("a stale version is refused before any write reaches MySQL", async (t) => {
  const connection = await mysql.createConnection(config());
  t.after(() => connection.end());
  const [[current]] = await connection.query("SELECT version FROM supplier_settings WHERE id = 1");
  await assert.rejects(
    () => serviceFor(connection).updateSettings({ ...actor, version: Number(current.version) + 99, requireActivationApproval: true }),
    (error) => error.publicCode === "VERSION_CONFLICT"
  );
});

integrationTest("getActivationPolicy reads the caller's own transaction and its FOR SHARE is valid SQL", async (t) => {
  // FOR SHARE 只可以喺交易入面攞到鎖，而且語法本身要真係跑得 —— 假連線證明唔到。
  const connection = await mysql.createConnection(config());
  t.after(() => connection.end());
  const [[row]] = await connection.query("SELECT require_activation_approval FROM supplier_settings WHERE id = 1");
  await connection.beginTransaction();
  try {
    assert.equal(await getActivationPolicy(connection), Number(row.require_activation_approval) === 1);
  } finally {
    await connection.rollback();
  }
});

integrationTest("an in-flight activation read blocks a concurrent settings write until it finishes", async (t) => {
  // AC-013／FR-SET-005 嘅併發形態：一個啟用操作讀咗政策之後，設定寫入唔可以喺
  // 佢中途改走個答案。FOR SHARE 對 FOR UPDATE 就係呢個效果。
  const reader = await mysql.createConnection(config());
  const writer = await mysql.createConnection(config());
  t.after(async () => { await reader.end(); await writer.end(); });

  await reader.beginTransaction();
  try {
    await getActivationPolicy(reader);
    await writer.query("SET SESSION innodb_lock_wait_timeout = 1");
    await writer.beginTransaction();
    try {
      await assert.rejects(
        () => writer.query("SELECT version FROM supplier_settings WHERE id = 1 FOR UPDATE"),
        (error) => error.code === "ER_LOCK_WAIT_TIMEOUT",
        "the settings writer must wait for the in-flight activation, not overtake it"
      );
    } finally {
      await writer.rollback();
    }
  } finally {
    await reader.rollback();
  }
});

integrationTest("the real audit recorder accepts a settings update and stores before/after", async (t) => {
  // AC-037 要求前後值同原因喺稽核查得到。之前兩層測試都注入假 audit，所以真正
  // 嘅 SupplierAuditLogService 由頭到尾冇跑過：拆走佢個 "setting." action prefix
  // 都唔會有測試變紅。呢個測試行真嘅 recorder，喺 rollback 之前讀返條 row。
  const connection = await mysql.createConnection(config());
  t.after(() => connection.end());
  const [[before]] = await connection.query("SELECT require_activation_approval, version FROM supplier_settings WHERE id = 1");
  const target = Number(before.require_activation_approval) !== 1;

  let stored = null;
  const service = serviceFor(connection, { realAudit: true });
  const inspect = service.database.withTransaction.bind(service.database);
  service.database.withTransaction = async (work) => inspect(async (txn) => {
    const result = await work(txn);
    const [[row]] = await txn.query(
      "SELECT action, target_type, target_id, supplier_id, target_label, reason, detail FROM supplier_audit_logs ORDER BY id DESC LIMIT 1"
    );
    stored = row;
    return result;
  });

  await service.updateSettings({ ...actor, version: Number(before.version), requireActivationApproval: target });

  assert.equal(stored.action, "setting.update", "the real recorder rejects an action prefix it does not allow");
  assert.equal(stored.target_type, "setting");
  assert.equal(Number(stored.target_id), 1);
  assert.equal(stored.supplier_id, null);
  assert.equal(stored.reason, actor.reason);
  const detail = typeof stored.detail === "string" ? JSON.parse(stored.detail) : stored.detail;
  assert.deepEqual(detail, {
    before: { requireActivationApproval: !target },
    after: { requireActivationApproval: target }
  });

  const [[after]] = await connection.query("SELECT version FROM supplier_settings WHERE id = 1");
  assert.equal(Number(after.version), Number(before.version), "the rolled-back probe must leave no trace");
});

/**
 * T31：設定同啟用之間嘅兩條併發規則。上面嗰個 `serviceFor` 用 begin/rollback 包住
 * 自己嘅寫入，但落面嘅場景要喺**同一個交易**入面同時郁設定同審批申請 —— 喺一個
 * 已經開咗嘅交易入面再 `beginTransaction()`，MySQL 會隱式 commit 咗前面嗰個，即係
 * 將呢個測試嘅中間值放咗出去俾其他並行檔案見到。所以呢個 wrapper 只借用 caller
 * 嘅交易，唔開新嘅，亦都唔 commit。
 */
function joiningDatabase(connection) {
  return {
    query: (sql, params) => connection.query(sql, params),
    // REV-032 L-2：真嘅 wrapper 失敗時會 rollback，呢個借用交易嘅版本冇得 rollback
    // 成個交易（佢唔屬於佢），所以用 savepoint 做返同一件事。今日呢個測試最外層一定
    // rollback，所以睇唔出分別；但下一個借用呢個 helper、而又預期「失敗嘅指令唔會
    // 留低半截寫入」嘅測試，就會靜靜哋錯。
    async withTransaction(work) {
      const savepoint = `join_${Math.random().toString(36).slice(2, 10)}`;
      await connection.query(`SAVEPOINT ${savepoint}`);
      try {
        return await work(connection);
      } catch (error) {
        await connection.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        throw error;
      }
    }
  };
}

async function seedPendingApproval(connection, suffix) {
  const now = Date.now();
  const ids = [];
  for (const role of ["requester", "approver"]) {
    const [user] = await connection.execute(
      "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [`supplier-settings-it-${role}-${suffix}`, "not-used-by-this-test", `Settings IT ${role}`, now, now]
    );
    ids.push(Number(user.insertId));
  }
  const [[currency]] = await connection.query("SELECT code FROM currencies LIMIT 1");
  const [supplier] = await connection.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key,
       default_currency_code, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending_approval', ?, ?)`,
    [`SET-${suffix}`, `set-${suffix}`, `Settings ${suffix}`, `settings ${suffix}`, currency.code ?? currency.CODE, now, now]
  );
  const supplierId = Number(supplier.insertId);
  const [[row]] = await connection.query("SELECT version FROM suppliers WHERE id = ?", [supplierId]);
  const [request] = await connection.execute(
    `INSERT INTO supplier_activation_requests (supplier_id, requested_by, assigned_approver_id,
       supplier_version, summary, status, requested_at)
     VALUES (?, ?, ?, ?, JSON_OBJECT(), 'pending', ?)`,
    [supplierId, ids[0], ids[1], row.version, now]
  );
  return { requesterId: ids[0], approverId: ids[1], supplierId, requestId: Number(request.insertId) };
}

/**
 * FR-SET-005／AC-013：關掉審批政策**唔係**一個批准動作。已經 pending 嘅申請要繼續
 * pending，Supplier 要留喺 pending_approval，而佢仍然只可以由被指派嘅審批人決定。
 *
 * 呢個規則冇一段對應嘅程式碼 —— 佢係「冇任何一條路會咁做」。所以佢要用行為證：
 * 真係關一次政策，然後睇住張申請。
 */
integrationTest("turning the approval policy off does not decide an already pending request", async (t) => {
  const connection = await mysql.createConnection(config());
  t.after(() => connection.end());

  await connection.beginTransaction();
  try {
    const seeded = await seedPendingApproval(connection, randomUUID().slice(0, 8));

    // 由「開」行到「關」，先至有嘢可以關。
    await connection.execute("UPDATE supplier_settings SET require_activation_approval = 1, version = version + 1 WHERE id = 1");
    const [[current]] = await connection.query("SELECT version FROM supplier_settings WHERE id = 1");

    const settings = new SupplierSettingsService({
      database: joiningDatabase(connection),
      logger: { warn() {} },
      time: { nowMs: () => Date.now() },
      authorize: async () => ({ id: null, username: "integration" }),
      audit: { async record() {} }
    });
    const off = await settings.updateSettings({ ...actor, version: Number(current.version), requireActivationApproval: false });
    assert.equal(off.requireActivationApproval, false);
    assert.equal(await getActivationPolicy(connection), false, "the policy really is off inside this transaction");

    const [[request]] = await connection.query("SELECT status, version FROM supplier_activation_requests WHERE id = ?", [seeded.requestId]);
    assert.equal(request.status, "pending", "BR-013: switching the policy off must not approve what is already pending");
    assert.equal(Number(request.version), 1, "an untouched request keeps its version");
    const [[supplier]] = await connection.query("SELECT status FROM suppliers WHERE id = ?", [seeded.supplierId]);
    assert.equal(supplier.status, "pending_approval", "the Supplier must not drift to active on its own");

    const approvals = new SupplierApprovalService({
      database: joiningDatabase(connection),
      logger: { warn() {} },
      time: { nowMs: () => Date.now() },
      authorize: async () => ({ id: null, username: "integration", permissions: ["supplier.approval"] }),
      loadPermissions: async () => ["supplier.approval"],
      businessMaster: { async assertSupplierDefaultsInTransaction() { return { currency: { code: "HKD", status: "ACTIVE" }, paymentTerm: null }; } }
    });
    const decision = {
      claimedRoles: [], claimedPermissions: ["supplier.approval"],
      id: seeded.requestId, version: 1, reason: "政策關閉後批准原因", requestId: "req-int", ip: "127.0.0.1"
    };
    await assert.rejects(
      () => approvals.approveRequest({ ...decision, actorId: seeded.requesterId }),
      (error) => error.publicCode === "APPROVAL_NOT_ASSIGNED",
      "with the policy off the request still belongs to its assigned approver"
    );

    // 而佢仲批得到：關政策只係停咗**新**提交要審批，唔係廢咗現有嘅隊列。
    const approved = await approvals.approveRequest({ ...decision, actorId: seeded.approverId });
    assert.equal(approved.status, "approved");
    assert.equal(approved.replayed, false);
  } finally {
    await connection.rollback();
  }
});

/**
 * AC-013 嘅另一邊，以及 REV-032 M-3。
 *
 * 呢個測試原本係寫成「設定寫入飛緊時，啟用讀要等」，但個 writer 係測試自己手寫嘅
 * `SELECT … FOR UPDATE`。REV-032 指出咁樣證唔到新嘢：兩個鎖測試唯一掂到嘅 product
 * code 都係 `getActivationPolicy` 嗰三個字，而 S 鎖同 X 鎖唔相容係 MySQL 嘅保證，
 * 唔係應用層行為。實測亦都係咁 —— 拆走 `FOR SHARE` 兩個都紅，而拆走 `updateSettings`
 * 自己嗰個 `FOR UPDATE`，兩個都照綠。
 *
 * 所以個 writer 改成行真嘅 `updateSettings`。咁樣先真係證到 AC-013 講嘅「toggle 側」：
 * 設定寫入攞咗鎖之後，一個並發嘅啟用讀唔可以越過佢攞一個就嚟過期嘅答案。
 */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * 喺 `FOR UPDATE` 讀返嚟之後即刻停低，鎖仲揸住手，未行到 UPDATE。呢個窗口就係
 * 要測嘅嘢：再遲少少，`UPDATE` 自己嗰個 X 鎖會蓋過答案，拆走 `FOR UPDATE` 都睇唔出。
 *
 * 靠 SQL 文字認位係測試 harness 嘅妥協，但佢認嘅就係被測嗰個屬性本身：冇咗
 * `FOR UPDATE`，呢度就唔會停，而個 writer 會一路行完 —— 下面用 race 收呢個情況。
 */
function pausingConnection(connection, { holding, release }) {
  return {
    query: async (sql, params) => {
      const result = await connection.query(sql, params);
      if (String(sql).includes("FOR UPDATE")) {
        holding.resolve();
        await release.promise;
      }
      return result;
    },
    execute: (sql, params) => connection.execute(sql, params)
  };
}

integrationTest("an in-flight settings write blocks a concurrent activation read until it finishes", async (t) => {
  const writer = await mysql.createConnection(config());
  const reader = await mysql.createConnection(config());
  t.after(async () => { await writer.end(); await reader.end(); });

  const [[current]] = await writer.query("SELECT version FROM supplier_settings WHERE id = 1");
  const holding = deferred();
  const release = deferred();

  const service = new SupplierSettingsService({
    database: {
      query: (sql, params) => writer.query(sql, params),
      async withTransaction(work) {
        await writer.beginTransaction();
        try {
          return await work(pausingConnection(writer, { holding, release }));
        } finally {
          // 呢個 suite 唔留低任何改動：service 已經做晒佢要做嘅寫入。
          await writer.rollback();
        }
      }
    },
    logger: { warn() {} },
    time: { nowMs: () => Date.now() },
    authorize: async () => ({ id: null, username: "integration" }),
    audit: { async record() {} }
  });

  const writing = service.updateSettings({
    ...actor, version: Number(current.version), requireActivationApproval: true
  }).then(() => "committed", (error) => error.publicCode ?? error.code ?? error.message);

  // 個 writer 冇攞鎖嘅話，`holding` 永世唔會 resolve，所以同 `writing` 賽跑：嗰種
  // 情況下佢會一路行完，而下面個讀會讀得到 —— 即係測試紅，唔係測試 hang。
  await Promise.race([holding.promise, writing]);

  await reader.query("SET SESSION innodb_lock_wait_timeout = 1");
  await reader.beginTransaction();
  try {
    await assert.rejects(
      () => getActivationPolicy(reader),
      (error) => error.code === "ER_LOCK_WAIT_TIMEOUT",
      "an activation must not read a policy that an in-flight settings write already holds"
    );
  } finally {
    await reader.rollback();
    release.resolve();
    await writing;
  }
});
