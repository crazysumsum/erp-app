import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import { up as issueSchema } from "../../database/migrations/0097_create_shipment_issues_and_reversals.js";
import { readInvoiceSourcesInTransaction } from "../../src/modules/fulfillment/readInvoiceSourcesInTransaction.js";
import { ShipmentConfirmationService } from "../../src/modules/fulfillment/ShipmentConfirmationService.js";
import { SalesOrderLifecycleService } from "../../src/modules/sales/SalesOrderLifecycleService.js";
import { SalesOrderService, readSalesOrderDetail } from "../../src/modules/sales/SalesOrderService.js";
import { shipmentDraftFixture } from "../fulfillment/p1CancellationFixture.js";
import { createTestCurrency } from "../sales/phase1/fixtures.js";

const nativeTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

nativeTest("Sales edits and withdrawal cannot change invoice facts after partial shipment", async t => {
  const f = await shipmentDraftFixture(t);
  await issueSchema(f.db);
  const { orderId, customerId, warehouseId, skuId, skuUomId, now } = f.s;
  const term = { code: "NET30-SHIPPED-TEST", name: "Synthetic net thirty" };
  const termId = await f.s.insert("payment_terms", {
    ...term, code_key: term.code.toLowerCase(), calculation_type: "NET_DAYS", due_days: 30,
    status: "ACTIVE", version: 1, created_at: now, updated_at: now
  });
  await f.db.execute(`UPDATE sales_orders
    SET payment_term_id=?,payment_term_code_snapshot=?,payment_term_name_snapshot=? WHERE id=?`,
  [termId, term.code, term.name, orderId]);

  const shipment = await f.create(f.body());
  const shipmentId = shipment.outcome.id;
  const confirmation = new ShipmentConfirmationService(f.options);
  const shipped = await f.execute(async () => {
    const intent = await confirmation.startConfirmation(shipmentId, { eventId: randomUUID(), version: 1 });
    return confirmation.completeConfirmation(intent);
  });
  assert.equal(shipped.outcome, "SHIPPED");

  const originalOrder = await readSalesOrderDetail(f.db, orderId);
  assert.equal(originalOrder.status, "PARTIALLY_FULFILLED");
  const readInvoiceSources = () => f.execute(() => f.database.withTransaction(
    tx => readInvoiceSourcesInTransaction(tx, { shipmentIds: [shipmentId] }), { isolationLevel: "READ COMMITTED" }
  ));
  const sources = await readInvoiceSources();
  assert.equal(sources.length, 1);
  const [source] = sources;
  assert.equal(source.currencyCode, originalOrder.currencyCode);
  assert.deepEqual(source.paymentTerm, { id: String(termId), ...term });
  assert.equal(source.lines.length, 1);
  const [line] = source.lines;
  assert.equal(line.orderedBaseQuantity, "5");
  assert.equal(line.shippedBaseQuantity, "3");
  assert.equal(line.unitSellingPrice, "1.0000");
  assert.equal(line.lineAmount, "5.0000");

  const replacementCurrency = await createTestCurrency(f.db, [], now);
  await f.db.execute("UPDATE currencies SET status='ACTIVE' WHERE code=?", [replacementCurrency]);
  await f.db.execute("UPDATE item_skus SET sellable=1 WHERE id=?", [skuId]);
  await f.db.execute(`INSERT INTO role_permissions (role_id,permission_id)
    SELECT ?,id FROM permissions WHERE name IN ('sales.view','sales.mgmt')`, [f.roleId]);
  const claims = {
    actorId: f.userId, claimedRoles: f.claims.roles,
    claimedPermissions: [...f.claims.permissions, "sales.view", "sales.mgmt"]
  };
  const orderService = new SalesOrderService(f.options);
  const lifecycle = new SalesOrderLifecycleService(f.options);
  const conflict = { code: "SALES_STATE_CONFLICT", statusCode: 409 };
  await assert.rejects(() => f.execute(() => orderService.update({
    claims, id: orderId,
    input: {
      eventId: randomUUID(), version: originalOrder.version, customerId,
      currencyCode: replacementCurrency, paymentTermId: null, fulfillmentWarehouseId: warehouseId,
      orderDate: originalOrder.orderDate, lines: [{ skuId, skuUomId, quantity: "7.000000", unitSellingPrice: "2.0000" }]
    }
  })), conflict);
  await assert.rejects(() => f.execute(() => lifecycle.withdrawConfirmation({
    claims, id: orderId,
    input: { eventId: randomUUID(), version: originalOrder.version, reason: "Synthetic attempt to edit after shipment" }
  })), conflict);

  assert.deepEqual(await readSalesOrderDetail(f.db, orderId), originalOrder);
  assert.deepEqual(await readInvoiceSources(), sources);
});
