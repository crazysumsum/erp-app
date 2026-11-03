/**
 * TASK-013／TC-003／TC-009：Sequence、Operation 同 Audit service 對真 MySQL（設計 §2.5–2.7、§8.1、§12.2）。
 *
 * 全部經真 `MySqlDatabaseService.withTransaction()` 行。Operation、audit 同 sequence 表有 trigger 擋 DELETE，
 * commit 咗嘅測試資料清唔走，所以除咗並發編號一個案例，transaction 最後都 rollback；月份用 2098／2099 年。
 * 並發案例要真 commit 先證明到 FOR UPDATE：佢喺隨機 2100 年之後嘅月份每次留低一行 sequence，斷言只用相對值。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { PurchasingAuditService } from "../../src/modules/purchasing/PurchasingAuditService.js";
import { PurchasingOperationService, purchasingPayloadHash } from "../../src/modules/purchasing/PurchasingOperationService.js";
import { PurchasingSequenceService } from "../../src/modules/purchasing/PurchasingSequenceService.js";
import { RequestContextService } from "../../src/services/context/RequestContextService.js";
import { createMySqlDatabasePool } from "../../src/services/mysqldatabase/connection.js";
import { MySqlDatabaseService } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const ROLLBACK = Symbol("rollback");
const sequences = new PurchasingSequenceService();
const operations = new PurchasingOperationService();
const audit = new PurchasingAuditService({ auditDetailMaxBytes: 8192 });

function database(t) {
  const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), socketPath: process.env.DB_SOCKET_PATH,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 4,
    waitForConnections: true, queueLimit: 10, acquireTimeoutMs: 5000, queryTimeoutMs: 10000, transactionTimeoutMs: 20000,
    abandonedConnectionAction: "destroy" };
  const pool = createMySqlDatabasePool(config);
  t.after(() => pool.end());
  const time = { nowMs: () => Date.now() };
  return new MySqlDatabaseService({ pool, config, context: new RequestContextService({ services: { require: () => time } }),
    logger: { async info() {}, async warn() {}, async error() {} } });
}

/**
 * 做完 work 一定 rollback。`withTransaction()` 會將非 ApplicationError 包成 DATABASE_TRANSACTION_FAILED，
 * 所以 sentinel 同 work 入面嘅 assertion 失敗都喺 `cause`。
 */
async function rolledBack(db, work) {
  await assert.rejects(operations.run(db, async (tx) => { await work(tx); throw ROLLBACK; }), (error) => {
    if (error.cause !== ROLLBACK) throw error.code === "DATABASE_TRANSACTION_FAILED" ? error.cause : error;
    return true;
  });
}

async function user(tx) {
  const now = Date.now(), username = `seq_probe_${randomUUID().slice(0, 12)}`;
  const [row] = await tx.execute("INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, 'synthetic', ?, ?)",
    [username, now, now]);
  return { id: Number(row.insertId), username };
}

const coded = (code) => (error) => { assert.equal(error.code, code, `${error.code}: ${error.message}`); return true; };
const allocate = (tx, documentType, localDate) => sequences.nextNumberInTransaction(tx, { documentType, localDate, nowMs: Date.now() });
const RESULT = { id: 41, number: "PO-209911-000001", status: "DRAFT", version: 1 };
const PAYLOAD = { supplierId: 7, lines: [{ skuId: 3, orderedQuantity: "1.50", unitPrice: "2.0000" }] };

test("payload hash 唔理 key 次序、唔包 password，但包 command 同 decimal 原字串", () => {
  const hash = purchasingPayloadHash("CREATE_PURCHASE_ORDER", PAYLOAD);
  assert.match(hash, /^[0-9a-f]{64}$/u);
  assert.equal(purchasingPayloadHash("CREATE_PURCHASE_ORDER", { lines: [{ unitPrice: "2.0000", orderedQuantity: "1.50", skuId: 3 }], supplierId: 7 }), hash);
  assert.equal(purchasingPayloadHash("CREATE_PURCHASE_ORDER", { ...PAYLOAD, password: "secret" }), hash);
  assert.notEqual(purchasingPayloadHash("UPDATE_PURCHASE_ORDER", PAYLOAD), hash);
  assert.notEqual(purchasingPayloadHash("CREATE_PURCHASE_ORDER", { ...PAYLOAD, lines: [{ ...PAYLOAD.lines[0], orderedQuantity: "1.5" }] }), hash);
  for (const bad of [{ amount: 1.5 }, { at: new Date() }, { id: 2 ** 53 }, { gap: new Array(1) }]) {
    assert.throws(() => purchasingPayloadHash("CREATE_PURCHASE_ORDER", bad), TypeError);
  }
});

