import { randomUUID } from "node:crypto";
import { addSourceLine, p1Fixture } from "./p1Fixture.js";

export async function expiryShipmentFixture(t) {
  const f = await p1Fixture(t, 2);
  const undated = await addSourceLine(f, 2);
  const expiryDate = "2090-01-15";
  const sources = [
    { lineId: f.s.lineId, skuId: f.s.skuId, reservationId: f.reservationId, binCode: "DATED", date: expiryDate },
    { ...undated, binCode: "UNDATED", date: null }
  ];
  for (const source of sources) {
    await f.db.execute("UPDATE item_skus SET tracking_policy=? WHERE id=?", [source.date ? "batch_expiry" : "batch", source.skuId]);
    source.lotId = await f.s.insert("inventory_lots", {
      sku_id: source.skuId, lot_number: source.binCode, normalized_lot_number: source.binCode.toLowerCase(),
      expiry_date: source.date, first_receipt_date: "2023-11-01", sku_code_snapshot: "SYN", created_at: f.s.now
    });
  }
  await f.s.insert("customer_address_purposes", {
    address_id: f.s.addressId, customer_id: f.s.customerId, purpose_code: "shipping", is_default: 1,
    created_at: f.s.now, updated_at: f.s.now
  });
  const { outcome, fulfillment } = await f.create({
    eventId: randomUUID(), salesOrderId: f.s.orderId, salesOrderVersion: 2,
    lines: sources.map(source => ({ salesOrderLineId: source.lineId, plannedBaseQuantity: "2" }))
  });
  const lines = [];
  for (const source of sources) {
    const { binCode } = source;
    const binId = await f.s.insert("inventory_bins", {
      warehouse_id: f.s.warehouseId, bin_code: binCode, normalized_code: binCode.toLowerCase(),
      status: "ACTIVE", created_at: f.s.now, updated_at: f.s.now
    });
    const balanceId = await f.s.insert("inventory_stock_balances", {
      warehouse_id: f.s.warehouseId, bin_id: binId, sku_id: source.skuId, lot_id: source.lotId,
      stock_status: "AVAILABLE", on_hand_quantity: 5, allocated_quantity: 0,
      fifo_anchor_date: null, created_at: f.s.now, updated_at: f.s.now
    });
    lines.push({
      fulfillmentLineId: Number(fulfillment.lines.find(line => line.salesOrderLineId === String(source.lineId)).id),
      overrideReason: "",
      allocations: [{ inventoryReservationId: Number(source.reservationId), inventoryBalanceId: Number(balanceId), balanceVersion: 1, baseQuantity: "2" }]
    });
  }
  return { ...f, fulfillmentId: outcome.id, expiryDate, allocation: { eventId: randomUUID(), version: 1, lines } };
}
