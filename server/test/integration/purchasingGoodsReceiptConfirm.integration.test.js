/**
 * TASK-032／TC-006、TC-007：GR Confirm 經真 HTTP、真 JWT、真 MySQL 同真 Inventory batch posting（設計 §3.5、§8.7；AC-036～042）。
 * Fixture（全檔共用一次）：receiver（view＋receiving.operation）、viewer（只有 view）、1 個 Supplier、2 個 SKU
 * （A：tracking none、Base EA＋Purchase BOX×12；B：tracking batch、只有 EA）、2 個倉 3 個 Bin；PO 用 SQL 直接寫。
 * 每案最多 2 張 PO、2 張 GR、2 個 detail。故障注入用同 process 嘅 prototype patch 或者臨時 trigger，案完即還原。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { PurchasingAuditService } from "../../src/modules/purchasing/PurchasingAuditService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const MONTH = "209812", RECEIPT_DATE = "2098-12-02";
let shared = null;

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
  const application = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 },
    requestLimiter: { ...source.requestLimiter, maxRequestsPerIpPerWindow: 100_000 } } });
  cleanups.push(() => application.shutdown("purchasing_goods_receipt_confirm_integration_complete"));
  try {
    const db = application.services.require("mysqldatabase"), jwt = application.services.require("jwt");
    const tag = randomUUID().replaceAll("-", "").slice(0, 12), now = Date.now();
    const insert = async (table, row) => Number((await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
    const person = async (suffix, permissions) => {
      const name = `gr_confirm_${suffix}_${tag}`, role = await insert("roles", { name, created_at: now });
      cleanups.push(() => db.query("DELETE FROM roles WHERE id = ?", [role]), () => db.query("DELETE FROM role_permissions WHERE role_id = ?", [role]));
      for (const permission of permissions) await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [role, permission]);
      const id = await insert("users", { username: name, password_hash: "synthetic", display_name: `User ${suffix}`, created_at: now, updated_at: now });
      cleanups.push(() => db.query("DELETE FROM users WHERE id = ?", [id]), () => db.query("DELETE FROM fr_token_versions WHERE subject = ?", [String(id)]),
        () => db.query("DELETE FROM user_roles WHERE user_id = ?", [id]));
      await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [id, role]);
      const version = await application.services.require("tokenRevocation").currentVersion(String(id));
      const issue = async (granted) => jwt.issue({ roles: [name], permissions: granted }, { subject: String(id), version, authTime: Math.floor(Date.now() / 1000) });
      return { id, role, issue, token: await issue(permissions) };
    };
    const receiver = await person("receiver", ["purchasing.view", "receiving.operation"]), viewer = await person("viewer", ["purchasing.view"]);
    const overrider = await person("overrider", ["purchasing.view", "receiving.operation", "receiving.expiry.override"]);
    const other = await person("other", ["purchasing.view", "receiving.operation"]);
    const supplier = await insert("suppliers", { supplier_code: `GRC-${tag}`, supplier_code_key: `grc-${tag}`, supplier_name: "Confirm Supplier",
      supplier_name_key: "confirm supplier", default_currency_code: "HKD", status: "active", created_at: now, updated_at: now });
    const item = await insert("items", { name: `GR confirm ${tag}`, status: "active", created_at: now, updated_at: now });
    const each = await insert("item_uoms", { code: `E${tag}`, name: "Each", created_at: now, updated_at: now });
    const box = await insert("item_uoms", { code: `X${tag}`, name: "Box", created_at: now, updated_at: now });
    const sku = async (suffix, trackingPolicy) => insert("item_skus", { item_id: item, sku_code: `GRC-${tag}-${suffix}`, sku_name: `Confirm SKU ${suffix}`,
      status: "active", purchasable: 1, inventory_tracked: 1, tracking_policy: trackingPolicy, created_at: now, updated_at: now });
    const skuA = await sku("a", "none"), skuB = await sku("b", "batch");
    await insert("item_sku_uoms", { sku_id: skuA, uom_id: each, to_base_factor: 1, is_base: 1, created_at: now, updated_at: now });
    const boxA = await insert("item_sku_uoms", { sku_id: skuA, uom_id: box, to_base_factor: 12, is_base: 0, created_at: now, updated_at: now });
    const eachB = await insert("item_sku_uoms", { sku_id: skuB, uom_id: each, to_base_factor: 1, is_base: 1, created_at: now, updated_at: now });
    const warehouse = async (suffix) => insert("inventory_warehouses", { warehouse_code: `C${tag}${suffix}`, normalized_code: `c${tag}${suffix}`,
      warehouse_name: `C ${suffix}`, created_at: now, updated_at: now });
    const w1 = await warehouse("1"), w2 = await warehouse("2");
    const bin = async (warehouseId, suffix) => insert("inventory_bins", { warehouse_id: warehouseId, bin_code: `B${suffix}`, normalized_code: `b${suffix}`,
      created_at: now, updated_at: now });
    const b1 = await bin(w1, "1"), b3 = await bin(w1, "3"), b2 = await bin(w2, "2");
    /** line A（SKU A，BOX×12，訂 2 BOX＝24）同 line B（SKU B，batch，訂 10 EA）；最後先改表頭狀態（line trigger）。 */
    const order = async (status = "CONFIRMED", { minLifeB = null } = {}) => {
      const [[{ next }]] = await db.query("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next FROM purchase_orders WHERE document_year_month = ?", [MONTH]);
      const id = await insert("purchase_orders", { po_number: `PO-${MONTH}-${String(next).padStart(6, "0")}`, document_year_month: MONTH, sequence_no: Number(next),
        supplier_id: supplier, supplier_code_snapshot: `GRC-${tag}`, supplier_name_snapshot: "Confirm Supplier", currency_code: "HKD", currency_name_snapshot: "HK Dollar",
        currency_decimal_places_snapshot: 2, order_date: "2098-12-01", buyer_id: receiver.id, buyer_label: "Buyer", total_amount: "34.0000", subtotal_amount: "34.0000",
        has_outstanding: 1, created_at: now, updated_at: now, created_by: receiver.id, created_by_label: "receiver", updated_by: receiver.id, updated_by_label: "receiver" });
      const line = (number, fields) => insert("purchase_order_lines", { purchase_order_id: id, line_number: number, inventory_tracked_snapshot: 1,
        base_uom_id: each, base_uom_code_snapshot: `E${tag}`, unit_price: "1.0000", line_amount: "1.0000", has_outstanding: 1, created_at: now, updated_at: now, ...fields });
      const lineA = await line(1, { sku_id: skuA, sku_code_snapshot: `GRC-${tag}-a`, sku_name_snapshot: "Confirm SKU a", tracking_policy_snapshot: "none",
        purchase_sku_uom_id: boxA, purchase_uom_code_snapshot: `X${tag}`, uom_to_base_factor_snapshot: 12, ordered_quantity: "2", ordered_base_quantity: 24 });
      const lineB = await line(2, { sku_id: skuB, sku_code_snapshot: `GRC-${tag}-b`, sku_name_snapshot: "Confirm SKU b", tracking_policy_snapshot: "batch",
        purchase_sku_uom_id: eachB, purchase_uom_code_snapshot: `E${tag}`, uom_to_base_factor_snapshot: 1, ordered_quantity: "10", ordered_base_quantity: 10,
        minimum_receipt_life_days_snapshot: minLifeB });
      await db.query("UPDATE purchase_orders SET status = ?, confirmed_at = ? WHERE id = ?", [status, now, id]);
      return { id, lineA, lineB };
    };
    const { url } = await application.start();
    const send = async (path, { token = receiver.token, body, key = body?.eventId }) => {
      const response = await fetch(`${url}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": key,
        "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const read = async (path, token = receiver.token) => {
      const response = await fetch(`${url}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      return { status: response.status, body: await response.json() };
    };
    const lookup = async (eventId, token = receiver.token) => {
      const response = await fetch(`${url}/api/v1/purchasing-operations/by-event/${eventId}`, { headers: { Authorization: `Bearer ${token}` } });
      return { status: response.status, body: await response.json() };
    };
    const draft = async (purchaseOrderId) => (await send("/api/v1/goods-receipts/create",
      { body: { eventId: randomUUID(), purchaseOrderId, businessReceiptDate: RECEIPT_DATE } })).body.data.id;
    const confirm = (id, version, lines, { token, eventId = randomUUID(), ...fields } = {}) => send(`/api/v1/goods-receipts/${id}/confirm`,
      { token, body: { eventId, version, businessReceiptDate: RECEIPT_DATE, lines, ...fields } });
    const time = application.services.require("time"), today = time.fileDate(time.at(time.nowMs()));
    const header = async (id) => (await db.query(`SELECT status, version, confirmed_at, confirm_event_id, has_over_receipt, has_sku_exception, has_expiry_override, supplier_status_at_confirm,
      supplier_exception_reason FROM goods_receipts WHERE id = ?`, [id]))[0][0];
    const details = async (id) => (await db.query(`SELECT received_base_quantity, inventory_movement_id, inventory_operation_request_id, confirmed_at
      FROM goods_receipt_details WHERE goods_receipt_id = ? ORDER BY detail_number`, [id]))[0];
    const progress = async (poId) => (await db.query(`SELECT gross_received_base_quantity AS gross, net_received_base_quantity AS net, has_outstanding,
      is_over_received FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id`, [poId]))[0]
      .map((row) => [Number(row.gross), Number(row.net), Number(row.has_outstanding), Number(row.is_over_received)]);
    const po = async (poId) => (await db.query("SELECT status, version, has_outstanding, has_confirmed_receipt FROM purchase_orders WHERE id = ?", [poId]))[0][0];
    const audits = async (id, outcome = "SUCCEEDED") => Number((await db.query(`SELECT COUNT(*) AS total FROM purchasing_audit_logs
      WHERE goods_receipt_id = ? AND action = 'goods_receipt.confirmed' AND outcome = ?`, [id, outcome]))[0][0].total);
    /** Inventory 效果：Movement 數目同 Balance on hand 總數。 */
    const stock = async () => {
      const [[moves]] = await db.query("SELECT COUNT(*) AS total FROM inventory_movements WHERE sku_id IN (?, ?)", [skuA, skuB]);
      const [[balance]] = await db.query("SELECT COALESCE(SUM(on_hand_quantity), 0) AS total FROM inventory_stock_balances WHERE sku_id IN (?, ?)", [skuA, skuB]);
      return [Number(moves.total), Number(balance.total)];
    };
    return { db, cleanups, order, draft, confirm, lookup, read, other, person, overrider, today, skuA, header, details, progress, po, audits, stock, receiver, viewer, supplier, each, box, w1, w2, b1, b2, b3 };
  } catch (error) {
    const cleanupErrors = await runCleanups(cleanups);
    throw cleanupErrors.length ? new AggregateError([error, ...cleanupErrors], "Goods receipt confirm fixture setup failed and its cleanup also failed") : error;
  }
}
const fixture = () => (shared ??= setup());
after(async () => {
  if (!shared) return;
  let state;
  try { state = await shared; } catch { return; }
  const errors = await runCleanups(state.cleanups);
  if (errors.length) throw new AggregateError(errors, "Goods receipt confirm fixture cleanup failed");
});
const failure = (result) => [result.status, result.body.error?.code, result.body.error?.details?.field];
const detail = (f, fields = {}) => ({ inputUomId: f.each, receivedQuantity: "1", warehouseId: f.w1, binId: f.b1, stockStatus: "AVAILABLE", ...fields });
/** 標準兩行：A 收 1 BOX（12），B 收 10 EA 批號 L1。 */
const twoLines = (f, poRow, fieldsB = {}) => [
  { purchaseOrderLineId: poRow.lineA, details: [detail(f, { inputUomId: f.box })] },
  { purchaseOrderLineId: poRow.lineB, details: [detail(f, { receivedQuantity: "10", lotNumber: "L1", ...fieldsB })] }];