test("run() 將 COMMIT 未知同鎖衝突譯成公開錯誤碼，其他錯誤原樣拋出", async () => {
  const failing = (error) => ({ withTransaction: async () => { throw error; } });
  await assert.rejects(operations.run(failing(Object.assign(new Error("x"), { code: "DATABASE_TRANSACTION_INDETERMINATE" })), () => {}),
    coded("TRANSACTION_OUTCOME_UNKNOWN"));
  await assert.rejects(operations.run(failing(Object.assign(new Error("x"), { cause: { code: "ER_LOCK_DEADLOCK" } })), () => {}),
    coded("CONCURRENT_OPERATION"));
  await assert.rejects(operations.run(failing(Object.assign(new Error("x"), { code: "ER_LOCK_WAIT_TIMEOUT" })), () => {}),
    coded("CONCURRENT_OPERATION"));
  const other = new Error("other");
  await assert.rejects(operations.run(failing(other), () => {}), (error) => error === other);
});

integrationTest("PO／GR 編號各自獨立、6 位補零、每月重置", async (t) => {
  await rolledBack(database(t), async (tx) => {
    assert.deepEqual(await allocate(tx, "PO", "2099-11-30"), { number: "PO-209911-000001", yearMonth: "209911", sequenceNo: 1 });
    assert.deepEqual(await allocate(tx, "PO", "2099-11-01"), { number: "PO-209911-000002", yearMonth: "209911", sequenceNo: 2 });
    assert.equal((await allocate(tx, "GR", "2099-11-15")).number, "GR-209911-000001");
    assert.equal((await allocate(tx, "PO", "2099-12-01")).number, "PO-209912-000001");
    assert.equal((await allocate(tx, "PO", "2099-11-02")).number, "PO-209911-000003");
    const [rows] = await tx.query("SELECT document_type, `year_month`, next_value FROM purchasing_document_sequences WHERE `year_month` IN ('209911', '209912') ORDER BY 1, 2");
    assert.deepEqual(rows.map(row => [row.document_type, row.year_month, row.next_value]), [["GR", "209911", 2], ["PO", "209911", 4], ["PO", "209912", 2]]);
    await assert.rejects(allocate(tx, "SO", "2099-11-01"), TypeError);
    await assert.rejects(allocate(tx, "PO", "2099-02-29"), coded("PURCHASING_INPUT_INVALID"));
  });
});

integrationTest("rollback 嘅號碼會再派；同一 transaction 入面唔會重複", async (t) => {
  const db = database(t);
  await rolledBack(db, async (tx) => { assert.equal((await allocate(tx, "PO", "2098-10-05")).number, "PO-209810-000001"); });
  await rolledBack(db, async (tx) => {
    assert.equal((await allocate(tx, "PO", "2098-10-05")).number, "PO-209810-000001");
    assert.equal((await allocate(tx, "PO", "2098-10-05")).number, "PO-209810-000002");
  });
});

integrationTest("snapshot 早過另一個 commit 都唔會重複派號；commit 咗嘅號碼唔再派", async (t) => {
  const db = database(t), localDate = `${2100 + Math.floor(Math.random() * 7900)}-07-15`, yearMonth = localDate.slice(0, 4) + "07";
  const committed = (work) => operations.run(db, work);
  const base = (await committed((tx) => allocate(tx, "PO", localDate))).sequenceNo;
  let snapshotTaken, otherCommitted;
  const taken = new Promise((resolve) => { snapshotTaken = resolve; }), done = new Promise((resolve) => { otherCommitted = resolve; });
  const late = rolledBack(db, async (tx) => {
    // REPEATABLE READ 嘅 snapshot 由第一個普通 SELECT 定；之後另一個 transaction commit 嘅增量要靠 FOR UPDATE 先讀到。
    await tx.query("SELECT next_value FROM purchasing_document_sequences WHERE document_type = 'PO' AND `year_month` = ?", [yearMonth]);
    snapshotTaken();
    await done;
    assert.equal((await allocate(tx, "PO", localDate)).sequenceNo, base + 2);
  });
  await Promise.race([taken, late]);
  assert.equal((await committed((tx) => allocate(tx, "PO", localDate))).sequenceNo, base + 1);
  otherCommitted();
  await late;
  await rolledBack(db, async (tx) => { assert.equal((await allocate(tx, "PO", localDate)).sequenceNo, base + 2); });
});

