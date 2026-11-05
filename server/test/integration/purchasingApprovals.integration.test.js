/**
 * TASK-022／TC-004、TC-009：審批同狀態歷史嘅表、trigger 同 service 對真 MySQL（設計 §3.3、§4.7、§4.8、§4.16、§8.3）。
 * 每個案例喺外層 transaction 入面做，最後 rollback。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";

import { APPROVAL_TRIGGERS, up as createApprovals } from "../../database/migrations/0117_create_purchase_order_approvals.js";
import { STATUS_HISTORY_TRIGGERS, up as createHistory } from "../../database/migrations/0118_create_purchase_order_status_history.js";
import { PurchaseApprovalService, approvalSnapshotHash } from "../../src/modules/purchasing/PurchaseApprovalService.js";
import { PurchasingAuditService } from "../../src/modules/purchasing/PurchasingAuditService.js";
import { PurchasingOperationService } from "../../src/modules/purchasing/PurchasingOperationService.js";
import { PurchasingSettingsService } from "../../src/modules/purchasing/PurchasingSettingsService.js";
import { appendStatusHistory } from "../../src/modules/purchasing/purchaseOrderStatusHistory.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const NOW = Date.UTC(2099, 10, 15, 4), HASH = "a".repeat(64);
const silent = { async info() {}, async warn() {}, async debug() {}, async error() {} };
const service = new PurchaseApprovalService();

async function connect(t) {
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), socketPath: process.env.DB_SOCKET_PATH,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  t.after(() => db.end());
  return db;
}
async function inRollback(db, work) {
  await db.query("START TRANSACTION");
  try { return await work(); } finally { await db.query("ROLLBACK"); }
}
/** 斷言 DB 錯誤碼；CHECK 仲要對埋約束名，證明擋住嘅係預期嗰條。 */
const dbRejects = (promise, code, constraint) => assert.rejects(promise, (error) => {
  assert.equal(error.code, code, `${error.code}: ${error.message}`);
  if (constraint) assert.match(error.message, new RegExp(`'${constraint}'`, "u"));
  return true;
});
const coded = (code) => (error) => { assert.equal(error.code, code, `${error.code}: ${error.message}`); return true; };

