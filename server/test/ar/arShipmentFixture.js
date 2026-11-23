import { randomUUID } from "node:crypto";

/** 同一訂單行餘下的 2 件：另一張履約、揀貨及出貨草稿（與 Fulfillment reader 的測試同一做法）。 */
export async function secondShipment(f) {
  const [[order]] = await f.db.query("SELECT version FROM sales_orders WHERE id = ?", [f.s.orderId]);
  const work = await f.execute(() => f.fulfillments.create({ eventId: randomUUID(), salesOrderId: f.s.orderId, salesOrderVersion: Number(order.version),
    lines: [{ salesOrderLineId: f.s.lineId, plannedBaseQuantity: "2" }] }));
  const [[balance]] = await f.db.query("SELECT version FROM inventory_stock_balances WHERE id = ?", [f.balance]);
  const line = Number(work.fulfillment.lines[0].id);
  const allocated = await f.execute(() => f.allocator.allocate(work.outcome.id, { eventId: randomUUID(), version: 1, lines: [{ fulfillmentLineId: line, overrideReason: "",
    allocations: [{ inventoryReservationId: Number(f.reservationId), inventoryBalanceId: Number(f.balance), balanceVersion: Number(balance.version), baseQuantity: "2" }] }] }));
  const allocation = allocated.fulfillment.allocations.items[0];
  await f.execute(() => f.picking.confirmPick(work.outcome.id, { eventId: randomUUID(), version: 2, lines: [{ fulfillmentLineId: line, shortPickReason: "",
    allocations: [{ fulfillmentAllocationId: Number(allocation.id), inventoryAllocationVersion: allocation.inventoryVersion, pickedBaseQuantity: "2" }] }] }));
  return (await f.execute(() => f.service.createDraft(work.outcome.id, f.body()))).outcome.id;
}
