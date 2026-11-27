import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { p1Fixture, startP1Http } from "../fulfillment/p1Fixture.js";

const nativeTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

nativeTest("Fulfillment allocation posts stock over HTTP with a 190-code-point Unicode role", async t => {
  const quantity = 5;
  const f = await p1Fixture(t, quantity);
  const created = await f.create(f.body(String(quantity)));
  const bin = await f.s.insert("inventory_bins", {
    warehouse_id: f.s.warehouseId,
    bin_code: "ALLOCATE",
    normalized_code: "allocate",
    status: "ACTIVE",
    created_at: f.s.now,
    updated_at: f.s.now
  });
  const balanceId = await f.s.insert("inventory_stock_balances", {
    warehouse_id: f.s.warehouseId,
    bin_id: bin,
    sku_id: f.s.skuId,
    stock_status: "AVAILABLE",
    on_hand_quantity: quantity,
    allocated_quantity: 0,
    fifo_anchor_date: "2023-11-13",
    created_at: f.s.now,
    updated_at: f.s.now
  });

  const role = "揀".repeat(189) + "𠮷";
  await f.db.execute("UPDATE roles SET name=? WHERE id=?", [role, f.roleId]);
  f.claims.roles = [role];
  const http = await startP1Http(t, f);
  const posted = await http("POST", `/api/v1/fulfillments/${created.outcome.id}/allocate`, {
    eventId: randomUUID(),
    version: 1,
    lines: [{
      fulfillmentLineId: Number(created.fulfillment.lines[0].id),
      allocations: [{
        inventoryReservationId: Number(f.reservationId),
        inventoryBalanceId: Number(balanceId),
        balanceVersion: 1,
        baseQuantity: String(quantity)
      }],
      overrideReason: ""
    }]
  });

  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  assert.equal(posted.body.data.outcome.status, "PICKING");
  const [[balance]] = await f.db.query("SELECT allocated_quantity FROM inventory_stock_balances WHERE id=?", [balanceId]);
  assert.equal(Number(balance.allocated_quantity), quantity);
});