async function fixture(db) {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const insert = async (table, row) => Number((await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
  const user = async (suffix, permissions) => {
    const id = await insert("users", { username: `apr_${suffix}_${tag}`, password_hash: "synthetic", display_name: `User ${suffix}`, created_at: NOW, updated_at: NOW });
    const name = `apr_${suffix}_${tag}`, role = await insert("roles", { name, created_at: NOW });
    for (const permission of permissions) await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [role, permission]);
    await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [id, role]);
    return { id, username: name, claims: { sub: String(id), roles: [name], permissions } };
  };
  const maker = await user("maker", ["purchasing.view", "purchasing.mgmt"]), approver = await user("approver", ["purchasing.view", "purchasing.approval"]);
  const other = await user("other", ["purchasing.view", "purchasing.approval"]), plain = await user("plain", ["purchasing.view"]), admin = await user("admin", ["purchasing.settings"]);
  const supplier = await insert("suppliers", { supplier_code: `APR-${tag}`, supplier_code_key: `apr-${tag}`, supplier_name: "Name", supplier_name_key: "name", default_currency_code: "HKD", status: "active", created_at: NOW, updated_at: NOW });
  const item = await insert("items", { name: `Item${tag}`, status: "active", created_at: NOW, updated_at: NOW });
  const uom = await insert("item_uoms", { code: `A${tag}`, name: "Each", created_at: NOW, updated_at: NOW });
  const sku = await insert("item_skus", { item_id: item, sku_code: `SKU${tag}`, sku_name: "Goods", status: "active", created_at: NOW, updated_at: NOW });
  const mapping = await insert("item_sku_uoms", { sku_id: sku, uom_id: uom, to_base_factor: 1, is_base: 1, created_at: NOW, updated_at: NOW });
  let sequence = 100000 + Math.floor(Math.random() * 800000);
  const order = async (status = "PENDING_APPROVAL", version = 2) => {
    sequence += 1;
    const id = await insert("purchase_orders", { po_number: `PO-209911-${String(sequence).padStart(6, "0")}`, document_year_month: "209911", sequence_no: sequence, supplier_id: supplier,
      supplier_code_snapshot: "S", supplier_name_snapshot: "Name", currency_code: "HKD", currency_name_snapshot: "HK Dollar", currency_decimal_places_snapshot: 2, order_date: "2099-11-01",
      buyer_id: maker.id, buyer_label: "Buyer", total_amount: "1.00", subtotal_amount: "1.00", version, created_at: NOW, updated_at: NOW, created_by: maker.id, created_by_label: "maker", updated_by: maker.id, updated_by_label: "maker" });
    await insert("purchase_order_lines", { purchase_order_id: id, line_number: 1, sku_id: sku, sku_code_snapshot: "SKU", sku_name_snapshot: "Goods", tracking_policy_snapshot: "none", inventory_tracked_snapshot: 1,
      base_uom_id: uom, base_uom_code_snapshot: "EA", purchase_sku_uom_id: mapping, purchase_uom_code_snapshot: "EA", uom_to_base_factor_snapshot: 1, ordered_quantity: "1.000000", ordered_base_quantity: 1,
      unit_price: "1.0000", line_amount: "1.00", created_at: NOW, updated_at: NOW });
    if (status !== "DRAFT") await db.query("UPDATE purchase_orders SET status = ? WHERE id = ?", [status, id]);
    return id;
  };
  const approvalRow = (purchaseOrderId, overrides = {}) => ({ purchase_order_id: purchaseOrderId, purchase_order_version: 2, settings_version: 1, requested_by: maker.id, assigned_approver_id: approver.id,
    requested_by_label: "maker", approver_label: "approver", approval_snapshot: "{}", snapshot_hash: HASH, requested_at: NOW, ...overrides });
  const request = (purchaseOrderId) => service.requestInTransaction(db, { purchaseOrderId, version: 2, settingsVersion: 1, actor: maker, approverId: approver.id, nowMs: NOW });
  return { maker, approver, other, plain, admin, order, approvalRow, request, insert };
}
const historyRow = (purchaseOrderId, overrides = {}) => ({ purchase_order_id: purchaseOrderId, sequence_no: 1, to_status: "DRAFT", action: "CREATE", purchase_order_version_after: 1,
  event_id: randomUUID(), actor_label: "maker", occurred_at: NOW, ...overrides });

integrationTest("TASK-022 兩張表嘅 migration 可以重跑，trigger 齊晒", async (t) => {
  const db = await connect(t);
  await createApprovals(db);
  await createHistory(db);
  const [rows] = await db.query("SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND event_object_table IN ('purchase_order_approvals', 'purchase_order_status_history')");
  assert.deepEqual(rows.map(({ name }) => name).sort(), [...Object.keys(APPROVAL_TRIGGERS), ...Object.keys(STATUS_HISTORY_TRIGGERS)].sort());
});

integrationTest("TASK-022 每張 PO 最多一個待審批；決定之後可以再提交", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db), po = await f.order(), id = await f.insert("purchase_order_approvals", f.approvalRow(po));
    await dbRejects(db.query("INSERT INTO purchase_order_approvals SET ?", [f.approvalRow(po)]), "ER_DUP_ENTRY");
    await db.query("UPDATE purchase_order_approvals SET status = 'WITHDRAWN', decided_at = ?, version = 2 WHERE id = ?", [NOW, id]);
    await f.insert("purchase_order_approvals", f.approvalRow(po));
  });
});

