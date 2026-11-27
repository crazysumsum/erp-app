/**
 * TASK-032／TC-006、TC-007：GR Confirm 經真 HTTP、真 JWT、真 MySQL 同真 Inventory batch posting（設計 §3.5、§8.7；AC-036～042）。
 * Fixture（全檔共用一次）：receiver（view＋receiving.operation）、viewer（只有 view）、1 個 Supplier、2 個 SKU
 * （A：tracking none、Base EA＋Purchase BOX×12；B：tracking batch、只有 EA）、2 個倉 3 個 Bin；PO 用 SQL 直接寫。
 * 每案最多 2 張 PO、2 張 GR、2 個 detail。故障注入用同 process 嘅 prototype patch 或者臨時 trigger，案完即還原。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import mysql from "mysql2/promise";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { createTestDevice } from "../../test-support/testDevice.js";
import { hasActiveGoodsReceiptInvoiceInTransaction } from "../../src/modules/accounts-payable/hasActiveGoodsReceiptInvoiceInTransaction.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { issuePurchaseReversalContext } from "../../src/modules/inventory/InventoryPurchaseContext.js";
import { PurchasingAuditService } from "../../src/modules/purchasing/PurchasingAuditService.js";
import { readSupplierInvoiceSourcesInTransaction } from "../../src/modules/purchasing/readSupplierInvoiceSourcesInTransaction.js";
import { PurchasingOperationService } from "../../src/modules/purchasing/PurchasingOperationService.js";
import { ReceiptReversalService } from "../../src/modules/purchasing/ReceiptReversalService.js";
import { readPostedSupplierReturnQuantitiesInTransaction } from "../../src/modules/returns/readPostedSupplierReturnQuantitiesInTransaction.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";

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
    const person = async (suffix, permissions, password) => {
      const name = `gr_confirm_${suffix}_${tag}`, role = await insert("roles", { name, created_at: now });
      cleanups.push(() => db.query("DELETE FROM roles WHERE id = ?", [role]), () => db.query("DELETE FROM role_permissions WHERE role_id = ?", [role]));
      for (const permission of permissions) await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [role, permission]);
      const id = await insert("users", { username: name, password_hash: password ? await hashPassword(password) : "synthetic",
        display_name: `User ${suffix}`, created_at: now, updated_at: now });
      cleanups.push(() => db.query("DELETE FROM users WHERE id = ?", [id]), () => db.query("DELETE FROM fr_token_versions WHERE subject = ?", [String(id)]),
        () => db.query("DELETE FROM user_roles WHERE user_id = ?", [id]));
      await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [id, role]);
      const version = await application.services.require("tokenRevocation").currentVersion(String(id));
      const issue = async (granted, extraClaims) => jwt.issue({ roles: [name], permissions: granted, ...extraClaims },
        { subject: String(id), version, authTime: Math.floor(Date.now() / 1000) });
      return { id, role, name, version, issue, token: await issue(permissions) };
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
    const order = async (status = "CONFIRMED", { minLifeB = null, supplierId = supplier, currencyCode = "HKD", paymentTerm = null } = {}) => {
      const [[{ next }]] = await db.query("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next FROM purchase_orders WHERE document_year_month = ?", [MONTH]);
      const [[vendor]] = await db.query("SELECT supplier_code, supplier_name FROM suppliers WHERE id = ?", [supplierId]);
      const [[currency]] = await db.query("SELECT name, decimal_places FROM currencies WHERE code = ?", [currencyCode]);
      const id = await insert("purchase_orders", { po_number: `PO-${MONTH}-${String(next).padStart(6, "0")}`, document_year_month: MONTH, sequence_no: Number(next),
        supplier_id: supplierId, supplier_code_snapshot: vendor.supplier_code, supplier_name_snapshot: vendor.supplier_name,
        currency_code: currencyCode, currency_name_snapshot: currency.name, currency_decimal_places_snapshot: currency.decimal_places,
        payment_term_id: paymentTerm?.id ?? null, payment_term_snapshot: paymentTerm ? JSON.stringify(paymentTerm.snapshot) : null,
        order_date: "2098-12-01", buyer_id: receiver.id, buyer_label: "Buyer", total_amount: "34.0000", subtotal_amount: "34.0000",
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
    const send = async (path, { token = receiver.token, body, key = body?.eventId, headers }) => {
      const response = await fetch(`${url}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": key,
        "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
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
    const cancel = (id) => send(`/api/v1/goods-receipts/${id}/cancel`,
      { body: { eventId: randomUUID(), version: 1, reason: "Cancelled for P1 functional test" } });
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
    const context = application.services.require("context");
    const transaction = (work, options) => context.storage.run({ databaseTransaction: null }, () => db.withTransaction(work, options));
    return { application, db, cleanups, order, draft, confirm, cancel, lookup, read, send, other, person, overrider, today, skuA, header, details, progress, po, audits, stock,
      receiver, viewer, supplier, each, box, w1, w2, b1, b2, b3, insert, tag, transaction };
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

async function reversalRaceFixture(f) {
  const order = await f.order(), id = await f.draft(order.id);
  const accepted = await f.confirm(id, 1, [{ purchaseOrderLineId: order.lineA, details: [detail(f, { inputUomId: f.box })] }]);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const [[source]] = await f.db.query(`SELECT d.id, d.goods_receipt_line_id, d.inventory_movement_id, g.supplier_code_snapshot, g.supplier_name_snapshot
    FROM goods_receipt_details d JOIN goods_receipts g ON g.id = d.goods_receipt_id WHERE g.id = ?`, [id]);
  const permissions = ["purchasing.view", "inventory.adjust"];
  const user = await f.person(`gr_race_${id}`, permissions);
  const claims = { sub: String(user.id), roles: [user.name], permissions };
  const operations = new PurchasingOperationService();
  const reversal = new ReceiptReversalService({
    database: f.db, operations, time: f.application.services.require("time"), logger: f.application.services.require("logging").logger,
    audit: new PurchasingAuditService({ auditDetailMaxBytes: 8192 }), hasActiveInvoice: hasActiveGoodsReceiptInvoiceInTransaction,
    readReturnedQuantities: readPostedSupplierReturnQuantitiesInTransaction,
    postInventory: () => assert.fail("A concurrently occupied quantity must be rejected before Inventory")
  });
  const input = { eventId: randomUUID(), version: 2, reason: "更正重複入庫記錄",
    details: [{ goodsReceiptDetailId: Number(source.id), baseQuantity: 2 }] };
  return { id, order, source, claims, operations, reversal, input };
}

/** Give the contender a real RR snapshot, then start the conflicting PO lock before the writer commits. */
async function assertConcurrentReversalRejected(f, receipt, countOccupancy, writeOccupancy, code) {
  const { order, id, claims, input, operations, reversal } = receipt;
  const writerLocked = Promise.withResolvers(), contenderWaiting = Promise.withResolvers();
  const writer = f.db.context.storage.run({}, () => f.db.withTransaction(async tx => {
    await tx.query("SELECT id FROM purchase_orders WHERE id = ? FOR UPDATE", [order.id]);
    await tx.query("SELECT id FROM goods_receipts WHERE id = ? FOR SHARE", [id]);
    writerLocked.resolve();
    await contenderWaiting.promise;
    await writeOccupancy(tx);
  }, { isolationLevel: "READ COMMITTED" }));
  writer.catch(writerLocked.reject);
  const run = operations.run.bind(operations);
  operations.run = (database, work) => run(database, async tx => {
    assert.equal(await countOccupancy(tx), 0);
    const query = tx.query.bind(tx);
    tx.query = (sql, params) => {
      const pending = query(sql, params);
      if (sql === "SELECT id, status, version FROM purchase_orders WHERE id = ? FOR UPDATE") contenderWaiting.resolve();
      return pending;
    };
    try {
      return await work(tx);
    } catch (error) {
      assert.equal(await countOccupancy(tx), 0, "the original RR snapshot does not see the committed occupancy");
      throw error;
    } finally { delete tx.query; }
  });
  const before = await snapshot(f, order);
  let attempt;
  try {
    await writerLocked.promise;
    attempt = f.db.context.storage.run({}, () => reversal.create({ id, claims, input }));
    await assert.rejects(attempt, { code });
    await writer;
    assert.equal(await countOccupancy(f.db), 1);
    assert.deepEqual(await snapshot(f, order), before);
    assert.equal((await f.header(id)).status, "CONFIRMED");
  } finally {
    contenderWaiting.resolve();
    await Promise.allSettled([writer, attempt]);
    operations.run = run;
  }
}

