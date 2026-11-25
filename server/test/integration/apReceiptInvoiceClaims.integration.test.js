import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hasActiveGoodsReceiptInvoiceInTransaction } from "../../src/modules/accounts-payable/hasActiveGoodsReceiptInvoiceInTransaction.js";
import { ADMIN, runRunner, scratchDatabase } from "./supplierScratchDatabase.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const businessDate = "2026-11-24", month = "202611";

async function receiptFixture(t) {
  // Confirmed receipt sources are immutable. Drop only this test's scratch schema at teardown.
  let cleanScratch;
  let stopApplication = () => {};
  const { name } = await scratchDatabase({ after: (callback) => { cleanScratch = callback; } });
  t.after(async () => {
    try { await stopApplication(); }
    finally { await cleanScratch?.(); }
  });
  await runRunner(name);
  const source = defaultConfigurationSource();
  const application = await createApplication({ configurationSource: {
    ...source, database: { ...source.database, ...ADMIN, socketPath: undefined, database: name }
  } });
  stopApplication = () => application.shutdown("ap_invoice_claims_test_complete");
  const db = application.services.require("mysqldatabase");
  const code = "CLAIM-" + randomUUID().slice(0, 8), now = Date.now();
  const dates = { created_at: now, updated_at: now };
  const insert = async (table, values) => {
    const [result] = await db.query("INSERT INTO " + table + " SET ?", [values]);
    return String(result.insertId);
  };
  const supplier = await insert("suppliers", { supplier_code: code, supplier_code_key: code.toLowerCase(),
    supplier_name: code, supplier_name_key: code.toLowerCase(), status: "active", default_currency_code: "HKD", ...dates });
  const item = await insert("items", { name: code, status: "active", ...dates });
  const sku = await insert("item_skus", { item_id: item, sku_code: code, sku_name: code,
    status: "active", purchasable: 1, inventory_tracked: 1, tracking_policy: "none", ...dates });
  const uom = await insert("item_uoms", { code, name: "Each", ...dates });
  const skuUom = await insert("item_sku_uoms", { sku_id: sku, uom_id: uom, to_base_factor: 1, is_base: 1, ...dates });
  const party = { supplier_id: supplier, supplier_code_snapshot: code, supplier_name_snapshot: code };
  const actors = { created_by_label: "fixture", updated_by_label: "fixture" };
  const order = await insert("purchase_orders", {
    ...party, ...actors, ...dates, po_number: "PO-" + month + "-000001", document_year_month: month, sequence_no: 1,
    order_date: businessDate, buyer_label: "fixture", currency_code: "HKD", currency_name_snapshot: "HKD",
    currency_decimal_places_snapshot: 2, total_amount: "10", subtotal_amount: "10"
  });
  const orderLine = await insert("purchase_order_lines", {
    purchase_order_id: order, line_number: 1, sku_id: sku, sku_code_snapshot: code, sku_name_snapshot: code,
    inventory_tracked_snapshot: 1, tracking_policy_snapshot: "none",
    base_uom_id: uom, base_uom_code_snapshot: code, purchase_sku_uom_id: skuUom, purchase_uom_code_snapshot: code,
    uom_to_base_factor_snapshot: 1, ordered_quantity: 1, ordered_base_quantity: 1, unit_price: 10, line_amount: 10, ...dates
  });
  const goodsReceiptId = await insert("goods_receipts", {
    ...party, ...actors, ...dates, gr_number: "GR-" + month + "-000001", document_year_month: month, sequence_no: 1,
    purchase_order_id: order, business_receipt_date: businessDate, total_received_base_quantity: 1
  });
  const receiptLine = await insert("goods_receipt_lines", { goods_receipt_id: goodsReceiptId, purchase_order_id: order,
    purchase_order_line_id: orderLine, line_number: 1, sku_id: sku, sku_code_snapshot: code, sku_name_snapshot: code,
    received_base_quantity: 1, ...dates });
  await db.query("UPDATE purchase_orders SET status = 'CONFIRMED', confirmed_at = ? WHERE id = ?", [now, order]);
  await db.query("UPDATE goods_receipts SET status = 'CONFIRMED', confirmed_at = ?, confirm_event_id = ? WHERE id = ?", [now, randomUUID(), goodsReceiptId]);
  const invoice = await insert("ap_invoices", {
    ...party, ...dates, status: "DRAFT", currency_code: "HKD", currency_decimal_places: 2,
    supplier_invoice_number: code, active_supplier_invoice_key: code, invoice_date: businessDate, due_date: businessDate,
    total_amount: 10, outstanding_amount: 10, created_by_label: "fixture"
  });
  return { db, order, goodsReceiptId, receiptLine, invoice };
}

