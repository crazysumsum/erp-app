import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";

/** Phase A calls this after locking the requested shipments, before recording the reversal. */
export async function findShipmentInvoiceClaimsInTransaction(tx, { shipmentIds } = {}) {
  if (tx?.context?.get()?.databaseTransaction !== tx || getActiveTransactionIsolation(tx) !== "READ COMMITTED") {
    throw new TypeError("Shipment invoice claims require the active READ COMMITTED transaction");
  }
  if (!Array.isArray(shipmentIds) || shipmentIds.length < 1 || shipmentIds.length > 20 ||
      shipmentIds.some((id) => typeof id !== "string" || !/^[1-9][0-9]*$/u.test(id) || !Number.isSafeInteger(Number(id))) ||
      new Set(shipmentIds).size !== shipmentIds.length) {
    throw new TypeError("A list of one to twenty distinct shipment IDs is required");
  }

  const placeholders = shipmentIds.map(() => "CAST(? AS UNSIGNED)").join(", ");
  const [rows] = await tx.query(`SELECT CAST(shipment_id AS CHAR) AS shipmentId
    FROM ar_invoice_lines FORCE INDEX (idx_ar_invoice_line_shipment)
    WHERE shipment_id IN (${placeholders}) AND active_shipment_line_id IS NOT NULL
    ORDER BY shipment_id, id FOR SHARE`, shipmentIds);
  const counts = new Map(shipmentIds.map((id) => [id, 0]));
  for (const { shipmentId } of rows) counts.set(shipmentId, counts.get(shipmentId) + 1);
  return shipmentIds.map((shipmentId) => ({ shipmentId, activeInvoiceLineCount: counts.get(shipmentId) }));
}
