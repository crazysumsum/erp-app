/**
 * TASK-025／TC-004：PO lifecycle 經真 HTTP、真 JWT 同真 MySQL（§3.2、§5.2、§8.4）。Sam 2026-11-09 批准 C4：I1～I4 嘅「而家」版本，
 * 全檔 6 張 PO、9 行、12 個 lifecycle POST 加 3 個 GET；fixture 唔經 HTTP。
 * TASK-045（Sam 2026-11-12 call_cb2041d1，提案 3e97d261）：reader 接好之後，撤回同取消由 goods_receipts 嘅權威事實決定；
 * I1、I2 由 503 改寫成成功路徑，另加 G6 同兩個 GR 案。GR 用 SQL 直接寫（0119 冇 INSERT trigger）；每案最多 6 張 PO、5 列 GR。
 * 呢度唔驗並發。
 * Fixture（全檔共用一次）：
 * - 2 名用戶：maker（view＋mgmt）、viewer（view＋approval，兼做 pending 嘅指定審批人）。
 * - PO 同 Line 用 SQL 直接寫（gross = net + reversed；表頭金額 = 每行 2.5 × 行數）。
 * - Pending approval 用真 PurchaseApprovalService 喺 transaction 入面建立，快照同 hash 都有效。
 * 完咗刪走用戶、角色同 token version，關 application；PO 同主檔留喺私人 DB，隨 DB 一齊棄置。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { GoodsReceiptFacts } from "../../src/modules/purchasing/GoodsReceiptFacts.js";
import { PurchaseApprovalService } from "../../src/modules/purchasing/PurchaseApprovalService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const REASON = "生命週期測試原因", MONTH = "209810";
let shared = null;

/** 倒序逐個試一次已登記嘅清理（最先登記嘅 application.shutdown 一定最後試到），任何一步失敗都照試其餘，回傳全部錯誤。 */
async function runCleanups(cleanups) {
  const errors = [];
  for (const cleanup of [...cleanups].reverse()) {
    try { await cleanup(); } catch (error) { errors.push(error); }
  }
  return errors;
}