integrationTest("TASK-022 CHECK：狀態、決定時間、拒絕原因、hash 同快照大小", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db), po = await f.order(), id = await f.insert("purchase_order_approvals", f.approvalRow(po));
    const decide = (values) => db.query("UPDATE purchase_order_approvals SET ?, version = 2 WHERE id = ?", [values, id]);
    await dbRejects(decide({ status: "OTHER", decided_at: NOW }), "ER_CHECK_CONSTRAINT_VIOLATED", "chk_po_approvals_status");
    await dbRejects(decide({ status: "APPROVED" }), "ER_CHECK_CONSTRAINT_VIOLATED", "chk_po_approvals_decided");
    await dbRejects(decide({ status: "REJECTED", decided_at: NOW }), "ER_CHECK_CONSTRAINT_VIOLATED", "chk_po_approvals_reject_reason");
    const other = await f.order();
    await dbRejects(db.query("INSERT INTO purchase_order_approvals SET ?", [f.approvalRow(other, { snapshot_hash: "x".repeat(64) })]), "ER_CHECK_CONSTRAINT_VIOLATED", "chk_po_approvals_hash");
    await dbRejects(db.query("INSERT INTO purchase_order_approvals SET ?", [f.approvalRow(other, { approval_snapshot: JSON.stringify({ text: "x".repeat(1024 * 1024) }) })]), "ER_CHECK_CONSTRAINT_VIOLATED", "chk_po_approvals_snapshot_size");
    await f.insert("purchase_order_approvals", f.approvalRow(other, { approval_snapshot: JSON.stringify({ text: "x".repeat(900 * 1024) }) }));
  });
});

integrationTest("TASK-022 trigger：只可以 PENDING 開始、提交資料不可改、已決定凍結、唔准刪", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db), po = await f.order();
    for (const overrides of [{ status: "APPROVED" }, { status: "APPROVED", decided_at: NOW }, { decided_by: f.approver.id }, { decision_reason: "早已決定" }, { version: 2 }]) {
      await dbRejects(db.query("INSERT INTO purchase_order_approvals SET ?", [f.approvalRow(po, overrides)]), "ER_SIGNAL_EXCEPTION");
    }
    const id = await f.insert("purchase_order_approvals", f.approvalRow(po));
    const decided = { status: "APPROVED", decided_at: NOW, decided_by: f.approver.id, version: 2 };
    for (const change of [{ approval_snapshot: '{"a":1}' }, { snapshot_hash: "b".repeat(64) }, { purchase_order_version: 3 }, { settings_version: 2 }, { requested_by: f.other.id }, { assigned_approver_id: f.other.id },
      { requested_by_label: "x" }, { approver_label: "x" }, { request_note: "x" }, { requested_at: 1 }]) {
      await dbRejects(db.query("UPDATE purchase_order_approvals SET ? WHERE id = ?", [{ ...decided, ...change }, id]), "ER_SIGNAL_EXCEPTION");
    }
    await dbRejects(db.query("UPDATE purchase_order_approvals SET decision_reason = 'x', version = 2 WHERE id = ?", [id]), "ER_SIGNAL_EXCEPTION");
    await dbRejects(db.query("UPDATE purchase_order_approvals SET ? WHERE id = ?", [{ ...decided, version: 1 }, id]), "ER_SIGNAL_EXCEPTION");
    await dbRejects(db.query("DELETE FROM purchase_order_approvals WHERE id = ?", [id]), "ER_SIGNAL_EXCEPTION");
    await db.query("UPDATE purchase_order_approvals SET ? WHERE id = ?", [decided, id]);
    await dbRejects(db.query("UPDATE purchase_order_approvals SET decision_reason = 'x', version = 3 WHERE id = ?", [id]), "ER_SIGNAL_EXCEPTION");
    await dbRejects(db.query("UPDATE purchase_order_approvals SET status = 'REJECTED', decision_reason = '改主意了', version = 3 WHERE id = ?", [id]), "ER_SIGNAL_EXCEPTION");
    await dbRejects(db.query("DELETE FROM purchase_order_approvals WHERE id = ?", [id]), "ER_SIGNAL_EXCEPTION");
  });
});

integrationTest("TASK-022 刪 user 只清 FK，姓名快照留低；有審批嘅 PO 刪唔到", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db), po = await f.order(), id = await f.insert("purchase_order_approvals", f.approvalRow(po, { assigned_approver_id: f.other.id, approver_label: "other" }));
    await db.query("DELETE FROM user_roles WHERE user_id = ?", [f.other.id]);
    await db.query("DELETE FROM users WHERE id = ?", [f.other.id]);
    const [[row]] = await db.query("SELECT assigned_approver_id, approver_label FROM purchase_order_approvals WHERE id = ?", [id]);
    assert.deepEqual([row.assigned_approver_id, row.approver_label], [null, "other"]);
    await db.query("UPDATE purchase_orders SET status = 'DRAFT' WHERE id = ?", [po]);
    await db.query("DELETE FROM purchase_order_lines WHERE purchase_order_id = ?", [po]);
    await dbRejects(db.query("DELETE FROM purchase_orders WHERE id = ?", [po]), "ER_ROW_IS_REFERENCED_2");
  });
});