/** 拒絕後：GR 仍係 Draft version 1、PO 同 Inventory 唔變。 */
async function assertUntouched(f, id, poRow, before) {
  const stored = await f.header(id);
  assert.deepEqual([stored.status, Number(stored.version), stored.confirmed_at], ["DRAFT", 1, null]);
  assert.deepEqual([await f.progress(poRow.id), await f.po(poRow.id), await f.stock()], before);
}
const snapshot = async (f, poRow) => [await f.progress(poRow.id), await f.po(poRow.id), await f.stock()];

integrationTest("TASK-032 C1 確認兩行：一次 Inventory 過帳、GR CONFIRMED、PO progress 及狀態、history、Audit；收齊後 FULLY_RECEIVED（AC-036、AC-040）", async () => {
  const f = await fixture();
  const poRow = await f.order(), id = await f.draft(poRow.id), [moves, onHand] = await f.stock();
  const done = await f.confirm(id, 1, twoLines(f, poRow));
  assert.deepEqual([done.status, done.body.data.status, done.body.data.version, done.body.data.replayed], [200, "CONFIRMED", 2, false], JSON.stringify(done.body));
  const stored = await f.header(id);
  assert.deepEqual([stored.status, Number(stored.version), stored.confirmed_at !== null, stored.supplier_status_at_confirm, Number(stored.has_over_receipt)],
    ["CONFIRMED", 2, true, "active", 0]);
  const rows = await f.details(id);
  assert.deepEqual(rows.map((row) => Number(row.received_base_quantity)), [12, 10]);
  assert.ok(rows.every((row) => row.inventory_movement_id !== null && row.inventory_operation_request_id !== null && row.confirmed_at !== null));
  assert.deepEqual(await f.progress(poRow.id), [[12, 12, 1, 0], [10, 10, 0, 0]]);
  const order = await f.po(poRow.id);
  assert.deepEqual([order.status, Number(order.version), Number(order.has_outstanding), Number(order.has_confirmed_receipt)], ["PARTIALLY_RECEIVED", 2, 1, 1]);
  assert.deepEqual(await f.stock(), [moves + 2, onHand + 22]);
  assert.equal(await f.audits(id), 1);
  const [history] = await f.db.query("SELECT from_status, to_status, action FROM purchase_order_status_history WHERE purchase_order_id = ? ORDER BY sequence_no", [poRow.id]);
  assert.deepEqual(history.map((row) => [row.from_status, row.to_status, row.action]), [["CONFIRMED", "PARTIALLY_RECEIVED", "RECEIVE"]]);

  const rest = await f.draft(poRow.id);
  // Line B 已收齊（net 10＝ordered 10）：再收 1 件，outstanding 要按已鎖定 net 計成 0，所以係超收。
  assert.deepEqual(failure(await f.confirm(rest, 1, [{ purchaseOrderLineId: poRow.lineB, details: [detail(f, { lotNumber: "L1" })] }])),
    [409, "OVER_RECEIPT_REASON_REQUIRED", "lines.0.overReceiptReason"]);
  const second = await f.confirm(rest, 1, [{ purchaseOrderLineId: poRow.lineA, details: [detail(f, { receivedQuantity: "12", binId: f.b3 })] }]);
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.deepEqual(await f.progress(poRow.id), [[24, 24, 0, 0], [10, 10, 0, 0]]);
  assert.deepEqual([(await f.po(poRow.id)).status, Number((await f.po(poRow.id)).has_outstanding)], ["FULLY_RECEIVED", 0]);
});

