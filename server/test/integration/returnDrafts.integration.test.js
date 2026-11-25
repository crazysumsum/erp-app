import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { up as seedPurchasingPermissions } from "../../database/migrations/0100_seed_purchasing_permissions.js";
import { InventoryReturnPostingService } from "../../src/modules/inventory/InventoryReturnPostingService.js";
import { up as seedReturnsPermissions } from "../../database/migrations/0132_seed_returns_permissions.js";
import { reversalFixture } from "../fulfillment/shipmentReversalFixture.js";
import { startP1Http } from "../fulfillment/p1Fixture.js";
import { findShipmentReturnsInTransaction } from "../../src/modules/returns/findShipmentReturnsInTransaction.js";
import { installShipmentCostFixture } from "../returns/returnShipmentCostFixture.js";
import { confirmedSupplierReceipt } from "../returns/supplierReturnFixture.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

async function stockFacts(f, kind) {
  const [rows] = await f.db.query(
    `SELECT CAST(m.id AS CHAR) AS id, m.direction, m.quantity, m.stock_status, c.original_entry_id, c.value_delta_hkd
      FROM inventory_movements m JOIN inventory_cost_entries c ON c.movement_id = m.id WHERE m.movement_type = ? ORDER BY m.id`, [kind]);
  return rows;
}

async function returnPostingFixture(t) {
  const f = await reversalFixture(t);
  const permissions = ["returns.view", "returns.customer.mgmt", "returns.supplier.mgmt", "purchasing.view", "receiving.operation"];
  const role = f.claims.roles[0];
  // startP1Http installs the registered migrations into this fixture's private schema.
  await seedReturnsPermissions(f.db);
  await seedPurchasingPermissions(f.db);
  await f.db.query(
    `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN (?, ?, ?, ?, ?) WHERE r.name = ?`, [...permissions, role]);
  f.claims.permissions.push(...permissions);
  const [[issue]] = await f.db.query("SELECT * FROM shipment_issue_details WHERE shipment_id = ? ORDER BY id LIMIT 1", [f.shipmentId]);
  await installShipmentCostFixture(f, issue);
  const api = await startP1Http(t, f);
  const otherWarehouse = await f.s.insert("inventory_warehouses", {
    warehouse_code: "RT-OTHER", normalized_code: "rt-other", warehouse_name: "Other", status: "ACTIVE", created_at: f.s.now, updated_at: f.s.now
  });
  const otherBin = await f.s.insert("inventory_bins", {
    warehouse_id: otherWarehouse, bin_code: "RT-B", normalized_code: "rt-b", status: "ACTIVE", created_at: f.s.now, updated_at: f.s.now
  });
  const post = (path, payload) => api("POST", path, payload, { key: payload.eventId });
  return { f, api, post, issue, otherBin };
}

