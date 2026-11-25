import { fulfillmentError } from "./fulfillmentErrors.js";

export async function readInvoiceShipmentReferences(database, shipmentIds) {
  if (!Array.isArray(shipmentIds) || shipmentIds.length < 1 || shipmentIds.length > 20 ||
      new Set(shipmentIds).size !== shipmentIds.length || shipmentIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw fulfillmentError("FULFILLMENT_INPUT_INVALID", { field: "shipmentIds" });
  }
  const marks = shipmentIds.map(() => "?").join(",");
  const [rows] = await database.query(`SELECT s.id, s.shipment_number, f.sales_order_number_snapshot
    FROM shipments s JOIN fulfillments f ON f.id = s.fulfillment_id AND f.sales_order_id = s.sales_order_id
    WHERE s.id IN (${marks}) ORDER BY s.id`, shipmentIds);
  if (rows.length !== shipmentIds.length || rows.some((row) => !row.shipment_number || !row.sales_order_number_snapshot)) {
    throw fulfillmentError("SHIPMENT_NOT_FOUND");
  }
  return rows.map((row) => ({
    shipmentId: Number(row.id), shipmentNumber: row.shipment_number, salesOrderNumber: row.sales_order_number_snapshot
  }));
}