integrationTest("TASK-032 C2 同 event 同內容重送回原結果而且冇第二次庫存效果；同 event 唔同內容 409", async () => {
  const f = await fixture();
  const poRow = await f.order(), id = await f.draft(poRow.id), eventId = randomUUID();
  assert.equal((await f.confirm(id, 1, twoLines(f, poRow), { eventId })).status, 200);
  const after = await snapshot(f, poRow);
  const again = await f.confirm(id, 1, twoLines(f, poRow), { eventId });
  assert.deepEqual([again.status, again.body.data.status, again.body.data.version], [200, "CONFIRMED", 2], JSON.stringify(again.body));
  assert.deepEqual(await snapshot(f, poRow), after);
  assert.deepEqual(failure(await f.confirm(id, 1, twoLines(f, poRow, { lotNumber: "L2" }), { eventId })).slice(0, 2), [409, "IDEMPOTENCY_CONFLICT"]);
  assert.deepEqual(await snapshot(f, poRow), after);
});

integrationTest("TASK-032 C3 超收冇原因整張拒絕、零效果；有原因就確認並標記超收（AC-039）", async () => {
  const f = await fixture();
  const poRow = await f.order(), id = await f.draft(poRow.id), before = await snapshot(f, poRow);
  const over = [{ purchaseOrderLineId: poRow.lineB, details: [detail(f, { receivedQuantity: "12", lotNumber: "L1" })] }];
  assert.deepEqual(failure(await f.confirm(id, 1, over)), [409, "OVER_RECEIPT_REASON_REQUIRED", "lines.0.overReceiptReason"]);
  await assertUntouched(f, id, poRow, before);
  assert.equal(await f.audits(id, "REJECTED"), 1);
  over[0].overReceiptReason = "供應商按整箱多送兩件";
  const done = await f.confirm(id, 1, over);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(Number((await f.header(id)).has_over_receipt), 1);
  assert.deepEqual((await f.progress(poRow.id))[1], [12, 12, 0, 1]);
  const [[line]] = await f.db.query("SELECT po_outstanding_before_base_quantity AS before_qty, over_received_base_quantity AS over_qty, over_receipt_reason FROM goods_receipt_lines WHERE goods_receipt_id = ?", [id]);
  assert.deepEqual([Number(line.before_qty), Number(line.over_qty), line.over_receipt_reason], [10, 2, "供應商按整箱多送兩件"]);
});

