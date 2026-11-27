import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { purchasingError } from "./purchasingErrors.js";
import { onlyFields, requireItems } from "./purchasingValidation.js";

const maxReceipts = 20;
const maxLinesPerReceipt = 100;
const maxId = (1n << 64n) - 1n;
const unsignedId = "CAST(? AS UNSIGNED)";
const idParameters = ids => ids.map(() => unsignedId).join(", ");
const byIdAscending = (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
const unavailable = () => purchasingError("PURCHASING_DEPENDENCY_UNAVAILABLE");

function sourceIds(input) {
  const { goodsReceiptIds } = onlyFields(input, ["goodsReceiptIds"], "source");
  const ids = [...requireItems(goodsReceiptIds, maxReceipts, "goodsReceiptIds")];
  if (ids.some(id => typeof id !== "string" || !/^[1-9][0-9]{0,19}$/u.test(id) || BigInt(id) > maxId) ||
      ids.length !== new Set(ids).size) {
    throw purchasingError("PURCHASING_INPUT_INVALID", { field: "goodsReceiptIds" });
  }
  return ids.sort(byIdAscending);
}

function paymentTerm(po) {
  if (po.payment_term_id === null || po.payment_term_snapshot === null) return null;
  const snapshot = typeof po.payment_term_snapshot === "string" ? JSON.parse(po.payment_term_snapshot) : po.payment_term_snapshot;
  if (!snapshot?.code || !snapshot.calculationType || !Object.hasOwn(snapshot, "dueDays")) return null;
  return { id: po.payment_term_id, code: snapshot.code, name: snapshot.name, calculationType: snapshot.calculationType, dueDays: snapshot.dueDays };
}

function projectLine(line, order, orderLine, netQuantity) {
  if (!orderLine || orderLine.purchase_order_id !== order.id) throw unavailable();
  return {
    id: line.id,
    lineNumber: Number(line.line_number),
    purchaseOrderLineId: line.purchase_order_line_id,
    skuId: line.sku_id,
    skuCodeSnapshot: line.sku_code_snapshot,
    skuNameSnapshot: line.sku_name_snapshot,
    baseUomCodeSnapshot: orderLine.base_uom_code_snapshot,
    purchaseUomCodeSnapshot: orderLine.purchase_uom_code_snapshot,
    toBaseFactor: Number(orderLine.uom_to_base_factor_snapshot),
    receivedBaseQuantity: netQuantity,
    unitPrice: orderLine.unit_price
  };
}

async function quantitiesForInvoice(tx, id, receipt, lines) {
  if (receipt.status === "CONFIRMED") {
    if (lines.some(line => line.received_base_quantity === "0")) throw unavailable();
    return new Map(lines.map(line => [line.id, line.received_base_quantity]));
  }
  // The PO and receipt locks already serialize all updates of reversal projections.
  const [details] = await tx.query(`SELECT CAST(goods_receipt_line_id AS CHAR) AS line_id,
    CAST(SUM(received_base_quantity) AS CHAR) AS received, CAST(SUM(reversed_base_quantity) AS CHAR) AS reversed
    FROM goods_receipt_details WHERE goods_receipt_id = ${unsignedId} GROUP BY goods_receipt_line_id`, [id]);
  const byLine = new Map(details.map(row => [row.line_id, row]));
  if (byLine.size !== lines.length) throw unavailable();
  let received = 0n, reversed = 0n;
  const net = new Map();
  for (const line of lines) {
    const amount = byLine.get(line.id);
    if (!amount || amount.received !== line.received_base_quantity) throw unavailable();
    const grossQuantity = BigInt(amount.received), reversedQuantity = BigInt(amount.reversed);
    if (reversedQuantity > grossQuantity) throw unavailable();
    received += grossQuantity;
    reversed += reversedQuantity;
    net.set(line.id, String(grossQuantity - reversedQuantity));
  }
  if (received !== BigInt(receipt.total_received_base_quantity) ||
      reversed !== BigInt(receipt.total_reversed_base_quantity) || reversed <= 0n || reversed >= received) throw unavailable();
  return net;
}

/**
 * Returns complete receipts, by numeric receipt ID and then by line number.
 * AP owns invoice amounts, duplicate protection and the enclosing transaction.
 */
export async function readSupplierInvoiceSourcesInTransaction(tx, input) {
  if (tx?.context?.get()?.databaseTransaction !== tx || getActiveTransactionIsolation(tx) !== "READ COMMITTED") {
    throw new TypeError("Supplier invoice sources require the active READ COMMITTED transaction");
  }
  const ids = sourceIds(input);
  const [owners] = await tx.query(
    `SELECT CAST(id AS CHAR) AS id, CAST(purchase_order_id AS CHAR) AS purchase_order_id
       FROM goods_receipts WHERE id IN (${idParameters(ids)})`, ids);
  if (owners.length !== ids.length) throw purchasingError("GOODS_RECEIPT_NOT_FOUND");
  const ownerByReceipt = new Map(owners.map(row => [row.id, row.purchase_order_id]));
  const orderIds = [...new Set(ownerByReceipt.values())].sort(byIdAscending);
  const orders = new Map();
  // Take point locks in order before touching any lines or receipt headers.
  for (const id of orderIds) {
    const [[row]] = await tx.query(
      `SELECT CAST(id AS CHAR) AS id, CAST(supplier_id AS CHAR) AS supplier_id, po_number, currency_code,
        currency_decimal_places_snapshot, CAST(payment_term_id AS CHAR) AS payment_term_id, payment_term_snapshot
       FROM purchase_orders WHERE id = ${unsignedId} FOR UPDATE`, [id]);
    if (!row) throw unavailable();
    orders.set(id, row);
  }
  const [orderLineRows] = await tx.query(
    `SELECT CAST(pol.id AS CHAR) AS id, CAST(pol.purchase_order_id AS CHAR) AS purchase_order_id,
      pol.base_uom_code_snapshot, pol.purchase_uom_code_snapshot, pol.uom_to_base_factor_snapshot, CAST(pol.unit_price AS CHAR) AS unit_price
     FROM purchase_order_lines pol WHERE pol.purchase_order_id IN (${idParameters(orderIds)})
     ORDER BY pol.purchase_order_id, pol.id FOR UPDATE`, orderIds);
  const orderLines = new Map(orderLineRows.map(line => [line.id, line]));

  const receipts = [];
  for (const id of ids) {
    const [[receipt]] = await tx.query(
      `SELECT gr_number, CAST(purchase_order_id AS CHAR) AS purchase_order_id, CAST(supplier_id AS CHAR) AS supplier_id,
        supplier_code_snapshot, supplier_name_snapshot, DATE_FORMAT(business_receipt_date, '%Y-%m-%d') AS business_receipt_date,
        status, CAST(total_received_base_quantity AS CHAR) AS total_received_base_quantity,
        CAST(total_reversed_base_quantity AS CHAR) AS total_reversed_base_quantity
       FROM goods_receipts WHERE id = ${unsignedId} FOR UPDATE`, [id]);
    if (!receipt) throw purchasingError("GOODS_RECEIPT_NOT_FOUND");
    if (receipt.purchase_order_id !== ownerByReceipt.get(id) || !["CONFIRMED", "PARTIALLY_REVERSED"].includes(receipt.status) ||
        (receipt.status === "CONFIRMED" && receipt.total_reversed_base_quantity !== "0")) {
      throw purchasingError("GR_STATE_CONFLICT");
    }
    const order = orders.get(receipt.purchase_order_id);
    if (order.supplier_id !== receipt.supplier_id) throw unavailable();
    receipts.push({ id, receipt, order });
  }
  const [first] = receipts;
  if (receipts.some(({ order }) => order.supplier_id !== first.order.supplier_id || order.currency_code !== first.order.currency_code)) {
    throw purchasingError("GR_INVOICE_SOURCE_MISMATCH");
  }

  const result = [];
  for (const { id, receipt, order } of receipts) {
    const [lines] = await tx.query(
      `SELECT CAST(id AS CHAR) AS id, line_number, CAST(purchase_order_line_id AS CHAR) AS purchase_order_line_id,
        CAST(sku_id AS CHAR) AS sku_id, sku_code_snapshot, sku_name_snapshot, CAST(received_base_quantity AS CHAR) AS received_base_quantity
       FROM goods_receipt_lines WHERE goods_receipt_id = ${unsignedId} ORDER BY line_number LIMIT ? FOR UPDATE`, [id, maxLinesPerReceipt + 1]);
    if (!lines.length || lines.length > maxLinesPerReceipt) throw unavailable();
    const net = await quantitiesForInvoice(tx, id, receipt, lines);
    const projected = lines.map(line => projectLine(line, order, orderLines.get(line.purchase_order_line_id), net.get(line.id)))
      .filter(line => line.receivedBaseQuantity !== "0");
    if (!projected.length) throw unavailable();
    result.push({
      id,
      number: receipt.gr_number,
      businessReceiptDate: receipt.business_receipt_date,
      supplierId: receipt.supplier_id,
      supplierCodeSnapshot: receipt.supplier_code_snapshot,
      supplierNameSnapshot: receipt.supplier_name_snapshot,
      purchaseOrderId: order.id,
      purchaseOrderNumber: order.po_number,
      currencyCode: order.currency_code,
      currencyDecimalPlaces: Number(order.currency_decimal_places_snapshot),
      paymentTerm: paymentTerm(order),
      lines: projected
    });
  }
  return result;
}