integrationTest("customer returns link every movement before posting and roll back a failed batch", async t => {
  const { f, api, post, issue, otherBin } = await returnPostingFixture(t);
  const source = await api("GET", `/api/v1/customer-returns/sources/${f.shipment.shipment_number}`);
  assert.equal(source.status, 200, JSON.stringify(source.body));
  assert.equal(source.body.data.details[0].id, String(issue.id));
  assert.ok(!source.body.data.bins.some(bin => bin.id === String(otherBin)));
  const body = {
    eventId: randomUUID(), sourceId: f.shipmentId, returnDate: "2026-11-25", reason: "Synthetic returns fixture",
    lines: [{ sourceDetailId: String(issue.id), baseQuantity: "1", binId: String(otherBin) }]
  };
  const rejected = await post("/api/v1/customer-returns", body);
  assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
  assert.equal(rejected.body.error.code, "CUSTOMER_RETURN_WAREHOUSE_MISMATCH");
  assert.equal((await api("GET", "/api/v1/customer-returns", undefined, { auth: false })).status, 401);

  body.lines[0].binId = String(issue.bin_id);
  body.eventId = randomUUID();
  const created = await post("/api/v1/customer-returns", body);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.data.status, "DRAFT");
  const returnId = created.body.data.id;
  assert.deepEqual((await post("/api/v1/customer-returns", body)).body, created.body);
  const list = await api("GET", `/api/v1/customer-returns?salesOrderId=${f.s.orderId}&page=1&pageSize=20`);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.items[0].returnNumber, `CRT-${returnId}`);
  assert.equal(list.body.data.items[0].shipmentId, f.shipmentId);
  const detail = await api("GET", `/api/v1/customer-returns/${returnId}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.data.lines[0].stockStatus, "QUARANTINED");
  const occupancy = () => f.execute(() => f.database.withTransaction(async tx => {
    await tx.query("SELECT id FROM shipments WHERE id = ? FOR UPDATE", [f.shipmentId]);
    return (await findShipmentReturnsInTransaction(tx, { shipmentIds: [f.shipmentId] }))[0].openReturnCount;
  }, { isolationLevel: "READ COMMITTED" }));
  assert.equal(await occupancy(), 1);
  const cancelled = await post(`/api/v1/customer-returns/${returnId}/cancel`, { eventId: randomUUID(), version: 1 });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.data.status, "CANCELLED");
  assert.equal(await occupancy(), 0);


  // Post rechecks the warehouse, even if a draft had passed create-time checks.
  const newCustomerDraft = async quantities => {
    const response = await post("/api/v1/customer-returns", {
      ...body, eventId: randomUUID(), lines: quantities.map(baseQuantity => ({ ...body.lines[0], baseQuantity }))
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body.data.id;
  };
  const twoLines = await newCustomerDraft(["1", "1"]);
  const customerPath = `/api/v1/customer-returns/${twoLines}/post`;
  await f.db.execute("UPDATE customer_return_lines SET bin_id = ? WHERE return_id = ? AND line_no = 2", [otherBin, twoLines]);
  const blockedCustomer = await post(customerPath, { eventId: randomUUID(), version: 1 });
  assert.equal(blockedCustomer.body.error?.code, "CUSTOMER_RETURN_WAREHOUSE_MISMATCH", JSON.stringify(blockedCustomer.body));
  assert.deepEqual(await stockFacts(f, "CUSTOMER_RETURN"), []);
  await f.db.execute("UPDATE customer_return_lines SET bin_id = ? WHERE return_id = ? AND line_no = 2", [issue.bin_id, twoLines]);

  // Fault after the real provider has written its two movements and costs. The
  // caller writes the first line, rejects the second result, and rolls back both layers.
  const customerCommand = { eventId: randomUUID(), version: 1 };
  const originalPost = InventoryReturnPostingService.prototype.postCustomerReturnReceiptBatchInTransaction;
  InventoryReturnPostingService.prototype.postCustomerReturnReceiptBatchInTransaction = async function (...args) {
    const result = await originalPost.apply(this, args);
    result.lines[1].movementId = "invalid";
    return result;
  };
  try {
    const malformed = await post(customerPath, customerCommand);
    assert.equal(malformed.status, 503, JSON.stringify(malformed.body));
    assert.equal(malformed.body.error?.code, "RETURN_INVENTORY_UNAVAILABLE");
  } finally {
    InventoryReturnPostingService.prototype.postCustomerReturnReceiptBatchInTransaction = originalPost;
  }
  const rolledBack = await api("GET", `/api/v1/customer-returns/${twoLines}`);
  assert.equal(rolledBack.body.data.status, "DRAFT");
  assert.deepEqual(rolledBack.body.data.lines.map(line => line.inventoryMovementId), [null, null]);
  assert.deepEqual(await stockFacts(f, "CUSTOMER_RETURN"), []);
  const [[failedOperations]] = await f.db.query("SELECT COUNT(*) AS total FROM returns_operation_requests WHERE event_id = ?", [customerCommand.eventId]);
  assert.equal(Number(failedOperations.total), 0);

  const postedCustomer = await post(customerPath, customerCommand);
  assert.equal(postedCustomer.status, 200, JSON.stringify(postedCustomer.body));
  assert.equal(postedCustomer.body.data.status, "POSTED");
  assert.deepEqual((await post(customerPath, customerCommand)).body, postedCustomer.body);
  const customerFacts = await stockFacts(f, "CUSTOMER_RETURN");
  assert.deepEqual(customerFacts.map(row => [row.direction, Number(row.quantity), row.stock_status, row.value_delta_hkd]),
    [["IN", 1, "QUARANTINED", "1.0000"], ["IN", 1, "QUARANTINED", "1.0000"]]);
  const customerDetail = await api("GET", `/api/v1/customer-returns/${twoLines}`);
  assert.deepEqual(customerDetail.body.data.lines.map(line => line.inventoryMovementId), customerFacts.map(row => row.id));
  assert.equal(await occupancy(), 1);

  const lastDraftIds = [await newCustomerDraft(["1"]), await newCustomerDraft(["1"])];
  const customerRace = await Promise.all(lastDraftIds.map(id =>
    post(`/api/v1/customer-returns/${id}/post`, { eventId: randomUUID(), version: 1 })));
  assert.deepEqual(customerRace.map(response => response.status).sort(), [200, 409]);
  assert.equal(customerRace.find(response => response.status === 409).body.error?.code, "RETURN_QUANTITY_EXCEEDED");
  assert.equal((await stockFacts(f, "CUSTOMER_RETURN")).length, 3);

});

integrationTest("supplier returns post against the original receipt without changing it and serialize the shared quantity cap", async t => {
  const { f, api, post, issue, otherBin } = await returnPostingFixture(t);
  const { receipt, detail: receiptDetail } = await confirmedSupplierReceipt(f, api, issue.bin_id);
  const supplierSource = await api("GET", `/api/v1/supplier-returns/sources/${receipt.number}`);
  assert.equal(supplierSource.status, 200, JSON.stringify(supplierSource.body));
  assert.equal(supplierSource.body.data.details[0].remainingBaseQuantity, "5");
  const supplierBody = {
    eventId: randomUUID(), sourceId: String(receipt.id), returnDate: "2026-11-25", reason: "Synthetic supplier return",
    lines: [{ sourceDetailId: String(receiptDetail.id), baseQuantity: "1", binId: String(otherBin), stockStatus: "AVAILABLE" }]
  };
  const wrongWarehouse = await post("/api/v1/supplier-returns", supplierBody);
  assert.equal(wrongWarehouse.status, 409, JSON.stringify(wrongWarehouse.body));
  assert.equal(wrongWarehouse.body.error.code, "SUPPLIER_RETURN_WAREHOUSE_MISMATCH");
  supplierBody.lines[0].binId = String(issue.bin_id);
  supplierBody.eventId = randomUUID();
  const supplierDraft = await post("/api/v1/supplier-returns", supplierBody);
  assert.equal(supplierDraft.status, 200, JSON.stringify(supplierDraft.body));
  const supplierDetail = await api("GET", `/api/v1/supplier-returns/${supplierDraft.body.data.id}`);
  assert.equal(supplierDetail.status, 200, JSON.stringify(supplierDetail.body));
  assert.equal(supplierDetail.body.data.goodsReceiptNumber, receipt.number);
  assert.equal(supplierDetail.body.data.lines[0].stockStatus, "AVAILABLE");

  const supplierId = supplierDraft.body.data.id;
  const supplierPath = `/api/v1/supplier-returns/${supplierId}/post`;
  await f.db.execute("UPDATE supplier_return_lines SET bin_id = ? WHERE return_id = ?", [otherBin, supplierId]);
  const blockedSupplier = await post(supplierPath, { eventId: randomUUID(), version: 1 });
  assert.equal(blockedSupplier.body.error?.code, "SUPPLIER_RETURN_WAREHOUSE_MISMATCH", JSON.stringify(blockedSupplier.body));
  assert.deepEqual(await stockFacts(f, "SUPPLIER_RETURN"), []);
  await f.db.execute("UPDATE supplier_return_lines SET bin_id = ? WHERE return_id = ?", [issue.bin_id, supplierId]);

  const competing = await post("/api/v1/supplier-returns", {
    ...supplierBody, eventId: randomUUID(), lines: [{ ...supplierBody.lines[0], baseQuantity: "5" }]
  });
  assert.equal(competing.status, 200, JSON.stringify(competing.body));
  const supplierRace = await Promise.all([supplierPath, `/api/v1/supplier-returns/${competing.body.data.id}/post`]
    .map(path => post(path, { eventId: randomUUID(), version: 1 })));
  assert.deepEqual(supplierRace.map(response => response.status).sort(), [200, 409]);
  assert.equal(supplierRace.find(response => response.status === 409).body.error?.code, "RETURN_QUANTITY_EXCEEDED");
  const [supplierFact, ...extra] = await stockFacts(f, "SUPPLIER_RETURN");
  assert.deepEqual(extra, []);
  assert.equal(supplierFact.direction, "OUT");
  assert.equal(supplierFact.value_delta_hkd, `-${Number(supplierFact.quantity).toFixed(4)}`);
  const [[storedReceipt]] = await f.db.query("SELECT status, total_received_base_quantity, total_reversed_base_quantity FROM goods_receipts WHERE id = ?", [receipt.id]);
  assert.deepEqual([storedReceipt.status, Number(storedReceipt.total_received_base_quantity), Number(storedReceipt.total_reversed_base_quantity)], ["CONFIRMED", 5, 0]);
});