integrationTest("TASK-032 C4 Inventory 第二個 detail 失敗（停用 Bin、停用倉）同 Bin 唔屬倉都對照成公開錯誤，GR 保持 Draft、零 Movement／Balance（TASK-028 移入）", async () => {
  const f = await fixture();
  const poRow = await f.order(), id = await f.draft(poRow.id), before = await snapshot(f, poRow);
  await f.db.query("UPDATE inventory_bins SET status = 'INACTIVE' WHERE id = ?", [f.b3]);
  try {
    assert.deepEqual(failure(await f.confirm(id, 1, twoLines(f, poRow, { binId: f.b3 }))).slice(0, 2), [409, "BIN_INVALID"]);
    await assertUntouched(f, id, poRow, before);
  } finally { await f.db.query("UPDATE inventory_bins SET status = 'ACTIVE' WHERE id = ?", [f.b3]); }
  await f.db.query("UPDATE inventory_warehouses SET status = 'INACTIVE' WHERE id = ?", [f.w2]);
  try {
    assert.deepEqual(failure(await f.confirm(id, 1, twoLines(f, poRow, { warehouseId: f.w2, binId: f.b2 }))).slice(0, 2), [409, "WAREHOUSE_INVALID"]);
    await assertUntouched(f, id, poRow, before);
  } finally { await f.db.query("UPDATE inventory_warehouses SET status = 'ACTIVE' WHERE id = ?", [f.w2]); }
  assert.deepEqual(failure(await f.confirm(id, 1, twoLines(f, poRow, { binId: f.b2 }))), [409, "BIN_WAREHOUSE_MISMATCH", "lines.1.details.0.binId"]);
  await assertUntouched(f, id, poRow, before);
});

