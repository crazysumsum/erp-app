import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

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