integrationTest("沖銷等採購單鎖期間提交應付佔用時，以真 AP 當前讀取拒絕沖銷", async () => {
  const f = await fixture(), receipt = await reversalRaceFixture(f);
  const { id, source } = receipt;
  const invoiceCode = `REV-${randomUUID()}`, now = Date.now();
  const invoiceId = await f.insert("ap_invoices", { status: "DRAFT", supplier_id: f.supplier, supplier_code_snapshot: source.supplier_code_snapshot,
    supplier_name_snapshot: source.supplier_name_snapshot, currency_code: "HKD", currency_decimal_places: 2, supplier_invoice_number: invoiceCode,
    active_supplier_invoice_key: invoiceCode, invoice_date: RECEIPT_DATE, due_date: RECEIPT_DATE, total_amount: 12, outstanding_amount: 12,
    created_at: now, updated_at: now, created_by_label: "fixture" });
  const count = async tx => Number((await tx.query("SELECT COUNT(*) AS total FROM ap_invoice_lines WHERE invoice_id = ?", [invoiceId]))[0][0].total);
  const occupy = tx => tx.query(`INSERT INTO ap_invoice_lines
    (invoice_id, line_no, line_type, goods_receipt_id, goods_receipt_line_id, active_goods_receipt_line_id, quantity, line_amount)
    VALUES (?, 1, 'RECEIPT', ?, ?, ?, 12, 12)`, [invoiceId, id, source.goods_receipt_line_id, source.goods_receipt_line_id]);
  await assertConcurrentReversalRejected(f, receipt, count, occupy, "GR_REVERSAL_INVOICED");
});