integrationTest("TASK-022 狀態歷史只可以新增，順序唯一，值受 CHECK 限制", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db), po = await f.order("DRAFT", 1);
    const event = randomUUID();
    await appendStatusHistory(db, { purchaseOrderId: po, fromStatus: "", toStatus: "DRAFT", action: "CREATE", version: 1, eventId: event, actor: f.maker, nowMs: NOW });
    await appendStatusHistory(db, { purchaseOrderId: po, fromStatus: "DRAFT", toStatus: "CONFIRMED", action: "CONFIRM", version: 2, eventId: randomUUID(), actor: f.maker, nowMs: NOW + 1 });
    const [rows] = await db.query("SELECT sequence_no, from_status, to_status, action, actor_user_id, actor_label, purchase_order_version_after, event_id FROM purchase_order_status_history WHERE purchase_order_id = ? ORDER BY sequence_no", [po]);
    assert.deepEqual(rows.map((row) => Number(row.sequence_no)), [1, 2]);
    assert.deepEqual([rows[0].from_status, rows[0].to_status, rows[0].action, Number(rows[0].actor_user_id), rows[0].actor_label, Number(rows[0].purchase_order_version_after), rows[0].event_id], ["", "DRAFT", "CREATE", f.maker.id, f.maker.username, 1, event]);
    assert.deepEqual([rows[1].from_status, rows[1].to_status], ["DRAFT", "CONFIRMED"]);
    await dbRejects(db.query("INSERT INTO purchase_order_status_history SET ?", [historyRow(po, { sequence_no: 2 })]), "ER_DUP_ENTRY");
    await dbRejects(db.query("INSERT INTO purchase_order_status_history SET ?", [historyRow(po, { sequence_no: 3, action: "OTHER" })]), "ER_CHECK_CONSTRAINT_VIOLATED", "chk_po_status_history_action");
    await dbRejects(db.query("INSERT INTO purchase_order_status_history SET ?", [historyRow(po, { sequence_no: 3, to_status: "OTHER" })]), "ER_CHECK_CONSTRAINT_VIOLATED", "chk_po_status_history_to");
    await dbRejects(db.query("INSERT INTO purchase_order_status_history SET ?", [historyRow(po, { sequence_no: 3, from_status: "OTHER" })]), "ER_CHECK_CONSTRAINT_VIOLATED", "chk_po_status_history_from");
    await dbRejects(db.query("UPDATE purchase_order_status_history SET reason = 'x' WHERE purchase_order_id = ?", [po]), "ER_SIGNAL_EXCEPTION");
    await dbRejects(db.query("DELETE FROM purchase_order_status_history WHERE purchase_order_id = ?", [po]), "ER_SIGNAL_EXCEPTION");
  });
});

integrationTest("TASK-022 提交審批：保存版本、快照同 hash；審批人要係另一名 Active 兼有權限", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db), po = await f.order();
    const submit = (approverId) => service.requestInTransaction(db, { purchaseOrderId: po, version: 2, settingsVersion: 7, actor: f.maker, approverId, note: "請批", nowMs: NOW });
    await assert.rejects(submit(f.maker.id), coded("PO_APPROVER_INVALID"));
    await assert.rejects(submit(f.plain.id), coded("PO_APPROVER_INVALID"));
    await assert.rejects(submit(99999999), coded("PO_APPROVER_INVALID"));
    await db.query("UPDATE users SET status = 'inactive' WHERE id = ?", [f.other.id]);
    await assert.rejects(submit(f.other.id), coded("PO_APPROVER_INVALID"));
    const result = await submit(f.approver.id);
    assert.deepEqual([result.approverId, result.approverLabel], [f.approver.id, "User approver"]);
    const [[row]] = await db.query("SELECT * FROM purchase_order_approvals WHERE id = ?", [result.id]);
    const snapshot = typeof row.approval_snapshot === "string" ? JSON.parse(row.approval_snapshot) : row.approval_snapshot;
    assert.deepEqual([Number(row.purchase_order_version), Number(row.settings_version), row.status, row.request_note, Number(row.requested_by), row.requested_by_label], [2, 7, "PENDING", "請批", f.maker.id, f.maker.username]);
    assert.equal(row.snapshot_hash, approvalSnapshotHash(snapshot));
    assert.equal(snapshot.lines.length, 1);
    await assert.rejects(submit(f.approver.id), (error) => (error.cause?.code ?? error.code) === "ER_DUP_ENTRY");
  });
});