integrationTest("TASK-032 C5 Inventory 結果少一行或多一行、Audit 失敗、PO progress 失敗都令真實 Inventory 寫入一齊 rollback", async () => {
  const f = await fixture();
  const poRow = await f.order(), id = await f.draft(poRow.id), before = await snapshot(f, poRow);
  const original = InventoryPostingService.prototype.postPurchaseReceiptBatchInTransaction;
  for (const [label, mutate] of [["missing", (lines) => lines.slice(1)], ["extra", (lines) => [...lines, { ...lines[0], sourceLineId: "999999999" }]]]) {
    InventoryPostingService.prototype.postPurchaseReceiptBatchInTransaction = async function (tx, command) {
      const result = await original.call(this, tx, command);
      return { ...result, lines: mutate(result.lines) };
    };
    try {
      assert.deepEqual(failure(await f.confirm(id, 1, twoLines(f, poRow))).slice(0, 2), [503, "PURCHASING_DEPENDENCY_UNAVAILABLE"], label);
    } finally { InventoryPostingService.prototype.postPurchaseReceiptBatchInTransaction = original; }
    await assertUntouched(f, id, poRow, before);
  }

  const record = PurchasingAuditService.prototype.record;
  PurchasingAuditService.prototype.record = async function (tx, entry) {
    if (entry.action === "goods_receipt.confirmed") throw new Error("Synthetic confirm audit failure");
    return record.call(this, tx, entry);
  };
  try {
    assert.equal((await f.confirm(id, 1, twoLines(f, poRow))).status, 500);
  } finally { PurchasingAuditService.prototype.record = record; }
  await assertUntouched(f, id, poRow, before);

  await f.db.query(`CREATE TRIGGER test_gr_confirm_progress_failure BEFORE UPDATE ON purchase_order_lines FOR EACH ROW
    BEGIN IF NEW.id = ${Number(poRow.lineB)} AND NEW.gross_received_base_quantity <> OLD.gross_received_base_quantity THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Synthetic PO progress failure'; END IF; END`);
  try {
    assert.equal((await f.confirm(id, 1, twoLines(f, poRow))).status, 500);
  } finally { await f.db.query("DROP TRIGGER test_gr_confirm_progress_failure"); }
  await assertUntouched(f, id, poRow, before);
  assert.equal((await f.confirm(id, 1, twoLines(f, poRow))).status, 200);
});

