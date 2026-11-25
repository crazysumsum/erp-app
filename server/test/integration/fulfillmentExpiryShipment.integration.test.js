import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { expiryShipmentFixture } from "../fulfillment/expiryShipmentFixture.js";
import { startP1Http } from "../fulfillment/p1Fixture.js";

const nativeTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

nativeTest("UAT-004 keeps dated and undated batches readable through allocation, picking and shipment", async t => {
  const f = await expiryShipmentFixture(t);
  const request = await startP1Http(t, f);
  const fulfillmentPath = `/api/v1/fulfillments/${f.fulfillmentId}`;
  const expectedDates = { DATED: f.expiryDate, UNDATED: null };
  const checkDates = rows => {
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.fromEntries(rows.map(row => [row.binCode, row.expiryDate])), expectedDates);
  };
  const allocate = await request("POST", `${fulfillmentPath}/allocate`, f.allocation);

  // The original regression happened after commit. Continue from a fresh read without resending Allocate.
  const [[committed]] = await f.db.query("SELECT status, version FROM fulfillments WHERE id=?", [f.fulfillmentId]);
  assert.equal(committed.status, "PICKING");
  assert.equal(Number(committed.version), 2);
  const detail = await request("GET", fulfillmentPath);
  assert.deepEqual([allocate.status, detail.status], [200, 200], JSON.stringify([allocate.body, detail.body]));
  checkDates(allocate.body.data.fulfillment.allocations.items);
  const read = detail.body.data.fulfillment;
  checkDates(read.allocations.items);

  const pick = await request("POST", `${fulfillmentPath}/pick-confirm`, {
    eventId: randomUUID(), version: read.version,
    lines: read.allocations.items.map(row => ({
      fulfillmentLineId: Number(row.fulfillmentLineId), shortPickReason: "",
      allocations: [{ fulfillmentAllocationId: Number(row.id), inventoryAllocationVersion: row.inventoryVersion, pickedBaseQuantity: "2" }]
    }))
  });
  assert.equal(pick.status, 200, JSON.stringify(pick.body));
  assert.equal(pick.body.data.outcome.status, "PICKED");
  checkDates(pick.body.data.fulfillment.allocations.items);
  const pickList = await request("GET", `${fulfillmentPath}/pick-list`);
  assert.equal(pickList.status, 200);
  checkDates(pickList.body.data.rows);

  const draft = await request("POST", `${fulfillmentPath}/shipments/create`, {
    eventId: randomUUID(), shippingAddressId: f.s.addressId, shippingAddressVersion: 1
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const shipmentPath = `/api/v1/shipments/${draft.body.data.outcome.id}`;
  const confirm = await request("POST", `${shipmentPath}/confirm`, { eventId: randomUUID(), version: 1 });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  assert.equal(confirm.body.data.outcome, "SHIPPED");
  checkDates(confirm.body.data.shipment.issues.items);
  const shipment = await request("GET", shipmentPath);
  assert.equal(shipment.status, 200);
  checkDates(shipment.body.data.shipment.issues.items);
  const print = await request("GET", `${shipmentPath}/delivery-note`);
  assert.equal(print.status, 200);
  checkDates(print.body.data.rows);
  const [balances] = await f.db.query("SELECT on_hand_quantity, allocated_quantity FROM inventory_stock_balances ORDER BY id");
  assert.deepEqual(balances.map(row => [Number(row.on_hand_quantity), Number(row.allocated_quantity)]), [[3, 0], [3, 0]]);
});
