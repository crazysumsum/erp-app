/** 貸項及退款命令在同一交易內先鎖這一列，再處理核銷或退款。 */
export async function lockCreditNote(tx, creditNoteId) {
  const [[credit]] = await tx.query("SELECT * FROM ap_credit_notes WHERE id = ? FOR UPDATE", [creditNoteId]);
  return credit ?? null;
}