integrationTest("配完 999999 就 DOCUMENT_SEQUENCE_EXHAUSTED，唔會轉 7 位亦唔會重置", async (t) => {
  await rolledBack(database(t), async (tx) => {
    await tx.execute("INSERT INTO purchasing_document_sequences (document_type, `year_month`, next_value, updated_at) VALUES ('GR', '209809', 999999, 1)");
    assert.deepEqual(await allocate(tx, "GR", "2098-09-30"), { number: "GR-209809-999999", yearMonth: "209809", sequenceNo: 999999 });
    await assert.rejects(allocate(tx, "GR", "2098-09-30"), coded("DOCUMENT_SEQUENCE_EXHAUSTED"));
    await assert.rejects(allocate(tx, "GR", "2098-09-30"), coded("DOCUMENT_SEQUENCE_EXHAUSTED"));
    const [[row]] = await tx.query("SELECT next_value FROM purchasing_document_sequences WHERE document_type = 'GR' AND `year_month` = '209809'");
    assert.equal(row.next_value, 1000000);
  });
});

integrationTest("同 event 同 hash 回原結果；唔同 hash、command 或 actor 一律 PURCHASING_EVENT_CONFLICT", async (t) => {
  await rolledBack(database(t), async (tx) => {
    const actor = await user(tx), other = await user(tx), eventId = randomUUID();
    const input = { commandType: "CREATE_PURCHASE_ORDER", eventId, payload: PAYLOAD, actor, nowMs: 1, requestId: "req-1", correlationId: "cor-1" };
    const first = await operations.claim(tx, input);
    assert.equal(first.replay, null);
    // 未 complete 之前再 claim：只會喺同一個 transaction 發生。
    await assert.rejects(operations.claim(tx, input), coded("CONCURRENT_OPERATION"));
    await operations.complete(tx, { operationId: first.operationId, result: RESULT, nowMs: 2 });
    await assert.rejects(operations.complete(tx, { operationId: first.operationId, result: RESULT, nowMs: 3 }), coded("CONCURRENT_OPERATION"));

    assert.deepEqual(await operations.claim(tx, { ...input, nowMs: 9, requestId: "req-2" }), { operationId: first.operationId, replay: RESULT });
    await assert.rejects(operations.claim(tx, { ...input, payload: { ...PAYLOAD, supplierId: 8 } }), coded("PURCHASING_EVENT_CONFLICT"));
    await assert.rejects(operations.claim(tx, { ...input, commandType: "COPY_PURCHASE_ORDER" }), coded("PURCHASING_EVENT_CONFLICT"));
    await assert.rejects(operations.claim(tx, { ...input, actor: other }), coded("PURCHASING_EVENT_CONFLICT"));

    const [[row]] = await tx.query(`SELECT command_type, source_document_type, source_document_id, source_line_id, request_hash, result_type,
      result_id, result_summary, completed_at, actor_user_id, actor_label, request_id, correlation_id, created_at
      FROM purchasing_operation_requests WHERE id = ?`, [first.operationId]);
    assert.deepEqual({ ...row, actor_user_id: Number(row.actor_user_id), completed_at: Number(row.completed_at), created_at: Number(row.created_at) }, {
      command_type: "CREATE_PURCHASE_ORDER", source_document_type: "PURCHASE_ORDER", source_document_id: "", source_line_id: "",
      request_hash: purchasingPayloadHash("CREATE_PURCHASE_ORDER", PAYLOAD), result_type: "PO", result_id: "41", result_summary: RESULT,
      completed_at: 2, actor_user_id: actor.id, actor_label: actor.username, request_id: "req-1", correlation_id: "cor-1", created_at: 1 });
  });
});

integrationTest("Operation 身份按 source document 分；非法輸入喺寫 DB 之前拒絕", async (t) => {
  await rolledBack(database(t), async (tx) => {
    const actor = await user(tx), eventId = randomUUID();
    const update = { commandType: "UPDATE_PURCHASE_ORDER", eventId, payload: { version: 1 }, actor, nowMs: 1 };
    const one = await operations.claim(tx, { ...update, sourceDocumentId: "41" });
    const two = await operations.claim(tx, { ...update, sourceDocumentId: "42" });
    assert.notEqual(one.operationId, two.operationId);
    for (const bad of [{ commandType: "DELETE_PURCHASE_ORDER" }, { eventId: eventId.toUpperCase() }, { sourceDocumentId: "4 1" },
      { actor: { id: actor.id, username: "a\u0007" } }, { requestId: "x".repeat(65) }]) {
      await assert.rejects(operations.claim(tx, { ...update, sourceDocumentId: "43", ...bad }));
    }
    await assert.rejects(operations.complete(tx, { operationId: one.operationId, result: { ...RESULT, extra: 1 }, nowMs: 2 }), TypeError);
    await assert.rejects(operations.complete(tx, { operationId: one.operationId, result: { ...RESULT, number: "SO-209911-000001" }, nowMs: 2 }), TypeError);
    const [[{ count }]] = await tx.query("SELECT COUNT(*) AS count FROM purchasing_operation_requests WHERE event_id = ?", [eventId]);
    assert.equal(count, 2);
  });
});