integrationTest("沖銷等採購單鎖期間提交退供已過帳行時，以真 Returns 當前讀取限制沖銷數量", async () => {
  const f = await fixture(), receipt = await reversalRaceFixture(f);
  const { id, order, source, claims, reversal } = receipt, now = Date.now();
  const returnId = await f.insert("supplier_returns", { goods_receipt_id: id, purchase_order_id: order.id, supplier_id: f.supplier,
    supplier_code_snapshot: source.supplier_code_snapshot, supplier_name_snapshot: source.supplier_name_snapshot, return_date: RECEIPT_DATE,
    reason: "私人測試退供行", created_by_label: "fixture", created_at: now, updated_at: now });
  const count = async tx => Number((await tx.query(`SELECT COUNT(*) AS total FROM supplier_return_lines
    WHERE return_id = ? AND inventory_movement_id IS NOT NULL`, [returnId]))[0][0].total);
  const occupy = async tx => {
    await tx.query(`INSERT INTO supplier_return_lines
      (return_id, goods_receipt_id, line_no, goods_receipt_detail_id, base_quantity, bin_id, stock_status, inventory_movement_id)
      VALUES (?, ?, 1, ?, 11, ?, 'AVAILABLE', ?)`, [returnId, id, source.id, f.b1, source.inventory_movement_id]);
    await tx.query("UPDATE supplier_returns SET status = 'POSTED', posted_event_id = ?, posted_at = ?, version = 2 WHERE id = ?",
      [randomUUID(), now, returnId]);
  };
  await assertConcurrentReversalRejected(f, receipt, count, occupy, "GR_REVERSAL_QUANTITY_EXCEEDED");
  const result = await f.db.context.storage.run({}, () => reversal.preview({ id, claims }));
  assert.deepEqual(result, { version: 2, details: [{ id: Number(source.id), remainingBaseQuantity: "1" }] });
  assert.equal((await f.read(`/api/v1/goods-receipts/${id}/reversals/preview`, f.viewer.token)).status, 403);
});

// Pause the HTTP request that acquired the PO lock until the other sends its own
// locking query. Both queries still go to MySQL through the production services.
async function postInLockOrder(f, orderId, first, second) {
  const statements = {
    reversal: "SELECT id, status, version FROM purchase_orders WHERE id = ? FOR UPDATE",
    supplier: "SELECT id, supplier_id FROM purchase_orders WHERE id = ? FOR UPDATE"
  };
  const firstLocked = Promise.withResolvers(), secondWaiting = Promise.withResolvers();
  let sawSecondLock = false;
  const transact = f.db.withTransaction;
  f.db.withTransaction = (work, options) => transact.call(f.db, async (tx, context) => {
    const query = tx.query.bind(tx);
    tx.query = async (sql, params) => {
      const pending = query(sql, params);
      if (Number(params?.[0]) !== orderId) return pending;
      if (sql === statements[first.kind]) {
        const rows = await pending;
        firstLocked.resolve();
        await secondWaiting.promise;
        return rows;
      }
      if (sql === statements[second.kind]) {
        sawSecondLock = true;
        secondWaiting.resolve();
      }
      return pending;
    };
    try { return await work(tx, context); }
    finally { delete tx.query; }
  }, options);
  const winner = first.post().finally(firstLocked.resolve);
  const contender = firstLocked.promise.then(second.post).finally(secondWaiting.resolve);
  try {
    const results = await Promise.all([winner, contender]);
    assert.ok(sawSecondLock, JSON.stringify(results));
    return results;
  } finally {
    await Promise.allSettled([winner, contender]);
    f.db.withTransaction = transact;
  }
}

