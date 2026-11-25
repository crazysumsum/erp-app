import { requireReturnSourceTransaction, returnSourceId, returnSourceIds } from "./returnSourceScope.js";

/** Purchasing has already locked the purchase order, receipt and requested receipt details. */
export async function readPostedSupplierReturnQuantitiesInTransaction(tx, { goodsReceiptId, goodsReceiptDetailIds }) {
  requireReturnSourceTransaction(tx, "REPEATABLE READ");
  const receiptId = returnSourceId(goodsReceiptId);
  const ids = returnSourceIds(goodsReceiptDetailIds);
  const placeholders = ids.map(() => "?").join(", ");
  const quantities = new Map(ids.map(id => [id, 0n]));
  // A locking read observes posts committed while the caller waited for the purchase order lock.
  const [rows] = await tx.query(
    `SELECT goods_receipt_detail_id, CAST(base_quantity AS CHAR) AS base_quantity
       FROM supplier_return_lines
      WHERE goods_receipt_id = ? AND goods_receipt_detail_id IN (${placeholders}) AND inventory_movement_id IS NOT NULL
      ORDER BY goods_receipt_detail_id, id FOR SHARE`,
    [receiptId, ...ids]
  );
  for (const row of rows) {
    const id = String(row.goods_receipt_detail_id);
    if (!quantities.has(id) || !/^[1-9][0-9]*$/u.test(row.base_quantity)) {
      throw new Error("Unexpected posted supplier return line");
    }
    quantities.set(id, quantities.get(id) + BigInt(row.base_quantity));
  }
  return new Map([...quantities].map(([id, quantity]) => [id, String(quantity)]));
}