async function setup() {
  const cleanups = [];
  const source = defaultConfigurationSource();
  const application = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 } } });
  cleanups.push(() => application.shutdown("purchasing_lifecycle_integration_complete"));
  try {
    const db = application.services.require("mysqldatabase"), jwt = application.services.require("jwt");
    const tag = randomUUID().replaceAll("-", "").slice(0, 12), now = Date.now();
    const insert = async (table, row) => Number((await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
    const person = async (suffix, permissions) => {
      const name = `po_life_${suffix}_${tag}`, role = await insert("roles", { name, created_at: now });
      cleanups.push(() => db.query("DELETE FROM roles WHERE id = ?", [role]), () => db.query("DELETE FROM role_permissions WHERE role_id = ?", [role]));
      for (const permission of permissions) await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [role, permission]);
      const id = await insert("users", { username: name, password_hash: "synthetic", display_name: `User ${suffix}`, created_at: now, updated_at: now });
      cleanups.push(() => db.query("DELETE FROM users WHERE id = ?", [id]), () => db.query("DELETE FROM fr_token_versions WHERE subject = ?", [String(id)]),
        () => db.query("DELETE FROM user_roles WHERE user_id = ?", [id]));
      await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [id, role]);
      const version = await application.services.require("tokenRevocation").currentVersion(String(id));
      return { id, username: name, token: await jwt.issue({ roles: [name], permissions }, { subject: String(id), version, authTime: Math.floor(now / 1000) }) };
    };
    const maker = await person("maker", ["purchasing.view", "purchasing.mgmt"]), viewer = await person("viewer", ["purchasing.view", "purchasing.approval"]);
    const supplier = await insert("suppliers", { supplier_code: `PLC-${tag}`, supplier_code_key: `plc-${tag}`, supplier_name: "Lifecycle Supplier", supplier_name_key: "lifecycle supplier",
      default_currency_code: "HKD", status: "active", created_at: now, updated_at: now });
    const item = await insert("items", { name: `Life ${tag}`, status: "active", created_at: now, updated_at: now });
    const uom = await insert("item_uoms", { code: `L${tag}`, name: "Each", created_at: now, updated_at: now });
    const sku = await insert("item_skus", { item_id: item, sku_code: `PLC-${tag}`, sku_name: "Lifecycle SKU", status: "active", created_at: now, updated_at: now });
    const skuUom = await insert("item_sku_uoms", { sku_id: sku, uom_id: uom, to_base_factor: 1, is_base: 1, created_at: now, updated_at: now });
    /** SQL fixture：每行訂 2（factor 1），received 係每行 net；最後先改表頭狀態，因為 Line trigger 喺表頭離開 DRAFT 之後唔准加行。 */
    const order = async (status, received) => {
      const [[{ next }]] = await db.query("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next FROM purchase_orders WHERE document_year_month = ?", [MONTH]);
      const id = await insert("purchase_orders", { po_number: `PO-${MONTH}-${String(next).padStart(6, "0")}`, document_year_month: MONTH, sequence_no: Number(next), supplier_id: supplier,
        supplier_code_snapshot: `PLC-${tag}`, supplier_name_snapshot: "Lifecycle Supplier", currency_code: "HKD", currency_name_snapshot: "HK Dollar", currency_decimal_places_snapshot: 2,
        order_date: "2098-10-01", buyer_id: maker.id, buyer_label: "Buyer", total_amount: (2.5 * received.length).toFixed(4), subtotal_amount: (2.5 * received.length).toFixed(4), created_at: now, updated_at: now,
        created_by: maker.id, created_by_label: "maker", updated_by: maker.id, updated_by_label: "maker" });
      for (const [index, net] of received.entries()) {
        await insert("purchase_order_lines", { purchase_order_id: id, line_number: index + 1, sku_id: sku, sku_code_snapshot: `PLC-${tag}`, sku_name_snapshot: "Lifecycle SKU",
          tracking_policy_snapshot: "none", inventory_tracked_snapshot: 1, base_uom_id: uom, base_uom_code_snapshot: "EA", purchase_sku_uom_id: skuUom, purchase_uom_code_snapshot: "EA",
          uom_to_base_factor_snapshot: 1, ordered_quantity: "2", ordered_base_quantity: 2, unit_price: "1.2500", line_amount: "2.5000", gross_received_base_quantity: net,
          net_received_base_quantity: net, has_outstanding: net >= 2 ? 0 : 1, created_at: now, updated_at: now });
      }
      if (status !== "DRAFT") {
        await db.query("UPDATE purchase_orders SET status = ?, confirmed_at = ?, has_confirmed_receipt = ? WHERE id = ?",
          [status, status === "PENDING_APPROVAL" ? null : now, received.some((net) => net > 0) ? 1 : 0, id]);
      }
      const [lines] = await db.query("SELECT id FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number", [id]);
      return { id, lines: lines.map((row) => Number(row.id)) };
    };
    /** 真 PurchaseApprovalService 建立有效 pending approval（快照、hash、指定審批人有 purchasing.approval），之後先轉 PENDING_APPROVAL。 */
    const pendingOrder = async () => {
      const po = await order("DRAFT", [0]);
      const [[settings]] = await db.query("SELECT version FROM purchasing_settings WHERE id = 1");
      await db.withTransaction((tx) => new PurchaseApprovalService().requestInTransaction(tx, { purchaseOrderId: po.id, version: 1, settingsVersion: Number(settings.version),
        actor: { id: maker.id, username: maker.username }, approverId: viewer.id, nowMs: now }));
      await db.query("UPDATE purchase_orders SET status = 'PENDING_APPROVAL' WHERE id = ?", [po.id]);
      return po;
    };
    const { url } = await application.start();
    const send = async (path, { token, body, method = "POST", key = body?.eventId }) => {
      const response = await fetch(`${url}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { "Idempotency-Key": key } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    const command = (id, action, token, fields, eventId = randomUUID()) => send(`/api/v1/purchase-orders/${id}/${action}`, { token, body: { eventId, ...fields } });
    const read = async (id) => (await send(`/api/v1/purchase-orders/${id}`, { token: maker.token, method: "GET" })).body.data;
    const historyCount = async (id) => Number((await db.query("SELECT COUNT(*) AS total FROM purchase_order_status_history WHERE purchase_order_id = ?", [id]))[0][0].total);
    const succeeded = async (id, action) => Number((await db.query("SELECT COUNT(*) AS total FROM purchasing_audit_logs WHERE purchase_order_id = ? AND action = ? AND outcome = 'SUCCEEDED'",
      [id, action]))[0][0].total);
    /** 0119 header 一列：DRAFT／CANCELLED 冇確認證據，其餘一定有 confirmed_at 同 confirm_event_id（chk_gr_confirmation）。 */
    const receipt = async (poId, status, extra = {}) => {
      const [[{ next }]] = await db.query("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next FROM goods_receipts WHERE document_year_month = ?", [MONTH]);
      const confirmed = !["DRAFT", "CANCELLED"].includes(status);
      return insert("goods_receipts", { gr_number: `GR-${MONTH}-${String(next).padStart(6, "0")}`, document_year_month: MONTH, sequence_no: Number(next),
        purchase_order_id: poId, supplier_id: supplier, supplier_code_snapshot: `PLC-${tag}`, supplier_name_snapshot: "Lifecycle Supplier",
        business_receipt_date: "2098-10-02", status, total_received_base_quantity: confirmed ? 2 : 0, total_reversed_base_quantity: status === "REVERSED" ? 2 : 0,
        created_at: now, updated_at: now, created_by: maker.id, updated_by: maker.id, created_by_label: "maker", updated_by_label: "maker",
        ...(confirmed ? { confirmed_at: now, confirmed_by: maker.id, confirm_event_id: randomUUID() } : {}),
        ...(status === "CANCELLED" ? { cancelled_at: now, cancelled_by: maker.id } : {}), ...extra });
    };
    return { db, cleanups, command, read, order, pendingOrder, receipt, historyCount, succeeded, maker, viewer, insert, now };
  } catch (error) {
    const cleanupErrors = await runCleanups(cleanups);
    throw cleanupErrors.length ? new AggregateError([error, ...cleanupErrors], "Lifecycle fixture setup failed and its cleanup also failed") : error;
  }
}
// 全檔只建一次（同一個 application／pool）；setup 失敗都喺 setup 入面清走已建立嘅嘢。
const fixture = () => (shared ??= setup());
after(async () => {
  if (!shared) return;
  let state;
  try { state = await shared; } catch { return; } // setup 失敗：已經喺 setup 入面清理過，錯誤亦已經由呼叫嘅 case 報告。
  const errors = await runCleanups(state.cleanups);
  if (errors.length) throw new AggregateError(errors, "Lifecycle fixture cleanup failed");
});
const failure = (result) => [result.status, result.body.error?.code];

integrationTest("TASK-025 I1 撤回確認：從未有 GR 就成功，PO 回 DRAFT，寫一行 history 同 Audit", async () => {
  const f = await fixture();
  const po = await f.order("CONFIRMED", [0]);
  const before = await f.historyCount(po.id);
  assert.deepEqual((await f.read(po.id)).allowedActions, ["copy", "cancel", "withdrawConfirmation"]);
  const withdrawn = await f.command(po.id, "confirmation/withdraw", f.maker.token, { version: 1, reason: REASON });
  assert.deepEqual([withdrawn.status, withdrawn.body.data.status, withdrawn.body.data.version], [200, "DRAFT", 2]);
  const detail = await f.read(po.id);
  assert.deepEqual([detail.status, detail.version, detail.confirmedAt], ["DRAFT", 2, null]);
  assert.equal(await f.historyCount(po.id), before + 1);
  assert.equal(await f.succeeded(po.id, "purchase_order.confirmation_withdrawn"), 1);
});

integrationTest("TASK-025 I2 取消 DRAFT／PENDING／CONFIRMED：從未有 GR 就成功，待審批申請作廢", async () => {
  const f = await fixture();
  const draftPo = await f.order("DRAFT", [0]), pendingPo = await f.pendingOrder(), confirmedPo = await f.order("CONFIRMED", [0]);
  const pending = await f.read(pendingPo.id);
  assert.deepEqual([pending.status, pending.approval?.status, pending.allowedActions.includes("cancel")], ["PENDING_APPROVAL", "PENDING", true]);
  for (const po of [draftPo, pendingPo, confirmedPo]) {
    const cancelled = await f.command(po.id, "cancel", f.maker.token, { version: 1, reason: REASON });
    assert.deepEqual([cancelled.status, cancelled.body.data.status, cancelled.body.data.version], [200, "CANCELLED", 2]);
  }
  const [[approval]] = await f.db.query("SELECT status FROM purchase_order_approvals WHERE purchase_order_id = ?", [pendingPo.id]);
  assert.equal(approval.status, "INVALIDATED");
  for (const po of [draftPo, pendingPo, confirmedPo]) assert.equal(await f.succeeded(po.id, "purchase_order.cancelled"), 1);
});

integrationTest("TASK-025 I3 Close Remaining：揀行同全部、錯誤、權限、原因；冇 Inventory 效果，只有轉 CLOSED 先寫 history", async () => {
  const f = await fixture();
  const { id, lines: [line1, line2, line3] } = await f.order("PARTIALLY_RECEIVED", [2, 1, 0]);
  const [[{ total: movementsBefore }]] = await f.db.query("SELECT COUNT(*) AS total FROM inventory_movements");
  const historyBefore = await f.historyCount(id);
  assert.deepEqual((await f.read(id)).allowedActions, ["copy", "closeRemaining"]);
  const close = (fields, token = f.maker.token) => f.command(id, "close-remaining", token, fields);

  const selected = await close({ version: 1, reason: REASON, lineIds: [line2] });
  assert.deepEqual([selected.status, selected.body.data.status, selected.body.data.version], [200, "PARTIALLY_RECEIVED", 2]);
  assert.deepEqual(failure(await close({ version: 2, reason: REASON, lineIds: [line1] })), [409, "PO_STATE_CONFLICT"]);
  assert.deepEqual(failure(await close({ version: 2, reason: REASON, lineIds: [Number.MAX_SAFE_INTEGER] })), [404, "PURCHASE_ORDER_NOT_FOUND"]);
  assert.equal((await close({ version: 2, reason: REASON }, f.viewer.token)).status, 403);
  assert.deepEqual(failure(await close({ version: 2 })), [400, "PURCHASING_INPUT_INVALID"]);
  const all = await close({ version: 2, reason: REASON });
  assert.deepEqual([all.status, all.body.data.status, all.body.data.version], [200, "CLOSED", 3]);

  const [rows] = await f.db.query("SELECT id, closed_remaining_base_quantity, has_outstanding FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number", [id]);
  assert.deepEqual(rows.map((row) => [Number(row.id), String(row.closed_remaining_base_quantity), Number(row.has_outstanding)]), [[line1, "0", 0], [line2, "1", 0], [line3, "2", 0]]);
  const [[{ total: movementsAfter }]] = await f.db.query("SELECT COUNT(*) AS total FROM inventory_movements");
  assert.equal(Number(movementsAfter), Number(movementsBefore));
  const [history] = await f.db.query("SELECT from_status, to_status, action FROM purchase_order_status_history WHERE purchase_order_id = ? ORDER BY sequence_no", [id]);
  assert.equal(history.length, historyBefore + 1);
  assert.deepEqual(history.at(-1), { from_status: "PARTIALLY_RECEIVED", to_status: "CLOSED", action: "CLOSE" });
  assert.equal(await f.succeeded(id, "purchase_order.remaining_closed"), 2);
});

integrationTest("TASK-025 I4 Close Remaining 同一 key 同內容再送：回原本嘅 response，唔再關多次", async () => {
  const f = await fixture();
  const { id } = await f.order("PARTIALLY_RECEIVED", [1, 0]);
  const eventId = randomUUID(), body = { version: 1, reason: REASON };
  const first = await f.command(id, "close-remaining", f.maker.token, body, eventId);
  const second = await f.command(id, "close-remaining", f.maker.token, body, eventId);
  assert.deepEqual([first.status, first.body.data.status, first.body.data.version], [200, "CLOSED", 2]);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.data, first.body.data);
  assert.equal(await f.succeeded(id, "purchase_order.remaining_closed"), 1);
});

integrationTest("TASK-045 G6 六張 PO 喺 PO lock 之下逐個問 reader：false、false、false、true、true、true", async () => {
  const f = await fixture();
  const reader = new GoodsReceiptFacts();
  const pos = [];
  for (let i = 0; i < 6; i += 1) pos.push((await f.order("CONFIRMED", [0])).id);
  const [, p1, p2, p3, p4, p5] = pos;
  const gone = await f.insert("users", { username: `po_life_gone_${randomUUID().slice(0, 8)}`, password_hash: "synthetic", display_name: "GR deleted",
    created_at: f.now, updated_at: f.now });
  await f.receipt(p1, "DRAFT");
  await f.receipt(p2, "CANCELLED");
  await f.receipt(p3, "CONFIRMED");
  await f.receipt(p4, "REVERSED");
  await f.receipt(p5, "CONFIRMED", { confirmed_by: gone });
  assert.equal((await f.db.query("DELETE FROM users WHERE id = ?", [gone]))[0].affectedRows, 1);   // FK SET NULL，唔觸發 trigger
  const [[p5row]] = await f.db.query("SELECT confirmed_by FROM goods_receipts WHERE purchase_order_id = ?", [p5]);
  assert.equal(p5row.confirmed_by, null);
  const answers = [];
  for (const id of pos) {
    answers.push(await f.db.withTransaction(async (tx) => {
      const [locked] = await tx.query("SELECT id FROM purchase_orders WHERE id = ? FOR UPDATE", [id]);
      assert.equal(locked.length, 1);
      return reader.everConfirmed(tx, id);
    }));
  }
  assert.deepEqual(answers, [false, false, false, true, true, true]);
});

integrationTest("TASK-045 有 CONFIRMED GR 嘅 PO 撤回確認：PO_STATE_CONFLICT，PO 唔變", async () => {
  const f = await fixture();
  const po = await f.order("CONFIRMED", [0]);
  await f.receipt(po.id, "CONFIRMED");
  const before = await f.historyCount(po.id);
  assert.deepEqual(failure(await f.command(po.id, "confirmation/withdraw", f.maker.token, { version: 1, reason: REASON })), [409, "PO_STATE_CONFLICT"]);
  const detail = await f.read(po.id);
  assert.deepEqual([detail.status, detail.version], ["CONFIRMED", 1]);
  assert.equal(await f.historyCount(po.id), before);
  assert.equal(await f.succeeded(po.id, "purchase_order.confirmation_withdrawn"), 0);
});

integrationTest("TASK-045 CONFIRMED PO 只有 DRAFT GR：撤回確認成功", async () => {
  const f = await fixture();
  const po = await f.order("CONFIRMED", [0]);
  await f.receipt(po.id, "DRAFT");
  const withdrawn = await f.command(po.id, "confirmation/withdraw", f.maker.token, { version: 1, reason: REASON });
  assert.deepEqual([withdrawn.status, withdrawn.body.data.status, withdrawn.body.data.version], [200, "DRAFT", 2]);
  assert.equal(await f.succeeded(po.id, "purchase_order.confirmation_withdrawn"), 1);
});
