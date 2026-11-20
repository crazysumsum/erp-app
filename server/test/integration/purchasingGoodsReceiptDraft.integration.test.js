/**
 * TASK-029／TC-005（Draft 部分）：GR Draft create／update／cancel 經真 HTTP、真 JWT 同真 MySQL（設計 §3.4、§5.3、§8.5；AC-021～024、AC-035）。
 * Fixture（全檔共用一次）：2 名用戶（receiver：view＋receiving.operation；viewer：只有 view）、1 個 Supplier、2 個 SKU
 * （A：tracking none、Base EA＋Purchase BOX×12；B：tracking batch、只有 EA）、2 個倉 3 個 Bin；PO 用 SQL 直接寫。
 * 每案最多 3 張 PO、2 張 GR、4 個 detail。完咗刪走用戶、角色同 token version，關 application；其餘留喺私人 DB，隨 DB 一齊棄置。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const MONTH = "209811", RECEIPT_DATE = "2098-11-02", REASON = "收貨單取消原因";
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
  // 全檔約 50 個 request，高過預設每 IP 上限；同 Supplier harness 一樣放寬，唔係測試速率限制。
  const application = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 },
    requestLimiter: { ...source.requestLimiter, maxRequestsPerIpPerWindow: 100_000 } } });
  cleanups.push(() => application.shutdown("purchasing_goods_receipt_draft_integration_complete"));
  try {
    const db = application.services.require("mysqldatabase"), jwt = application.services.require("jwt");
    const tag = randomUUID().replaceAll("-", "").slice(0, 12), now = Date.now();
    const insert = async (table, row) => Number((await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
    const person = async (suffix, permissions) => {
      const name = `gr_draft_${suffix}_${tag}`, role = await insert("roles", { name, created_at: now });
      cleanups.push(() => db.query("DELETE FROM roles WHERE id = ?", [role]), () => db.query("DELETE FROM role_permissions WHERE role_id = ?", [role]));
      for (const permission of permissions) await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [role, permission]);
      const id = await insert("users", { username: name, password_hash: "synthetic", display_name: `User ${suffix}`, created_at: now, updated_at: now });
      cleanups.push(() => db.query("DELETE FROM users WHERE id = ?", [id]), () => db.query("DELETE FROM fr_token_versions WHERE subject = ?", [String(id)]),
        () => db.query("DELETE FROM user_roles WHERE user_id = ?", [id]));
      await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [id, role]);
      const version = await application.services.require("tokenRevocation").currentVersion(String(id));
      return { id, username: name, token: await jwt.issue({ roles: [name], permissions }, { subject: String(id), version, authTime: Math.floor(now / 1000) }) };
    };
    const receiver = await person("receiver", ["purchasing.view", "receiving.operation"]), viewer = await person("viewer", ["purchasing.view"]);
    const supplier = await insert("suppliers", { supplier_code: `GRD-${tag}`, supplier_code_key: `grd-${tag}`, supplier_name: "Draft Supplier",
      supplier_name_key: "draft supplier", default_currency_code: "HKD", status: "active", created_at: now, updated_at: now });
    const item = await insert("items", { name: `GR draft ${tag}`, status: "active", created_at: now, updated_at: now });
    const each = await insert("item_uoms", { code: `E${tag}`, name: "Each", created_at: now, updated_at: now });
    const box = await insert("item_uoms", { code: `X${tag}`, name: "Box", created_at: now, updated_at: now });
    const sku = async (suffix) => insert("item_skus", { item_id: item, sku_code: `GRD-${tag}-${suffix}`, sku_name: `Draft SKU ${suffix}`, status: "active",
      created_at: now, updated_at: now });
    const skuA = await sku("a"), skuB = await sku("b");
    await insert("item_sku_uoms", { sku_id: skuA, uom_id: each, to_base_factor: 1, is_base: 1, created_at: now, updated_at: now });
    const boxA = await insert("item_sku_uoms", { sku_id: skuA, uom_id: box, to_base_factor: 12, is_base: 0, created_at: now, updated_at: now });
    const eachB = await insert("item_sku_uoms", { sku_id: skuB, uom_id: each, to_base_factor: 1, is_base: 1, created_at: now, updated_at: now });
    const warehouse = async (suffix) => insert("inventory_warehouses", { warehouse_code: `W${tag}${suffix}`, normalized_code: `w${tag}${suffix}`,
      warehouse_name: `W ${suffix}`, created_at: now, updated_at: now });
    const w1 = await warehouse("1"), w2 = await warehouse("2");
    const bin = async (warehouseId, suffix) => insert("inventory_bins", { warehouse_id: warehouseId, bin_code: `B${suffix}`, normalized_code: `b${suffix}`,
      created_at: now, updated_at: now });
    const b1 = await bin(w1, "1"), b3 = await bin(w1, "3"), b2 = await bin(w2, "2");
    /** SQL fixture：line A（SKU A，BOX×12，訂 2 BOX＝24）同 line B（SKU B，batch，訂 10 EA）；最後先改表頭狀態（line trigger）。 */
    const order = async (status, { closedA = false } = {}) => {
      const [[{ next }]] = await db.query("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next FROM purchase_orders WHERE document_year_month = ?", [MONTH]);
      const id = await insert("purchase_orders", { po_number: `PO-${MONTH}-${String(next).padStart(6, "0")}`, document_year_month: MONTH, sequence_no: Number(next),
        supplier_id: supplier, supplier_code_snapshot: `GRD-${tag}`, supplier_name_snapshot: "Draft Supplier", currency_code: "HKD", currency_name_snapshot: "HK Dollar",
        currency_decimal_places_snapshot: 2, order_date: "2098-11-01", buyer_id: receiver.id, buyer_label: "Buyer", total_amount: "5.0000", subtotal_amount: "5.0000",
        created_at: now, updated_at: now, created_by: receiver.id, created_by_label: "receiver", updated_by: receiver.id, updated_by_label: "receiver" });
      const line = (number, fields) => insert("purchase_order_lines", { purchase_order_id: id, line_number: number, inventory_tracked_snapshot: 1,
        base_uom_id: each, base_uom_code_snapshot: "EA", unit_price: "1.0000", line_amount: "2.5000", created_at: now, updated_at: now, ...fields });
      const lineA = await line(1, { sku_id: skuA, sku_code_snapshot: `GRD-${tag}-a`, sku_name_snapshot: "Draft SKU a", tracking_policy_snapshot: "none",
        purchase_sku_uom_id: boxA, purchase_uom_code_snapshot: "BOX", uom_to_base_factor_snapshot: 12, ordered_quantity: "2", ordered_base_quantity: 24 });
      const lineB = await line(2, { sku_id: skuB, sku_code_snapshot: `GRD-${tag}-b`, sku_name_snapshot: "Draft SKU b", tracking_policy_snapshot: "batch",
        purchase_sku_uom_id: eachB, purchase_uom_code_snapshot: "EA", uom_to_base_factor_snapshot: 1, ordered_quantity: "10", ordered_base_quantity: 10 });
      if (status !== "DRAFT") await db.query("UPDATE purchase_orders SET status = ?, confirmed_at = ? WHERE id = ?", [status, now, id]);
      if (closedA) await db.query("UPDATE purchase_order_lines SET closed_remaining_base_quantity = 24, has_outstanding = 0, closed_at = ? WHERE id = ?", [now, lineA]);
      return { id, lineA, lineB };
    };
    const { url } = await application.start();
    const send = async (path, { token, body, method = "POST", key = body?.eventId }) => {
      const response = await fetch(`${url}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(key ? { "Idempotency-Key": key } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    const create = (purchaseOrderId, { token = receiver.token, eventId = randomUUID(), ...fields } = {}) => send("/api/v1/goods-receipts/create",
      { token, body: { eventId, purchaseOrderId, businessReceiptDate: RECEIPT_DATE, ...fields } });
    const update = (id, version, lines, { token = receiver.token, eventId = randomUUID(), ...fields } = {}) => send(`/api/v1/goods-receipts/${id}/update`,
      { token, body: { eventId, version, businessReceiptDate: RECEIPT_DATE, lines, ...fields } });
    const cancel = (id, version, reason = REASON, eventId = randomUUID()) => send(`/api/v1/goods-receipts/${id}/cancel`,
      { token: receiver.token, body: { eventId, version, reason } });
    const header = async (id) => (await db.query("SELECT status, version, total_received_base_quantity, cancel_reason, gr_number FROM goods_receipts WHERE id = ?", [id]))[0][0];
    const details = async (id) => (await db.query(`SELECT purchase_order_line_id, input_uom_id, received_quantity, received_base_quantity, warehouse_id, bin_id,
      warehouse_code_snapshot, bin_code_snapshot, lot_number, stock_status FROM goods_receipt_details WHERE goods_receipt_id = ? ORDER BY detail_number`, [id]))[0];
    const progress = async (poId) => (await db.query(`SELECT gross_received_base_quantity AS gross, net_received_base_quantity AS net, has_outstanding
      FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id`, [poId]))[0].map((row) => [Number(row.gross), Number(row.net), Number(row.has_outstanding)]);
    const audits = async (id, action, outcome = "SUCCEEDED") => Number((await db.query(`SELECT COUNT(*) AS total FROM purchasing_audit_logs
      WHERE goods_receipt_id = ? AND action = ? AND outcome = ?`, [id, action, outcome]))[0][0].total);
    const movements = async () => Number((await db.query("SELECT COUNT(*) AS total FROM inventory_movements WHERE sku_id IN (?, ?)", [skuA, skuB]))[0][0].total);
    return { db, cleanups, order, create, update, cancel, header, details, progress, audits, movements, receiver, viewer, each, box, w1, w2, b1, b2, b3 };
  } catch (error) {
    const cleanupErrors = await runCleanups(cleanups);
    throw cleanupErrors.length ? new AggregateError([error, ...cleanupErrors], "Goods receipt draft fixture setup failed and its cleanup also failed") : error;
  }
}
const fixture = () => (shared ??= setup());
after(async () => {
  if (!shared) return;
  let state;
  try { state = await shared; } catch { return; }
  const errors = await runCleanups(state.cleanups);
  if (errors.length) throw new AggregateError(errors, "Goods receipt draft fixture cleanup failed");
});
const failure = (result) => [result.status, result.body.error?.code];
const detail = (f, fields = {}) => ({ inputUomId: f.each, receivedQuantity: "1", warehouseId: f.w1, binId: f.b1, stockStatus: "AVAILABLE", ...fields });

integrationTest("TASK-029 G1 從 CONFIRMED PO 建立空 GR Draft：201、GR 編號、version 1、Audit，PO progress 同 Inventory 不變", async () => {
  const f = await fixture();
  const po = await f.order("CONFIRMED");
  const before = await f.progress(po.id), movements = await f.movements();
  const created = await f.create(po.id, { supplierDeliveryNote: "", notes: "首批" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { id, number, status, version, warnings, replayed } = created.body.data;
  assert.match(number, /^GR-\d{6}-\d{6}$/u);
  assert.deepEqual([status, version, warnings, replayed], ["DRAFT", 1, [], false]);
  const stored = await f.header(id);
  assert.deepEqual([stored.status, Number(stored.version), Number(stored.total_received_base_quantity), stored.gr_number], ["DRAFT", 1, 0, number]);
  assert.equal(await f.audits(id, "goods_receipt.created"), 1);
  assert.deepEqual([await f.progress(po.id), await f.movements()], [before, movements]);
});

integrationTest("TASK-029 G2 PO 係 DRAFT、CANCELLED、冇未收 Line 或者唔存在都唔可以建 GR（AC-021）", async () => {
  const f = await fixture();
  const draft = await f.order("DRAFT"), cancelled = await f.order("CANCELLED"), closed = await f.order("CONFIRMED", { closedA: true });
  await f.db.query("UPDATE purchase_order_lines SET closed_remaining_base_quantity = 10, has_outstanding = 0, closed_at = ? WHERE id = ?", [Date.now(), closed.lineB]);
  for (const po of [draft, cancelled, closed]) assert.deepEqual(failure(await f.create(po.id)), [409, "PO_STATE_CONFLICT"], String(po.id));
  assert.deepEqual(failure(await f.create(Number.MAX_SAFE_INTEGER)), [404, "PURCHASE_ORDER_NOT_FOUND"]);
});

integrationTest("TASK-029 G3 同一個 eventId 重送就 replay；同 eventId 唔同內容喺 HTTP 層就係 IDEMPOTENCY_CONFLICT", async () => {
  const f = await fixture();
  const po = await f.order("CONFIRMED"), eventId = randomUUID();
  const first = await f.create(po.id, { eventId });
  const again = await f.create(po.id, { eventId });
  assert.deepEqual([again.status, again.body.data.id, again.body.data.number], [201, first.body.data.id, first.body.data.number]);
  assert.deepEqual(failure(await f.create(po.id, { eventId, notes: "唔同內容" })), [409, "IDEMPOTENCY_CONFLICT"]);
});

integrationTest("TASK-029 G4 一條 PO Line 可以跨 UOM、倉、Bin、Status 分拆；完整 replace；PO progress 同 Inventory 不變（AC-022、AC-023、BR-027）", async () => {
  const f = await fixture();
  const po = await f.order("CONFIRMED");
  const { id } = (await f.create(po.id)).body.data;
  const before = await f.progress(po.id), movements = await f.movements();
  const saved = await f.update(id, 1, [
    { purchaseOrderLineId: po.lineA, details: [
      detail(f, { inputUomId: f.box, receivedQuantity: "1.5" }),
      detail(f, { warehouseId: f.w2, binId: f.b2, receivedQuantity: "4" }),
      detail(f, { binId: f.b3, receivedQuantity: "2", stockStatus: "QUARANTINED" })
    ] },
    { purchaseOrderLineId: po.lineB, details: [detail(f, { lotNumber: " LOT-1 ", receivedQuantity: "3" })] }
  ], { supplierDeliveryNote: "DN-G4" });
  assert.deepEqual([saved.status, saved.body.data.status, saved.body.data.version], [200, "DRAFT", 2], JSON.stringify(saved.body));
  const rows = await f.details(id);
  assert.deepEqual(rows.map((row) => [Number(row.purchase_order_line_id), Number(row.received_base_quantity), Number(row.warehouse_id), row.stock_status, row.lot_number]), [
    [po.lineA, 18, f.w1, "AVAILABLE", ""], [po.lineA, 4, f.w2, "AVAILABLE", ""], [po.lineA, 2, f.w1, "QUARANTINED", ""], [po.lineB, 3, f.w1, "AVAILABLE", "LOT-1"]]);
  assert.deepEqual([rows[0].received_quantity, rows[0].warehouse_code_snapshot.startsWith("W"), rows[0].bin_code_snapshot], ["1.500000", true, "B1"]);
  assert.equal(Number((await f.header(id)).total_received_base_quantity), 27);
  const replaced = await f.update(id, 2, [{ purchaseOrderLineId: po.lineB, details: [detail(f, { receivedQuantity: "5" })] }]);
  assert.deepEqual([replaced.status, replaced.body.data.version], [200, 3]);
  assert.deepEqual((await f.details(id)).map((row) => [Number(row.purchase_order_line_id), Number(row.received_base_quantity)]), [[po.lineB, 5]]);
  assert.equal(await f.audits(id, "goods_receipt.updated"), 2);
  assert.deepEqual([await f.progress(po.id), await f.movements()], [before, movements]);
});

integrationTest("TASK-029 G5 外來 PO Line、錯 UOM、Bin 唔屬倉、重複 bucket、0 數量同舊 version 都拒絕，Draft 唔變", async () => {
  const f = await fixture();
  const po = await f.order("CONFIRMED"), other = await f.order("CONFIRMED");
  const { id } = (await f.create(po.id)).body.data;
  const cases = [
    [[{ purchaseOrderLineId: other.lineA, details: [detail(f)] }], 409, "PO_LINE_NOT_RECEIVABLE"],
    [[{ purchaseOrderLineId: po.lineB, details: [detail(f, { inputUomId: f.box })] }], 409, "GR_DETAIL_MISMATCH"],
    [[{ purchaseOrderLineId: po.lineA, details: [detail(f, { binId: f.b2 })] }], 409, "BIN_WAREHOUSE_MISMATCH"],
    [[{ purchaseOrderLineId: po.lineA, details: [detail(f), detail(f, { inputUomId: f.box })] }], 409, "DUPLICATE_RECEIPT_DIMENSION"],
    [[{ purchaseOrderLineId: po.lineA, details: [detail(f, { receivedQuantity: "0" })] }], 400, "PURCHASING_QUANTITY_INVALID"]
  ];
  for (const [lines, status, code] of cases) assert.deepEqual(failure(await f.update(id, 1, lines)), [status, code], code);
  const ok = await f.update(id, 1, [{ purchaseOrderLineId: po.lineA, details: [detail(f)] }]);
  assert.equal(ok.status, 200);
  const stale = await f.update(id, 1, [{ purchaseOrderLineId: po.lineA, details: [detail(f, { receivedQuantity: "9" })] }]);
  assert.deepEqual([stale.status, stale.body.error?.code, stale.body.error?.details?.currentVersion], [409, "VERSION_CONFLICT", 2]);
  assert.deepEqual([Number((await f.header(id)).version), (await f.details(id)).map((row) => Number(row.received_base_quantity))], [2, [1]]);
  assert.equal(await f.audits(id, "goods_receipt.updated", "REJECTED") >= 6, true);
});

integrationTest("TASK-029 G6 Draft 可以存未齊 Confirm 條件嘅 batch；傳去 Inventory 嘅原因超過 500 byte 就拒絕（TL Q3）", async () => {
  const f = await fixture();
  const po = await f.order("CONFIRMED");
  const { id } = (await f.create(po.id)).body.data;
  const incomplete = await f.update(id, 1, [{ purchaseOrderLineId: po.lineB, details: [detail(f)] }]);
  assert.deepEqual([incomplete.status, (await f.details(id))[0].lot_number], [200, ""]);
  const long = await f.update(id, 2, [{ purchaseOrderLineId: po.lineA, skuExceptionReason: "貨".repeat(167), details: [detail(f)] }]);
  assert.deepEqual([...failure(long), long.body.error?.details?.field], [400, "PURCHASING_INPUT_INVALID", "lines.0.skuExceptionReason"]);
  const fits = await f.update(id, 2, [{ purchaseOrderLineId: po.lineA, skuExceptionReason: `${"貨".repeat(166)}ab`, details: [detail(f)] }]);
  assert.equal(fits.status, 200, JSON.stringify(fits.body));
});

integrationTest("TASK-029 G7 取消只限 DRAFT 而且要原因；保留編號；取消後唔可以再改或再取消", async () => {
  const f = await fixture();
  const po = await f.order("CONFIRMED");
  const { id, number } = (await f.create(po.id)).body.data;
  assert.deepEqual(failure(await f.cancel(id, 1, "短")), [400, "PURCHASING_INPUT_INVALID"]);
  const cancelled = await f.cancel(id, 1);
  assert.deepEqual([cancelled.status, cancelled.body.data.status, cancelled.body.data.version, cancelled.body.data.number], [200, "CANCELLED", 2, number]);
  const stored = await f.header(id);
  assert.deepEqual([stored.status, stored.cancel_reason, stored.gr_number], ["CANCELLED", REASON, number]);
  assert.deepEqual(failure(await f.update(id, 2, [])), [409, "GR_STATE_CONFLICT"]);
  assert.deepEqual(failure(await f.cancel(id, 2)), [409, "GR_STATE_CONFLICT"]);
  assert.equal(await f.audits(id, "goods_receipt.cancelled"), 1);
});

integrationTest("TASK-029 G8 冇 receiving.operation 嘅用戶唔可以建立 GR Draft", async () => {
  const f = await fixture();
  const po = await f.order("CONFIRMED");
  assert.equal((await f.create(po.id, { token: f.viewer.token })).status, 403);
});

integrationTest("TASK-029 G9 同 Supplier 近 90 日用過同一個 Delivery Note 只回 warning，唔擋保存（AC-035）", async () => {
  const f = await fixture();
  const po = await f.order("CONFIRMED");
  const note = `DN-${randomUUID().slice(0, 8)}`;
  const first = await f.create(po.id, { supplierDeliveryNote: note });
  assert.deepEqual(first.body.data.warnings, []);
  const second = await f.create(po.id, { supplierDeliveryNote: note });
  assert.deepEqual([second.status, second.body.data.warnings], [201, [{ code: "DUPLICATE_DELIVERY_NOTE", field: "supplierDeliveryNote", count: 1 }]]);
});
