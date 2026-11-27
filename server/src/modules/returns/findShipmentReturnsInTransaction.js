import { requireReturnSourceTransaction, returnSourceIds } from "./returnSourceScope.js";

/** Fulfillment has already locked the requested shipment roots for reversal admission. */
export async function findShipmentReturnsInTransaction(tx, { shipmentIds }) {
  requireReturnSourceTransaction(tx, "READ COMMITTED");
  const ids = returnSourceIds(shipmentIds);
  const placeholders = ids.map(() => "?").join(", ");
  const counts = new Map(ids.map(id => [id, 0]));
  const [rows] = await tx.query(
    `SELECT shipment_id FROM customer_returns
      WHERE shipment_id IN (${placeholders}) AND status IN ('DRAFT', 'POSTED')
      ORDER BY shipment_id, status, id FOR SHARE`,
    ids
  );
  for (const row of rows) {
    const id = String(row.shipment_id);
    if (!counts.has(id)) throw new Error("Unexpected customer return shipment");
    counts.set(id, counts.get(id) + 1);
  }
  return ids.map(shipmentId => ({ shipmentId, openReturnCount: counts.get(shipmentId) }));
}
