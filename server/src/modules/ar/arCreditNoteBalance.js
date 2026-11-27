import { arError } from "./arErrors.js";

// 貸項及退款命令都先鎖這一列，再讀取或變更可用額。
export async function lockArCreditNote(tx, id) {
  const [[credit]] = await tx.query(
    `SELECT id, credit_note_number, status, invoice_id, customer_id, currency_code, currency_decimal_places,
            DATE_FORMAT(credit_date, '%Y-%m-%d') AS credit_date, customer_return_id,
            total_amount, applied_amount, refunded_amount, available_amount, version
       FROM ar_credit_notes WHERE id = ? FOR UPDATE`, [id]);
  return credit;
}

/** Persist server-derived columns on a credit note already locked by this transaction. */
export async function updateArCreditNote(tx, credit, changes, nowMs) {
  const version = Number(credit.version);
  if (version >= 4294967295) throw arError("VERSION_CONFLICT", { currentVersion: version });
  const updated = { ...changes, version: version + 1, updated_at: nowMs };
  const [result] = await tx.query("UPDATE ar_credit_notes SET ? WHERE id = ? AND version = ?", [updated, credit.id, version]);
  if (result.affectedRows !== 1) throw arError("CONCURRENT_OPERATION");
  return { ...credit, ...updated };
}