integrationTest("TASK-022 批准同拒絕：只有指定審批人，自己唔批得，舊版本唔批得", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db), po = await f.order();
    const { id } = await f.request(po);
    const approve = (actor, version = 2) => service.approveInTransaction(db, { purchaseOrderId: po, version, actor, nowMs: NOW + 1 });
    await assert.rejects(approve(f.maker), coded("SELF_APPROVAL_DENIED"));
    await assert.rejects(approve(f.other), coded("APPROVAL_ASSIGNEE_MISMATCH"));
    await assert.rejects(approve(f.approver, 1), coded("VERSION_CONFLICT"));
    await assert.rejects(service.rejectInTransaction(db, { purchaseOrderId: po, version: 2, actor: f.other, reason: "唔應該由我拒絕", nowMs: NOW }), coded("APPROVAL_ASSIGNEE_MISMATCH"));
    assert.deepEqual(await approve(f.approver), { id, status: "APPROVED" });
    const [[row]] = await db.query("SELECT status, decided_at, decided_by, version FROM purchase_order_approvals WHERE id = ?", [id]);
    assert.deepEqual([row.status, Number(row.decided_at), Number(row.decided_by), Number(row.version)], ["APPROVED", NOW + 1, f.approver.id, 2]);
    await assert.rejects(approve(f.approver), coded("PO_STATE_CONFLICT"));

    const second = await f.order(), { id: rejectId } = await f.request(second);
    assert.deepEqual(await service.rejectInTransaction(db, { purchaseOrderId: second, version: 2, actor: f.approver, reason: "價錢要再傾", nowMs: NOW }), { id: rejectId, status: "REJECTED" });
    const [[rejected]] = await db.query("SELECT decision_reason FROM purchase_order_approvals WHERE id = ?", [rejectId]);
    assert.equal(rejected.decision_reason, "價錢要再傾");
  });
});

integrationTest("TASK-022 批准前人員失效：保留 PENDING，要撤回再提交", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db), po = await f.order(), { id } = await f.request(po);
    const approve = () => service.approveInTransaction(db, { purchaseOrderId: po, version: 2, actor: f.approver, nowMs: NOW });
    await db.query("UPDATE users SET status = 'inactive' WHERE id = ?", [f.maker.id]);
    await assert.rejects(approve(), coded("PO_APPROVER_INVALID"));
    await db.query("UPDATE users SET status = 'active' WHERE id = ?", [f.maker.id]);
    await db.query("DELETE FROM user_roles WHERE user_id = ?", [f.approver.id]);
    await assert.rejects(approve(), coded("PO_APPROVER_INVALID"));
    const [[row]] = await db.query("SELECT status FROM purchase_order_approvals WHERE id = ?", [id]);
    assert.equal(row.status, "PENDING");
    assert.deepEqual(await service.withdrawInTransaction(db, { purchaseOrderId: po, actor: f.maker, nowMs: NOW }), { id, status: "WITHDRAWN" });
  });
});

integrationTest("TASK-022 PO 內容同快照分開就唔批得", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db), po = await f.order("DRAFT", 2);
    await f.request(po);
    await db.query("UPDATE purchase_orders SET notes = '提交之後先改' WHERE id = ?", [po]);
    await assert.rejects(service.approveInTransaction(db, { purchaseOrderId: po, version: 2, actor: f.approver, nowMs: NOW }), coded("PO_STATE_CONFLICT"));
  });
});