integrationTest("TASK-032 C6 Blocked Supplier：冇原因拒絕；有原因但唔係 QUARANTINED 拒絕；兩者都齊就確認（§3.6）", async () => {
  const f = await fixture();
  const poRow = await f.order(), id = await f.draft(poRow.id), before = await snapshot(f, poRow);
  await f.db.query("UPDATE suppliers SET status = 'blocked' WHERE id = ?", [f.supplier]);
  try {
    const lines = [{ purchaseOrderLineId: poRow.lineA, details: [detail(f)] }];
    assert.deepEqual(failure(await f.confirm(id, 1, lines)), [409, "SUPPLIER_EXCEPTION_REASON_REQUIRED", "supplierExceptionReason"]);
    const reason = { supplierExceptionReason: "供應商已封鎖，本批先隔離" };
    assert.deepEqual(failure(await f.confirm(id, 1, lines, reason)), [409, "BLOCKED_SUPPLIER_QUARANTINE_REQUIRED", "lines.0.details.0.stockStatus"]);
    await assertUntouched(f, id, poRow, before);
    lines[0].details[0].stockStatus = "QUARANTINED";
    assert.equal((await f.confirm(id, 1, lines, reason)).status, 200);
    const stored = await f.header(id);
    assert.deepEqual([stored.supplier_status_at_confirm, stored.supplier_exception_reason], ["blocked", "供應商已封鎖，本批先隔離"]);
  } finally { await f.db.query("UPDATE suppliers SET status = 'active' WHERE id = ?", [f.supplier]); }
});

integrationTest("TASK-032 C7 Draft 准留空嘅批號喺 Confirm 必填；冇 receiving.operation 403；舊 version 409；已確認 GR 唔可以再確認", async () => {
  const f = await fixture();
  const poRow = await f.order(), id = await f.draft(poRow.id), before = await snapshot(f, poRow);
  assert.deepEqual(failure(await f.confirm(id, 1, [])), [400, "PURCHASING_INPUT_INVALID", "lines"]);
  assert.deepEqual(failure(await f.confirm(id, 1, twoLines(f, poRow, { lotNumber: "" }))), [409, "LOT_REQUIRED", "lines.1.details.0.lotNumber"]);
  assert.equal((await f.confirm(id, 1, twoLines(f, poRow), { token: f.viewer.token })).status, 403);
  assert.deepEqual(failure(await f.confirm(id, 2, twoLines(f, poRow))).slice(0, 2), [409, "VERSION_CONFLICT"]);
  await assertUntouched(f, id, poRow, before);
  assert.equal((await f.confirm(id, 1, twoLines(f, poRow))).status, 200);
  assert.deepEqual(failure(await f.confirm(id, 2, twoLines(f, poRow))).slice(0, 2), [409, "GR_STATE_CONFLICT"]);
});