for (const winnerKind of ["reversal", "supplier"]) {
  integrationTest(`真 HTTP 收貨沖銷與退供競爭，${winnerKind} 先鎖單時合計仍不超實收`, async () => {
    const f = await fixture(), order = await f.order(), id = await f.draft(order.id);
    const confirmed = await f.confirm(id, 1, [{ purchaseOrderLineId: order.lineA, details: [detail(f, { inputUomId: f.box })] }]);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const [[source]] = await f.db.query("SELECT id, inventory_movement_id FROM goods_receipt_details WHERE goods_receipt_id = ?", [id]);
    const before = await f.stock();

    const password = `Synthetic-${randomUUID()}-A1!`;
    const adjust = ["purchasing.view", "inventory.adjust"];
    const actor = await f.person(`race_reversal_${id}`, adjust, password), device = await createTestDevice();
    const deviceRow = await f.insert("user_devices", { user_id: actor.id, device_id: device.deviceId, public_key: device.publicKeyDer,
      status: "approved", requested_at: Date.now() });
    f.cleanups.push(() => f.db.query("DELETE FROM user_devices WHERE id = ?", [deviceRow]));
    const token = await actor.issue(adjust, { did: device.deviceId });
    const supplier = await f.person(`race_returns_${id}`, ["returns.view", "returns.supplier.mgmt"]);
    const draftReturn = async amount => {
      const response = await f.send("/api/v1/supplier-returns", { token: supplier.token, body: {
        eventId: randomUUID(), sourceId: String(id), returnDate: RECEIPT_DATE, reason: "私人整合測試退供",
        lines: [{ sourceDetailId: String(source.id), baseQuantity: String(amount), binId: String(f.b1), stockStatus: "AVAILABLE" }]
      } });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body.data.id;
    };
    const supplierDraft = await draftReturn(8);
    const postReturn = returnId => f.send(`/api/v1/supplier-returns/${returnId}/post`, { token: supplier.token,
      body: { eventId: randomUUID(), version: 1 } });
    const postReversal = async amount => {
      const path = `/api/v1/goods-receipts/${id}/reversals/create`;
      const body = { eventId: randomUUID(), version: 2, reason: "更正重複入庫記錄", password,
        details: [{ goodsReceiptDetailId: Number(source.id), baseQuantity: amount }] };
      const headers = await device.headers({ method: "POST", path, body: JSON.stringify(body), token });
      return f.send(path, { token, body, headers });
    };
    const commands = [{ kind: "reversal", post: () => postReversal(8) }, { kind: "supplier", post: () => postReturn(supplierDraft) }];
    if (winnerKind === "supplier") commands.reverse();

    const [posted, blocked] = await postInLockOrder(f, order.id, ...commands);
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.body.error.code, winnerKind === "reversal" ? "RETURN_QUANTITY_EXCEEDED" : "GR_REVERSAL_QUANTITY_EXCEEDED");
    assert.deepEqual(await f.stock(), [before[0] + 1, before[1] - 8]);
    const remainder = winnerKind === "reversal" ? await postReturn(await draftReturn(4)) : await postReversal(4);
    assert.equal(remainder.status, 200, JSON.stringify(remainder.body));
    assert.deepEqual(await f.stock(), [before[0] + 2, before[1] - 12]);

    const [[receipt]] = await f.db.query("SELECT status, total_received_base_quantity, total_reversed_base_quantity FROM goods_receipts WHERE id = ?", [id]);
    const [[returned]] = await f.db.query(`SELECT SUM(l.base_quantity) AS quantity FROM supplier_return_lines l
      JOIN supplier_returns r ON r.id = l.return_id WHERE l.goods_receipt_detail_id = ? AND r.status = 'POSTED' AND l.inventory_movement_id IS NOT NULL`, [source.id]);
    assert.deepEqual([receipt.status, Number(receipt.total_received_base_quantity), Number(receipt.total_reversed_base_quantity), Number(returned.quantity)],
      ["PARTIALLY_REVERSED", 12, winnerKind === "reversal" ? 8 : 4, winnerKind === "reversal" ? 4 : 8]);
    const [costs] = await f.db.query(`SELECT m.direction, m.quantity, e.entry_kind, e.value_delta_hkd
      FROM inventory_cost_entries e JOIN inventory_movements m ON e.movement_id = m.id
      WHERE e.original_entry_id = (SELECT id FROM inventory_cost_entries WHERE movement_id = ?) ORDER BY m.id`, [source.inventory_movement_id]);
    const kinds = winnerKind === "reversal" ? ["RECEIPT_REVERSAL", "SUPPLIER_RETURN"] : ["SUPPLIER_RETURN", "RECEIPT_REVERSAL"];
    assert.deepEqual(costs.map(row => [row.direction, Number(row.quantity), row.entry_kind, row.value_delta_hkd]),
      [["OUT", 8, kinds[0], "-0.6667"], ["OUT", 4, kinds[1], "-0.3333"]]);
  });
}

