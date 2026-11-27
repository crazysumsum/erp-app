import { returnError } from "./returnErrors.js";
import { readPostedSupplierReturnQuantitiesInTransaction } from "./readPostedSupplierReturnQuantitiesInTransaction.js";

const placeholders = values => values.map(() => "?").join(", ");

export async function lockReturnSource(tx, kind, sourceId) {
  if (kind === "customer") {
    const [[shipment]] = await tx.query("SELECT * FROM shipments WHERE id = ? FOR UPDATE", [sourceId]);
    if (!shipment) throw returnError("RETURN_SOURCE_NOT_FOUND");
    if (shipment.status !== "SHIPPED") throw returnError("RETURN_SOURCE_CONFLICT");
    return shipment;
  }
  // Receipt ownership is frozen after confirmation. Recheck it after taking the PO lock.
  const [[route]] = await tx.query("SELECT purchase_order_id FROM goods_receipts WHERE id = ?", [sourceId]);
  if (!route) throw returnError("RETURN_SOURCE_NOT_FOUND");
  const [[order]] = await tx.query("SELECT id, supplier_id FROM purchase_orders WHERE id = ? FOR UPDATE", [route.purchase_order_id]);
  if (!order) throw returnError("RETURN_SOURCE_CONFLICT");
  await tx.query("SELECT id FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id FOR UPDATE", [order.id]);
  const [[receipt]] = await tx.query("SELECT * FROM goods_receipts WHERE id = ? FOR UPDATE", [sourceId]);
  if (!receipt || String(receipt.purchase_order_id) !== String(order.id) ||
      String(receipt.supplier_id) !== String(order.supplier_id) ||
      !["CONFIRMED", "PARTIALLY_REVERSED"].includes(receipt.status)) throw returnError("RETURN_SOURCE_CONFLICT");
  return receipt;
}

export async function lockReturnSourceDetails(tx, kind, source, lines) {
  const ids = [...new Set(lines.map(line => line.sourceDetailId))];
  const markers = placeholders(ids);
  let rows;
  if (kind === "customer") {
    [rows] = await tx.query(
      `SELECT d.id, d.warehouse_id, d.inventory_movement_id, d.lot_id, l.sku_id, d.issued_base_quantity AS quantity, 0 AS reversed
         FROM shipment_issue_details d JOIN shipment_lines l ON l.id = d.shipment_line_id AND l.shipment_id = d.shipment_id
        WHERE d.shipment_id = ? AND d.id IN (${markers}) AND d.reversal_movement_id IS NULL
        ORDER BY d.id FOR SHARE OF d`, [source.id, ...ids]);
  } else {
    const [receiptLines] = await tx.query(
      `SELECT id, purchase_order_id, purchase_order_line_id, sku_id
         FROM goods_receipt_lines WHERE goods_receipt_id = ? ORDER BY id FOR SHARE`, [source.id]);
    const owners = new Map(receiptLines.map(row => [String(row.id), row]));
    [rows] = await tx.query(
      `SELECT d.id, d.warehouse_id, d.inventory_movement_id, d.goods_receipt_line_id, d.purchase_order_id, d.purchase_order_line_id,
              d.sku_id, m.lot_id, d.received_base_quantity AS quantity, d.reversed_base_quantity AS reversed
         FROM goods_receipt_details d JOIN inventory_movements m ON m.id = d.inventory_movement_id
        WHERE d.goods_receipt_id = ? AND d.id IN (${markers}) AND m.warehouse_id = d.warehouse_id AND m.sku_id = d.sku_id
        ORDER BY d.id FOR SHARE OF d`, [source.id, ...ids]);
    for (const row of rows) {
      const owner = owners.get(String(row.goods_receipt_line_id));
      if (!owner || ["purchase_order_id", "purchase_order_line_id", "sku_id"].some(field => String(owner[field]) !== String(row[field])) ||
          String(row.purchase_order_id) !== String(source.purchase_order_id)) throw returnError("RETURN_SOURCE_CONFLICT");
    }
  }
  if (rows.length !== ids.length || rows.some(row => !row.inventory_movement_id)) throw returnError("RETURN_SOURCE_CONFLICT");
  return new Map(rows.map(row => [String(row.id), row]));
}

export async function readPostedReturnQuantities(tx, kind, sourceId, detailIds) {
  if (kind === "supplier") return readPostedSupplierReturnQuantitiesInTransaction(tx, {
    goodsReceiptId: sourceId, goodsReceiptDetailIds: detailIds
  });
  const [rows] = await tx.query(
    `SELECT shipment_issue_detail_id, CAST(base_quantity AS CHAR) AS base_quantity FROM customer_return_lines
       WHERE shipment_id = ? AND shipment_issue_detail_id IN (${placeholders(detailIds)}) AND inventory_movement_id IS NOT NULL
       ORDER BY shipment_issue_detail_id, id FOR SHARE`, [sourceId, ...detailIds]);
  const totals = new Map(detailIds.map(id => [id, 0n]));
  for (const row of rows) {
    const id = String(row.shipment_issue_detail_id);
    totals.set(id, totals.get(id) + BigInt(row.base_quantity));
  }
  return new Map([...totals].map(([id, total]) => [id, String(total)]));
}

export async function assertReturnBins(tx, kind, source, details, lines) {
  const ids = [...new Set(lines.map(line => line.binId))];
  // Bin ownership is checked again by Inventory while holding its stock locks.
  const [rows] = await tx.query(
    `SELECT b.id, b.warehouse_id FROM inventory_bins b JOIN inventory_warehouses w ON w.id = b.warehouse_id
      WHERE b.id IN (${placeholders(ids)}) AND b.status = 'ACTIVE' AND w.status = 'ACTIVE'`, ids);
  if (rows.length !== ids.length) throw returnError("RETURN_BIN_NOT_AVAILABLE");
  const warehouses = new Map(rows.map(row => [String(row.id), String(row.warehouse_id)]));
  for (const line of lines) {
    const originalWarehouse = kind === "customer" ? source.warehouse_id : details.get(line.sourceDetailId).warehouse_id;
    if (warehouses.get(line.binId) !== String(originalWarehouse)) {
      throw returnError(kind === "customer" ? "CUSTOMER_RETURN_WAREHOUSE_MISMATCH" : "SUPPLIER_RETURN_WAREHOUSE_MISMATCH");
    }
  }
}