integrationTest("TASK-032 C9 PO 確認後 SKU 追蹤方式改變：冇原因拒絕、零效果；有原因就按 PO 快照確認並標記 SKU 例外（§3.6；兩邊各自判斷 drift）", async () => {
  const f = await fixture();
  const poRow = await f.order(), id = await f.draft(poRow.id), before = await snapshot(f, poRow);
  const lines = [{ purchaseOrderLineId: poRow.lineA, details: [detail(f, { inputUomId: f.box })] }];
  await f.db.query("UPDATE item_skus SET tracking_policy = 'batch' WHERE id = ?", [f.skuA]);
  try {
    assert.deepEqual(failure(await f.confirm(id, 1, lines)), [409, "SKU_COMMITMENT_REASON_REQUIRED", "lines.0.skuExceptionReason"]);
    await assertUntouched(f, id, poRow, before);
    lines[0].skuExceptionReason = "追蹤方式已改，仍按採購單收貨";
    const done = await f.confirm(id, 1, lines);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(Number((await f.header(id)).has_sku_exception), 1);
  } finally { await f.db.query("UPDATE item_skus SET tracking_policy = 'none' WHERE id = ?", [f.skuA]); }
});

integrationTest("TASK-032 C10 剩餘效期不足：冇放行權限拒絕、有權冇原因拒絕、權限及原因齊就確認並標記效期放行（§3.6；Inventory 再驗）", async () => {
  const f = await fixture();
  const poRow = await f.order("CONFIRMED", { minLifeB: 30 }), id = await f.draft(poRow.id), before = await snapshot(f, poRow);
  const expiryDate = new Date(Date.parse(`${f.today}T00:00:00Z`) + 10 * 86_400_000).toISOString().slice(0, 10);
  const lines = (reason) => [{ purchaseOrderLineId: poRow.lineB,
    details: [detail(f, { receivedQuantity: "10", lotNumber: `EXP-${id}`, expiryDate, ...(reason ? { expiryOverrideReason: reason } : {}) })] }];
  const at = { businessReceiptDate: f.today };
  assert.deepEqual(failure(await f.confirm(id, 1, lines("短效期貨品經主管放行"), at)), [403, "EXPIRY_OVERRIDE_DENIED", "lines.0.details.0.expiryOverrideReason"]);
  assert.deepEqual(failure(await f.confirm(id, 1, lines(""), { ...at, token: f.overrider.token })), [409, "MINIMUM_RECEIPT_LIFE_FAILED", "lines.0.details.0.expiryOverrideReason"]);
  await assertUntouched(f, id, poRow, before);
  const done = await f.confirm(id, 1, lines("短效期貨品經主管放行"), { ...at, token: f.overrider.token });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(Number((await f.header(id)).has_expiry_override), 1);
  const [[row]] = await f.db.query("SELECT minimum_life_days_applied, actual_remaining_life_days, expiry_override_by FROM goods_receipt_details WHERE goods_receipt_id = ?", [id]);
  assert.deepEqual([Number(row.minimum_life_days_applied), Number(row.actual_remaining_life_days), Number(row.expiry_override_by)], [30, 10, f.overrider.id]);
});