integrationTest("Audit 只寫 allowlist action 同欄位，target scope 由 action 決定", async (t) => {
  await rolledBack(database(t), async (tx) => {
    const actor = await user(tx);
    const entry = { actor, action: "purchase_order.copied", targetId: 41, targetLabel: "PO-209911-000001", nowMs: 5,
      detail: { version: 1, lineCount: 2, totalAmount: "12.5000", currencyCode: "HKD", sourcePurchaseOrderId: 40 },
      reason: "  copy for repeat order  ", requestId: "req-1", correlationId: "cor-1", ip: "203.0.113.9" };
    await audit.record(tx, entry);
    const [[row]] = await tx.query(`SELECT actor_user_id, actor_label, action, outcome, target_type, target_id, purchase_order_id,
      goods_receipt_id, target_label, reason, detail, request_id, correlation_id, ip, occurred_at FROM purchasing_audit_logs
      WHERE actor_user_id = ?`, [actor.id]);
    assert.deepEqual({ ...row, actor_user_id: Number(row.actor_user_id), target_id: Number(row.target_id),
      purchase_order_id: Number(row.purchase_order_id), occurred_at: Number(row.occurred_at) }, {
      actor_user_id: actor.id, actor_label: actor.username, action: "purchase_order.copied", outcome: "SUCCEEDED", target_type: "PO",
      target_id: 41, purchase_order_id: 41, goods_receipt_id: null, target_label: "PO-209911-000001", reason: "copy for repeat order",
      detail: entry.detail, request_id: "req-1", correlation_id: "cor-1", ip: "203.0.113.9", occurred_at: 5 });

    for (const bad of [{ action: "purchase_order.deleted" }, { action: "goods_receipt.confirmed" },
      { detail: { ...entry.detail, password: "x" } }, { detail: { ...entry.detail, extra: 5 } },
      { detail: { version: 1, lineCount: 2, totalAmount: "12.5000", currencyCode: "HKD" } }, { detail: { ...entry.detail, totalAmount: 12.5 } },
      { detail: { ...entry.detail, totalAmount: "1.23456" } }, { detail: { ...entry.detail, currencyCode: "hkd" } },
      { detail: { ...entry.detail, lineCount: 101 } }, { targetLabel: "PO\n1" }]) {
      await assert.rejects(audit.record(tx, { ...entry, ...bad }), TypeError);
    }
    await assert.rejects(audit.record(tx, { ...entry, reason: "shrt" }), coded("PURCHASING_INPUT_INVALID"));
    await assert.rejects(new PurchasingAuditService({ auditDetailMaxBytes: 64 }).record(tx, entry), /too large/u);
    const [[{ count }]] = await tx.query("SELECT COUNT(*) AS count FROM purchasing_audit_logs WHERE actor_user_id = ?", [actor.id]);
    assert.equal(count, 1);
  });
});

integrationTest("Audit INSERT 失敗令成個業務 transaction rollback", async (t) => {
  const db = database(t), eventId = randomUUID();
  let username;
  // 唔存在嘅 actor：audit INSERT 撞 users FK，係真 DB 失敗，唔係 service 自己嘅驗證。
  await assert.rejects(operations.run(db, async (tx) => {
    const actor = await user(tx);
    username = actor.username;
    const { number } = await allocate(tx, "PO", "2098-08-08");
    const { operationId } = await operations.claim(tx, { commandType: "CREATE_PURCHASE_ORDER", eventId, payload: PAYLOAD, actor, nowMs: 1 });
    await operations.complete(tx, { operationId, result: { ...RESULT, number }, nowMs: 2 });
    await audit.record(tx, { actor: { id: Number.MAX_SAFE_INTEGER, username: actor.username }, action: "purchase_order.created", targetId: 41,
      targetLabel: number, nowMs: 3, detail: { version: 1, lineCount: 1, totalAmount: "3.0000", currencyCode: "HKD" } });
  }), (error) => { assert.equal(error.cause?.code ?? error.code, "ER_NO_REFERENCED_ROW_2"); return true; });

  await rolledBack(db, async (tx) => {
    const [[state]] = await tx.query(`SELECT
      (SELECT COUNT(*) FROM purchasing_document_sequences WHERE \`year_month\` = '209808') AS sequences,
      (SELECT COUNT(*) FROM purchasing_operation_requests WHERE event_id = ?) AS operations,
      (SELECT COUNT(*) FROM users WHERE username = ?) AS users`, [eventId, username]);
    assert.deepEqual({ ...state }, { sequences: 0, operations: 0, users: 0 });
    assert.equal((await allocate(tx, "PO", "2098-08-08")).number, "PO-209808-000001");
  });
});
