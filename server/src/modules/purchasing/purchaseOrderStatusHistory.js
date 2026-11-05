/** §4.8：caller 已鎖 PO，所以 MAX + 1 唔會撞；同狀態變更同一個 transaction。Approval 同 Lifecycle 都用。 */
export async function appendStatusHistory(tx, { purchaseOrderId, fromStatus, toStatus, action, reason = "", version, eventId, actor, nowMs }) {
  const [[{ next }]] = await tx.query("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next FROM purchase_order_status_history WHERE purchase_order_id = ?", [purchaseOrderId]);
  await tx.query("INSERT INTO purchase_order_status_history SET ?", [{ purchase_order_id: purchaseOrderId, sequence_no: Number(next), from_status: fromStatus, to_status: toStatus, action, reason,
    purchase_order_version_after: version, event_id: eventId, actor_user_id: actor.id, actor_label: actor.username, occurred_at: nowMs }]);
}