integrationTest("收貨沖銷部分與全部過帳可重送，已開票或退回超限時拒絕，稽核失敗整筆回滾", async () => {
  const f = await fixture();
  const poRow = await f.order(), id = await f.draft(poRow.id);
  const receiptLines = twoLines(f, poRow);
  receiptLines[0].details[0].receivedQuantity = "2";
  const confirmed = await f.confirm(id, 1, receiptLines);
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal((await f.po(poRow.id)).status, "FULLY_RECEIVED");
  const [source] = await f.db.query("SELECT id FROM goods_receipt_details WHERE goods_receipt_id = ? ORDER BY id", [id]);
  const [detailA, detailB] = source.map(row => Number(row.id));

  const permissions = ["purchasing.view", "inventory.adjust"], holder = await f.person("reversal", permissions);
  const time = f.application.services.require("time"), context = f.application.services.require("context");
  const logger = f.application.services.require("logging").logger, authTime = Math.floor(time.nowMs() / 1000);
  const did = randomUUID().replaceAll("-", "").repeat(2), key = Buffer.from("Synthetic service-level reversal fixture");
  const device = await f.insert("user_devices", { user_id: holder.id, device_id: did, public_key: key, status: "approved", requested_at: time.nowMs() });
  f.cleanups.push(() => f.db.query("DELETE FROM user_devices WHERE id = ?", [device]));
  const inventory = new InventoryPostingService({ database: f.db, logger, time });
  const audit = new PurchasingAuditService({ auditDetailMaxBytes: 8192 });
  let invoiced = false, returned = "0", injectAuditFailure = false, postingCalls = 0;
  const operations = new PurchasingOperationService();
  const reversal = new ReceiptReversalService({
    database: f.db, logger, time, operations,
    audit: { record: (...args) => {
      if (injectAuditFailure) throw new Error("Synthetic reversal audit failure");
      return audit.record(...args);
    }, recordRejected: (...args) => audit.recordRejected(...args) },
    hasActiveInvoice: async () => invoiced,
    readReturnedQuantities: async (_tx, { goodsReceiptDetailIds }) => new Map(goodsReceiptDetailIds.map(key => [key, returned])),
    postInventory: (tx, req, command, ownerProof) => {
      postingCalls += 1;
      command.context = issuePurchaseReversalContext(req, tx, command, { database: f.db, time, ownerProof,
        sessionMaxAgeSeconds: 86400, clockToleranceSeconds: 0, signatureMaxSkewSeconds: 300 });
      return inventory.reversePurchaseReceiptBatchInTransaction(tx, command);
    }
  });
  const submit = (input) => {
    const apiRoute = { path: "/api/v1/goods-receipts/:id/reversals/create", authType: "jwt-device-password" };
    const claims = { sub: String(holder.id), roles: [holder.name], permissions, ver: holder.version, did, exp: authTime + 3600, auth_time: authTime };
    const auth = { type: apiRoute.authType, claims, deviceBinding: { id: device, user_id: holder.id, device_id: did, public_key: key, status: "approved" } };
    const requestContext = { auth, apiRoute, databaseTransaction: null };
    const req = { context: requestContext, auth, apiRoute, method: "POST", input: { params: { id: String(id) } }, get: () => String(time.nowMs()) };
    return context.storage.run(requestContext, () => reversal.create({ id, claims, input, req }));
  };
  const body = (version, details) => ({ version, details, eventId: randomUUID(), reason: "更正重複入庫記錄" });
  const partial = body(2, [{ goodsReceiptDetailId: detailA, baseQuantity: 2 }]);
  const before = await snapshot(f, poRow);
  invoiced = true;
  await assert.rejects(() => submit(partial), { code: "GR_REVERSAL_INVOICED" });
  invoiced = false;
  returned = "23";
  await assert.rejects(() => submit(partial), { code: "GR_REVERSAL_QUANTITY_EXCEEDED" });
  assert.equal(postingCalls, 0);
  returned = "0";
  injectAuditFailure = true;
  await assert.rejects(() => submit(partial), error => error.cause?.message === "Synthetic reversal audit failure");
  assert.deepEqual(await snapshot(f, poRow), before);
  assert.equal((await f.header(id)).status, "CONFIRMED");
  injectAuditFailure = false;

  const posted = await submit(partial);
  assert.deepEqual([posted.number, posted.status, posted.version, posted.replayed], [`${confirmed.body.data.number}-R01`, "POSTED", 3, false]);
  assert.deepEqual([await f.progress(poRow.id), (await f.header(id)).status, (await f.po(poRow.id)).status],
    [[[24, 22, 1, 0], [10, 10, 0, 0]], "PARTIALLY_REVERSED", "PARTIALLY_RECEIVED"]);
  assert.deepEqual(await submit(partial), { ...posted, replayed: true });
  await assert.rejects(() => submit({ ...partial, reason: "同一操作但內容改變" }), { code: "PURCHASING_EVENT_CONFLICT" });
  assert.equal((await f.lookup(partial.eventId, holder.token)).body.data?.resultType, "REVERSAL");
  assert.equal((await f.lookup(partial.eventId, f.viewer.token)).status, 404);
  const afterFull = await submit(body(3, [{ goodsReceiptDetailId: detailA, baseQuantity: 22 }, { goodsReceiptDetailId: detailB, baseQuantity: 10 }]));
  assert.deepEqual([afterFull.number, (await f.header(id)).status, (await f.po(poRow.id)).status, postingCalls],
    [`${confirmed.body.data.number}-R02`, "REVERSED", "CONFIRMED", 3]);
  assert.equal(Number((await f.po(poRow.id)).has_confirmed_receipt), 1);
  const [rows] = await f.db.query(`SELECT r.reversal_reference, d.original_inventory_movement_id, m.direction, m.movement_type
    FROM goods_receipt_reversals r JOIN goods_receipt_reversal_details d ON d.reversal_id = r.id
    JOIN inventory_movements m ON m.id = d.reversal_inventory_movement_id WHERE r.goods_receipt_id = ? ORDER BY r.reversal_sequence, d.id`, [id]);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.direction === "OUT" && row.movement_type === "REVERSAL"));
  await assert.rejects(f.db.query("UPDATE goods_receipt_reversals SET reason = 'altered' WHERE id = ?", [posted.id]),
    error => error.cause?.sqlState === "45000");
});

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

