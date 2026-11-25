import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";

const MAX_SOURCE_ID = (1n << 64n) - 1n;

/** The reversal caller holds the purchase order and receipt locks before this current read. */
export async function hasActiveGoodsReceiptInvoiceInTransaction(tx, { goodsReceiptId } = {}) {
  if (tx?.context?.get()?.databaseTransaction !== tx || getActiveTransactionIsolation(tx) !== "REPEATABLE READ") {
    throw new TypeError("Goods receipt invoice claims require the active REPEATABLE READ transaction");
  }
  if (typeof goodsReceiptId !== "string" || !/^[1-9][0-9]{0,19}$/u.test(goodsReceiptId) || BigInt(goodsReceiptId) > MAX_SOURCE_ID) {
    throw new TypeError("A positive goods receipt ID is required");
  }

  const [rows] = await tx.query(`SELECT id FROM ap_invoice_lines FORCE INDEX (idx_ap_invoice_line_receipt)
    WHERE goods_receipt_id = CAST(? AS UNSIGNED) AND active_goods_receipt_line_id IS NOT NULL
    ORDER BY id LIMIT 1 FOR SHARE`, [goodsReceiptId]);
  return rows.length === 1;
}