integrationTest("TASK-033 C8 按原 eventId 查確認結果：本人回 COMPLETED 及摘要；其他用戶、冇原命令權限、唔存在都係 404；格式錯 400（§2.7、§5.4）", async () => {
  const f = await fixture();
  const poRow = await f.order(), id = await f.draft(poRow.id), eventId = randomUUID();
  const done = await f.confirm(id, 1, twoLines(f, poRow), { eventId });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const found = await f.lookup(eventId);
  assert.equal(found.status, 200, JSON.stringify(found.body));
  const { completedAt, ...rest } = found.body.data;
  assert.ok(Number.isSafeInteger(completedAt) && completedAt > 0);
  assert.deepEqual(rest, { status: "COMPLETED", resultType: "GR", resultId: String(id),
    resultSummary: { id, number: done.body.data.number, status: "CONFIRMED", version: 2 } });
  for (const token of [f.other.token, f.viewer.token]) assert.deepEqual(failure(await f.lookup(eventId, token)).slice(0, 2), [404, "PURCHASING_OPERATION_NOT_FOUND"]);
  assert.deepEqual(failure(await f.lookup(randomUUID())).slice(0, 2), [404, "PURCHASING_OPERATION_NOT_FOUND"]);
  assert.equal((await f.lookup("not-a-uuid")).status, 400);

  // 同一個用戶之後失去原命令權限（receiving.operation）：用新 token 查自己嘅結果都係 404。
  const lapsed = await f.person(`lapsed${randomUUID().slice(0, 4)}`, ["purchasing.view", "receiving.operation"]);
  const ownPo = await f.order(), own = await f.draft(ownPo.id), ownEvent = randomUUID();
  assert.equal((await f.confirm(own, 1, twoLines(f, ownPo), { eventId: ownEvent, token: lapsed.token })).status, 200);
  assert.equal((await f.lookup(ownEvent, lapsed.token)).status, 200);
  await f.db.query("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? AND p.name = 'receiving.operation'", [lapsed.role]);
  assert.deepEqual(failure(await f.lookup(ownEvent, await lapsed.issue(["purchasing.view"]))).slice(0, 2), [404, "PURCHASING_OPERATION_NOT_FOUND"]);
});

integrationTest("收貨單最小 list／detail GET：Draft 有編輯動作、確認後冇；detail 帶 lines／details 及 Inventory movement；list 按 PO 及狀態篩；錯 status 400、唔存在 404", async () => {
  const f = await fixture();
  const poRow = await f.order(), id = await f.draft(poRow.id);
  const before = await f.read(`/api/v1/goods-receipts/${id}`);
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.deepEqual([before.body.data.status, before.body.data.allowedActions, before.body.data.lines], ["DRAFT", ["update", "cancel", "confirm"], []]);
  assert.equal((await f.confirm(id, 1, twoLines(f, poRow))).status, 200);
  const after = (await f.read(`/api/v1/goods-receipts/${id}`)).body.data;
  assert.deepEqual([after.status, after.version, after.allowedActions, after.purchaseOrderId, after.businessReceiptDate], ["CONFIRMED", 2, [], poRow.id, "2098-12-02"]);
  assert.deepEqual(after.lines.map((line) => [line.purchaseOrderLineId, line.receivedBaseQuantity, line.details.length]), [[poRow.lineA, "12", 1], [poRow.lineB, "10", 1]]);
  const [a, b] = after.lines.map((line) => line.details[0]);
  assert.deepEqual([a.inputUomId, a.receivedQuantity, a.binId, b.lotNumber, b.stockStatus], [f.box, "1.000000", f.b1, "L1", "AVAILABLE"]);
  assert.ok(Number.isSafeInteger(a.inventoryMovementId) && Number.isSafeInteger(b.inventoryMovementId));
  const list = (await f.read(`/api/v1/goods-receipts?purchaseOrderId=${poRow.id}&status=CONFIRMED`)).body.data;
  assert.deepEqual([list.total, list.items.map((item) => [item.id, item.status, item.purchaseOrderNumber.startsWith("PO-")])], [1, [[id, "CONFIRMED", true]]]);
  assert.equal((await f.read(`/api/v1/goods-receipts?purchaseOrderId=${poRow.id}&status=DRAFT`)).body.data.total, 0);
  assert.equal((await f.read("/api/v1/goods-receipts?status=NOPE")).status, 400);
  assert.equal((await f.read(`/api/v1/goods-receipts/${Number.MAX_SAFE_INTEGER}`)).status, 404);
  assert.equal((await f.read(`/api/v1/goods-receipts/${id}`, f.overrider.token)).status, 200);
});