integrationTest("Goods receipt confirmation posts stock over HTTP with a 190-code-point Unicode role", async () => {
  const f = await fixture(), permissions = ["purchasing.view", "receiving.operation"];
  const actor = await f.person("unicode", permissions);
  const role = "倉".repeat(189) + "𠮷";
  await f.db.execute("UPDATE roles SET name=? WHERE id=?", [role, actor.role]);
  const token = await actor.issue(permissions, { roles: [role] });
  const po = await f.order(), id = await f.draft(po.id), [moves, onHand] = await f.stock();

  const result = await f.confirm(id, 1, [{ purchaseOrderLineId: po.lineA, details: [detail(f)] }], { token });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal((await f.header(id)).status, "CONFIRMED");
  const [posted] = await f.details(id);
  assert.ok(posted.inventory_movement_id != null && posted.inventory_operation_request_id != null);
  assert.deepEqual(await f.stock(), [moves + 1, onHand + 1]);
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

integrationTest("TASK-032 C5 Inventory 結果少一行或多一行、Audit 失敗、PO progress 失敗都令真實 Inventory 寫入一齊 rollback", async (t) => {
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

  // Binary logging requires the fixture administrator for trigger DDL. The HTTP application keeps its own DB account.
  assert.ok(process.env.DB_ADMIN_USER, "DB_ADMIN_USER is required for the rollback trigger fixture");
  const ddl = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET_PATH, database: process.env.DB_NAME, user: process.env.DB_ADMIN_USER, password: process.env.DB_ADMIN_PASSWORD });
  t.after(() => ddl.end());
  await ddl.query(`CREATE TRIGGER test_gr_confirm_progress_failure BEFORE UPDATE ON purchase_order_lines FOR EACH ROW
    BEGIN IF NEW.id = ${Number(poRow.lineB)} AND NEW.gross_received_base_quantity <> OLD.gross_received_base_quantity THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Synthetic PO progress failure'; END IF; END`);
  try {
    assert.equal((await f.confirm(id, 1, twoLines(f, poRow))).status, 500);
  } finally { await ddl.query("DROP TRIGGER test_gr_confirm_progress_failure"); }
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

integrationTest("P1 收貨清單以供應商、採購單及狀態合併篩選，回傳採購單幣別", async () => {
  const f = await fixture();
  const poRow = await f.order();
  const id = await f.draft(poRow.id);
  const base = `/api/v1/goods-receipts?purchaseOrderId=${poRow.id}&status=DRAFT&pageSize=1`;
  const selected = await f.read(`${base}&supplierId=${f.supplier}`, f.viewer.token);
  assert.equal(selected.status, 200, JSON.stringify(selected.body));
  const { total, items } = selected.body.data;
  assert.deepEqual([total, items.map(item => [item.id, item.currencyCode])], [1, [[id, "HKD"]]]);
  assert.equal((await f.read(`${base}&supplierId=${Number.MAX_SAFE_INTEGER}`)).body.data.total, 0);
  assert.deepEqual(failure(await f.read(`${base}&supplierId=0`)), [400, "PURCHASING_INPUT_INVALID", "supplierId"]);
  const unauthorized = await f.person("no_purchasing", []);
  assert.equal((await f.read(`${base}&supplierId=${f.supplier}`, unauthorized.token)).status, 403);
});

integrationTest("P1 發票來源讀取確認收貨快照，序列化採購單及收貨鎖，拒絕不合資格的整批來源", async () => {
  const f = await fixture();
  const now = Date.now();
  const term = { code: `AP-${f.tag}`, name: "On purchase order", calculationType: "NET_DAYS", dueDays: 30 };
  const termId = await f.insert("payment_terms", { code: term.code, code_key: term.code.toLowerCase(), name: term.name,
    calculation_type: term.calculationType, due_days: term.dueDays, status: "ACTIVE", version: 1, created_at: now, updated_at: now });
  const poRow = await f.order("CONFIRMED", { paymentTerm: { id: termId, snapshot: term } });
  const olderOrder = await f.order();
  const olderReceipt = String(await f.draft(olderOrder.id));
  const receiptId = String(await f.draft(poRow.id));
  const rc = { isolationLevel: "READ COMMITTED" };
  const read = goodsReceiptIds => f.transaction(tx => readSupplierInvoiceSourcesInTransaction(tx, { goodsReceiptIds }), rc);
  await assert.rejects(() => read([receiptId]), { code: "GR_STATE_CONFLICT" });
  for (const ids of [[], [receiptId, receiptId], [Number(receiptId)], ["18446744073709551616"], Array.from({ length: 21 }, (_, i) => String(i + 1))]) {
    await assert.rejects(() => read(ids), { code: "PURCHASING_INPUT_INVALID" });
  }
  await assert.rejects(() => read(["18446744073709551615"]), { code: "GOODS_RECEIPT_NOT_FOUND" });
  await assert.rejects(() => f.transaction(tx => readSupplierInvoiceSourcesInTransaction(tx, { goodsReceiptIds: [receiptId] })),
    error => error.cause instanceof TypeError);

  const first = twoLines(f, poRow);
  first[0].details[0].receivedQuantity = "2";
  const confirmed = await f.confirm(receiptId, 1, first);
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal((await f.po(poRow.id)).status, "FULLY_RECEIVED");
  const second = await f.confirm(olderReceipt, 1, twoLines(f, olderOrder));
  assert.equal(second.status, 200, JSON.stringify(second.body));
  await f.db.query("UPDATE payment_terms SET name = ?, due_days = 60 WHERE id = ?", ["Changed master term", termId]);

  let closedTransaction;
  await f.transaction(async tx => {
    closedTransaction = tx;
    const [older, source] = await readSupplierInvoiceSourcesInTransaction(tx, { goodsReceiptIds: [receiptId, olderReceipt] });
    assert.deepEqual([older.id, older.paymentTerm, source.id, source.number, source.businessReceiptDate, source.purchaseOrderId, source.supplierId,
      source.currencyCode, source.currencyDecimalPlaces, source.paymentTerm], [olderReceipt, null, receiptId, confirmed.body.data.number, RECEIPT_DATE,
      String(poRow.id), String(f.supplier), "HKD", 2, { id: String(termId), ...term }]);
    assert.deepEqual(source.lines.map(line => [line.lineNumber, line.purchaseOrderLineId, line.toBaseFactor, line.receivedBaseQuantity, line.unitPrice]),
      [[1, String(poRow.lineA), 12, "24", "1.0000"], [2, String(poRow.lineB), 1, "10", "1.0000"]]);
    assert.deepEqual([source.lines[0].skuId, source.lines[0].baseUomCodeSnapshot, source.lines[0].purchaseUomCodeSnapshot],
      [String(f.skuA), `E${f.tag}`, `X${f.tag}`]);

    for (const [sql, id] of [
      ["SELECT id FROM purchase_orders WHERE id = ? FOR UPDATE NOWAIT", poRow.id],
      ["SELECT id FROM purchase_orders WHERE id = ? FOR UPDATE NOWAIT", olderOrder.id],
      ["SELECT id FROM goods_receipts WHERE id = ? FOR UPDATE NOWAIT", receiptId]
    ]) {
      await assert.rejects(() => f.transaction(other => other.query(sql, [id])), error => error.cause?.code === "ER_LOCK_NOWAIT");
    }
  }, rc);
  await assert.rejects(() => readSupplierInvoiceSourcesInTransaction(closedTransaction, { goodsReceiptIds: [receiptId] }), TypeError);

  const draft = String(await f.draft(olderOrder.id));
  await assert.rejects(() => read([receiptId, draft]), { code: "GR_STATE_CONFLICT" });
  const cancelled = await f.cancel(draft);
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  await assert.rejects(() => read([receiptId, draft]), { code: "GR_STATE_CONFLICT" });
  const otherSupplier = await f.insert("suppliers", { supplier_code: `OTHER-${f.tag}`, supplier_code_key: `other-${f.tag}`, supplier_name: "Other supplier",
    supplier_name_key: "other supplier", default_currency_code: "HKD", status: "active", created_at: now, updated_at: now });
  const otherPo = await f.order("CONFIRMED", { supplierId: otherSupplier });
  const otherReceipt = String(await f.draft(otherPo.id));
  const otherConfirmation = await f.confirm(otherReceipt, 1, twoLines(f, otherPo));
  assert.equal(otherConfirmation.status, 200, JSON.stringify(otherConfirmation.body));
  await assert.rejects(() => read([receiptId, otherReceipt]), { code: "GR_INVOICE_SOURCE_MISMATCH" });
  const filtered = await f.read(`/api/v1/goods-receipts?supplierId=${otherSupplier}&status=CONFIRMED&pageSize=1`);
  assert.deepEqual([filtered.body.data.total, filtered.body.data.items.map(item => String(item.id))], [1, [otherReceipt]]);

  await f.db.query("INSERT IGNORE INTO currencies (code, name, decimal_places, status, version, created_at, updated_at) VALUES ('BMD', 'Bermudian Dollar', 2, 'ACTIVE', 1, ?, ?)", [now, now]);
  const otherCurrencyPo = await f.order("CONFIRMED", { currencyCode: "BMD" });
  const otherCurrencyReceipt = String(await f.draft(otherCurrencyPo.id));
  // 合成成本啟用前的歷史外幣收貨，只供來源幣別檢查。
  await f.transaction(async (tx) => {
    await tx.query(`INSERT INTO goods_receipt_lines (goods_receipt_id, purchase_order_id, purchase_order_line_id, line_number,
      sku_id, sku_code_snapshot, sku_name_snapshot, received_base_quantity, created_at, updated_at)
      SELECT ?, purchase_order_id, id, line_number, sku_id, sku_code_snapshot, sku_name_snapshot, 1, ?, ?
      FROM purchase_order_lines WHERE id = ?`, [otherCurrencyReceipt, now, now, otherCurrencyPo.lineA]);
    await tx.query(`UPDATE goods_receipts SET status = 'CONFIRMED', version = 2, total_received_base_quantity = 1,
      supplier_status_at_confirm = 'active', confirmed_at = ?, confirm_event_id = ? WHERE id = ?`, [now, randomUUID(), otherCurrencyReceipt]);
  });
  const [historicalSource] = await read([otherCurrencyReceipt]);
  assert.equal(historicalSource.currencyCode, "BMD");
  await assert.rejects(() => read([receiptId, otherCurrencyReceipt]), { code: "GR_INVOICE_SOURCE_MISMATCH" });
  const otherCurrencyList = await f.read(`/api/v1/goods-receipts?purchaseOrderId=${otherCurrencyPo.id}&supplierId=${f.supplier}&status=CONFIRMED`);
  assert.deepEqual(otherCurrencyList.body.data.items.map(item => [String(item.id), item.currencyCode]), [[otherCurrencyReceipt, "BMD"]]);
});

integrationTest("部分沖銷後應付來源只取正淨量，省略全數沖銷行並拒絕整張已沖銷", async () => {
  const f = await fixture();
  const order = await f.order(), id = await f.draft(order.id);
  assert.equal((await f.confirm(id, 1, twoLines(f, order))).status, 200);
  const read = () => f.transaction(tx => readSupplierInvoiceSourcesInTransaction(tx, { goodsReceiptIds: [String(id)] }),
    { isolationLevel: "READ COMMITTED" });
  const [original] = await read();
  // Applied reversal projections are the Purchasing contract. The reversal service verifies actual inventory posting separately.
  await f.db.query(`UPDATE goods_receipt_details SET reversed_base_quantity =
    CASE WHEN purchase_order_line_id = ? THEN 2 ELSE received_base_quantity END WHERE goods_receipt_id = ?`, [order.lineA, id]);
  await f.db.query("UPDATE goods_receipts SET status = 'PARTIALLY_REVERSED', total_reversed_base_quantity = 12 WHERE id = ?", [id]);
  const [net] = await read();
  assert.deepEqual(net.lines, [{ ...original.lines[0], receivedBaseQuantity: "10" }]);
  const listed = await f.read(`/api/v1/goods-receipts?status=PARTIALLY_REVERSED&purchaseOrderId=${order.id}`);
  assert.deepEqual(listed.body.data.items.map(item => [item.id, item.status]), [[id, "PARTIALLY_REVERSED"]]);
  await f.db.query("UPDATE goods_receipts SET total_reversed_base_quantity = 13 WHERE id = ?", [id]);
  await assert.rejects(() => read(), { code: "PURCHASING_DEPENDENCY_UNAVAILABLE" });
  await f.db.query("UPDATE goods_receipt_details SET reversed_base_quantity = received_base_quantity WHERE goods_receipt_id = ?", [id]);
  await f.db.query("UPDATE goods_receipts SET status = 'REVERSED', total_reversed_base_quantity = 22 WHERE id = ?", [id]);
  await assert.rejects(() => read(), { code: "GR_STATE_CONFLICT" });
});

integrationTest("收貨頁面選項：可收貨 PO（q 篩）、Active 倉、倉內 Active Bin；停用 Bin 唔出；冇 receiving.operation 403", async () => {
  const f = await fixture();
  const open = await f.order(), draftPo = await f.order("DRAFT");
  const pos = (await f.read("/api/v1/receiving-lookups/purchase-orders")).body.data.items.map((item) => item.id);
  assert.ok(pos.includes(open.id) && !pos.includes(draftPo.id));
  const [[{ po_number: number }]] = await f.db.query("SELECT po_number FROM purchase_orders WHERE id = ?", [open.id]);
  assert.deepEqual((await f.read(`/api/v1/receiving-lookups/purchase-orders?q=${number}`)).body.data.items.map((item) => item.id), [open.id]);
  assert.ok((await f.read("/api/v1/receiving-lookups/warehouses")).body.data.items.some((item) => item.id === f.w1));
  await f.db.query("UPDATE inventory_bins SET status = 'INACTIVE' WHERE id = ?", [f.b3]);
  try {
    const bins = (await f.read(`/api/v1/receiving-lookups/warehouses/${f.w1}/bins`)).body.data.items.map((item) => item.id);
    assert.ok(bins.includes(f.b1) && !bins.includes(f.b3) && !bins.includes(f.b2));
  } finally { await f.db.query("UPDATE inventory_bins SET status = 'ACTIVE' WHERE id = ?", [f.b3]); }
  assert.equal((await f.read("/api/v1/receiving-lookups/warehouses", f.viewer.token)).status, 403);
});
