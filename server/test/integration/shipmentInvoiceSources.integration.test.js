import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import { up as issueSchema } from "../../database/migrations/0097_create_shipment_issues_and_reversals.js";
import { readInvoiceSourcesInTransaction } from "../../src/modules/fulfillment/readInvoiceSourcesInTransaction.js";
import { ShipmentConfirmationService } from "../../src/modules/fulfillment/ShipmentConfirmationService.js";
import { shipmentDraftFixture } from "../fulfillment/p1CancellationFixture.js";

const nativeTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const rc = { isolationLevel: "READ COMMITTED" };

nativeTest("invoice sources keep exact Sales facts and use original confirmation order within a split shipment", async t => {
  const f = await shipmentDraftFixture(t);
  await issueSchema(f.db);
  const firstDraft = await f.create(f.body());
  const firstId = firstDraft.outcome.id;
  const read = shipmentIds => f.execute(() => f.database.withTransaction(
    tx => readInvoiceSourcesInTransaction(tx, { shipmentIds }), rc
  ));
  await assert.rejects(() => read([firstId]), { code: "SHIPMENT_STATE_CONFLICT" });
  await assert.rejects(() => read([firstId, firstId]), { code: "FULFILLMENT_INPUT_INVALID" });
  await assert.rejects(() => f.execute(() => f.database.withTransaction(
    tx => readInvoiceSourcesInTransaction(tx, { shipmentIds: [firstId] })
  )), error => error.cause instanceof TypeError);

  const [[order]] = await f.db.query("SELECT version,currency_code FROM sales_orders WHERE id=?", [f.s.orderId]);
  const work = await f.execute(() => f.fulfillments.create({
    eventId: randomUUID(),
    salesOrderId: f.s.orderId,
    salesOrderVersion: Number(order.version),
    lines: [{ salesOrderLineId: f.s.lineId, plannedBaseQuantity: "2" }]
  }));
  const [[balance]] = await f.db.query("SELECT version FROM inventory_stock_balances WHERE id=?", [f.balance]);
  const allocated = await f.execute(() => f.allocator.allocate(work.outcome.id, {
    eventId: randomUUID(), version: 1,
    lines: [{
      fulfillmentLineId: Number(work.fulfillment.lines[0].id), overrideReason: "",
      allocations: [{
        inventoryReservationId: Number(f.reservationId), inventoryBalanceId: Number(f.balance),
        balanceVersion: Number(balance.version), baseQuantity: "2"
      }]
    }]
  }));
  const allocation = allocated.fulfillment.allocations.items[0];
  await f.execute(() => f.picking.confirmPick(work.outcome.id, {
    eventId: randomUUID(), version: 2,
    lines: [{
      fulfillmentLineId: Number(work.fulfillment.lines[0].id), shortPickReason: "",
      allocations: [{
        fulfillmentAllocationId: Number(allocation.id),
        inventoryAllocationVersion: allocation.inventoryVersion, pickedBaseQuantity: "2"
      }]
    }]
  }));
  const secondDraft = await f.execute(() => f.service.createDraft(work.outcome.id, f.body()));
  const secondId = secondDraft.outcome.id;
  assert.ok(BigInt(secondId) > BigInt(firstId));

  const confirmation = new ShipmentConfirmationService(f.options);
  const confirm = id => f.execute(async () => {
    const eventId = randomUUID();
    const started = await confirmation.startConfirmation(id, { eventId, version: 1 });
    const completed = await confirmation.completeConfirmation(started);
    assert.equal(completed.outcome, "SHIPPED");
    return eventId;
  });
  const earlierEvent = await confirm(secondId);
  const laterEvent = await confirm(firstId);

  const [later, earlier] = await read([secondId, firstId]);
  assert.equal(later.id, firstId);
  assert.equal(later.confirmationEventId, laterEvent);
  assert.equal(later.salesOrderId, String(f.s.orderId));
  assert.equal(later.customerId, String(f.s.customerId));
  assert.equal(later.currencyCode, order.currency_code);
  assert.equal(later.paymentTerm, null);
  assert.equal(later.status, "SHIPPED");
  assert.equal(later.lines.length, 1);
  const [source] = later.lines;
  assert.equal(source.salesOrderLineId, String(f.s.lineId));
  assert.equal(source.unitSellingPrice, "1.0000");
  assert.equal(source.lineAmount, "5.0000");
  assert.equal(source.orderedBaseQuantity, "5");
  assert.equal(source.shippedBaseQuantity, "3");
  assert.equal(source.reversedBaseQuantity, "0");
  assert.equal(earlier.confirmationEventId, earlierEvent);
  assert.deepEqual(earlier.lines[0].priorShipments, []);
  assert.ok(source.confirmationSequence > earlier.lines[0].confirmationSequence);
  assert.deepEqual(source.priorShipments, [{
    shipmentId: secondId,
    shipmentLineId: earlier.lines[0].id,
    confirmationEventId: earlierEvent,
    confirmationSequence: earlier.lines[0].confirmationSequence,
    shippedBaseQuantity: "2"
  }]);
});