integrationTest("TASK-022 撤回只限提交人；取消 PO 令申請失效；冇待審批就衝突", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db), po = await f.order(), { id } = await f.request(po);
    await assert.rejects(service.withdrawInTransaction(db, { purchaseOrderId: po, actor: f.approver, nowMs: NOW }), coded("APPROVAL_ASSIGNEE_MISMATCH"));
    assert.deepEqual(await service.invalidateInTransaction(db, { purchaseOrderId: po, actor: f.maker, reason: "唔再需要呢張單", nowMs: NOW }), { id, status: "INVALIDATED" });
    await assert.rejects(service.withdrawInTransaction(db, { purchaseOrderId: po, actor: f.maker, nowMs: NOW }), coded("PO_STATE_CONFLICT"));
    await assert.rejects(service.approveInTransaction(db, { purchaseOrderId: po, version: 2, actor: f.approver, nowMs: NOW }), coded("PO_STATE_CONFLICT"));
  });
});

integrationTest("TASK-022 設定：預設關、要權限、版本 CAS、replay、Audit，唔改任何 PO", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db), po = await f.order();
    await db.query("UPDATE purchasing_settings SET require_po_approval = 0, version = 5 WHERE id = 1");
    const database = { query: (...args) => db.query(...args), withTransaction: (work) => work(db) };
    const settings = new PurchasingSettingsService({ database, logger: silent, time: { nowMs: () => NOW }, operations: new PurchasingOperationService(), audit: new PurchasingAuditService({ auditDetailMaxBytes: 8192 }) });
    assert.equal((await settings.get({ claims: f.admin.claims })).requirePoApproval, false);
    await assert.rejects(settings.get({ claims: f.maker.claims }), coded("PERMISSION_STALE"));

    const input = { eventId: randomUUID(), version: 5, requirePoApproval: true, reason: "開始需要審批" };
    await assert.rejects(settings.update({ claims: f.maker.claims, input }), coded("PERMISSION_STALE"));
    await assert.rejects(settings.update({ claims: f.admin.claims, input: { ...input, eventId: randomUUID(), version: 4 } }), coded("VERSION_CONFLICT"));
    assert.deepEqual(await settings.update({ claims: f.admin.claims, input }), { requirePoApproval: true, version: 6, replayed: false });
    assert.deepEqual(await settings.update({ claims: f.admin.claims, input }), { requirePoApproval: true, version: 6, replayed: true });
    await assert.rejects(settings.update({ claims: f.admin.claims, input: { ...input, requirePoApproval: false } }), coded("PURCHASING_EVENT_CONFLICT"));

    const current = await settings.get({ claims: f.admin.claims });
    assert.deepEqual([current.requirePoApproval, current.version, current.updatedAt, current.updatedByLabel], [true, 6, NOW, f.admin.username]);
    const [audits] = await db.query("SELECT action, outcome, target_type, target_id, purchase_order_id, reason, detail FROM purchasing_audit_logs WHERE actor_user_id = ? AND outcome = 'SUCCEEDED'", [f.admin.id]);
    assert.equal(audits.length, 1);
    assert.deepEqual([audits[0].action, audits[0].target_type, Number(audits[0].target_id), audits[0].purchase_order_id, audits[0].reason], ["purchasing.setting.updated", "SETTING", 1, null, input.reason]);
    const [[operation]] = await db.query("SELECT result_type, result_id, source_document_type FROM purchasing_operation_requests WHERE event_id = ?", [input.eventId]);
    assert.deepEqual([operation.result_type, operation.result_id, operation.source_document_type], ["SETTING", "1", "SETTING"]);
    const [[refused]] = await db.query("SELECT target_type, target_id, purchase_order_id FROM purchasing_audit_logs WHERE actor_user_id = ? AND outcome = 'REJECTED' AND action = 'purchasing.setting.updated' ORDER BY id LIMIT 1", [f.admin.id]);
    assert.deepEqual([refused.target_type, Number(refused.target_id), refused.purchase_order_id], ["SETTING", 1, null]);
    const [[unchanged]] = await db.query("SELECT status, version FROM purchase_orders WHERE id = ?", [po]);
    assert.deepEqual([unchanged.status, Number(unchanged.version)], ["PENDING_APPROVAL", 2]);
  });
});