integrationTest("AP receipt invoice claims see the committed active line despite an earlier RR snapshot", async (t) => {
  const { db, order, goodsReceiptId, receiptLine, invoice } = await receiptFixture(t);
  const scope = { goodsReceiptId };
  const inTransaction = (work, isolationLevel) => db.context.storage.run({}, () => db.withTransaction(work, { isolationLevel }));
  await assert.rejects(hasActiveGoodsReceiptInvoiceInTransaction(db, scope), TypeError);
  await inTransaction(async (tx) => {
    await assert.rejects(hasActiveGoodsReceiptInvoiceInTransaction(tx, scope), TypeError);
  }, "READ COMMITTED");

  const lockOrder = (tx) => tx.query("SELECT id FROM purchase_orders WHERE id = ? FOR UPDATE", [order]);
  const lockReceipt = (tx, lock) => tx.query("SELECT id FROM goods_receipts WHERE id = ? " + lock, [goodsReceiptId]);
  const ordinaryCount = async (tx) => Number((await tx.query(
    "SELECT COUNT(*) AS total FROM ap_invoice_lines WHERE goods_receipt_id = ?", [goodsReceiptId]
  ))[0][0].total);
  const orderLocked = Promise.withResolvers(), readerSnapshot = Promise.withResolvers();
  const writer = inTransaction(async (tx) => {
    await lockOrder(tx);
    await lockReceipt(tx, "FOR SHARE");
    orderLocked.resolve();
    await readerSnapshot.promise;
    await tx.query(`INSERT INTO ap_invoice_lines
      (invoice_id, line_no, line_type, goods_receipt_id, goods_receipt_line_id, active_goods_receipt_line_id, quantity, line_amount)
      VALUES (?, 1, 'RECEIPT', ?, ?, ?, 1, 10)`, [invoice, goodsReceiptId, receiptLine, receiptLine]);
  }, "READ COMMITTED");
  writer.catch(orderLocked.reject);
  const reader = inTransaction(async (tx) => {
    await orderLocked.promise;
    assert.equal(await ordinaryCount(tx), 0);
    const waitingForOrder = lockOrder(tx);
    readerSnapshot.resolve();
    await waitingForOrder;
    await lockReceipt(tx, "FOR UPDATE");
    assert.equal(await ordinaryCount(tx), 0, "the original consistent read still cannot see the committed line");
    assert.equal(await hasActiveGoodsReceiptInvoiceInTransaction(tx, scope), true);
  }, "REPEATABLE READ");
  try { await Promise.all([writer, reader]); }
  finally { readerSnapshot.resolve(); await Promise.allSettled([writer, reader]); }

  await inTransaction(async (tx) => {
    await tx.query("UPDATE ap_invoice_lines SET active_goods_receipt_line_id = NULL WHERE invoice_id = ?", [invoice]);
    await tx.query("UPDATE ap_invoices SET status = 'CANCELLED', active_supplier_invoice_key = NULL WHERE id = ?", [invoice]);
  });
  await inTransaction(async (tx) => {
    await lockOrder(tx);
    await lockReceipt(tx, "FOR UPDATE");
    assert.equal(await hasActiveGoodsReceiptInvoiceInTransaction(tx, scope), false);
    await assert.rejects(hasActiveGoodsReceiptInvoiceInTransaction(tx, { goodsReceiptId: "18446744073709551616" }), TypeError);
  }, "REPEATABLE READ");
});
