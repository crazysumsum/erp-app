import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { up as seedPurchasingPermissions } from "../../database/migrations/0100_seed_purchasing_permissions.js";
import { up as seedReturnsPermissions } from "../../database/migrations/0132_seed_returns_permissions.js";
import { reversalFixture } from "../fulfillment/shipmentReversalFixture.js";
import { startP1Http } from "../fulfillment/p1Fixture.js";
import { findShipmentReturnsInTransaction } from "../../src/modules/returns/findShipmentReturnsInTransaction.js";
import { confirmedSupplierReceipt } from "../returns/supplierReturnFixture.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("return drafts use original shipments and receipts, reject another warehouse and replay safely", async t => {
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
  const api = await startP1Http(t, f);

  const [[issue]] = await f.db.query("SELECT * FROM shipment_issue_details WHERE shipment_id = ? ORDER BY id LIMIT 1", [f.shipmentId]);
  const otherWarehouse = await f.s.insert("inventory_warehouses", {
    warehouse_code: "RT-OTHER", normalized_code: "rt-other", warehouse_name: "Other", status: "ACTIVE", created_at: f.s.now, updated_at: f.s.now
  });
  const otherBin = await f.s.insert("inventory_bins", {
    warehouse_id: otherWarehouse, bin_code: "RT-B", normalized_code: "rt-b", status: "ACTIVE", created_at: f.s.now, updated_at: f.s.now
  });
  const source = await api("GET", `/api/v1/customer-returns/sources/${f.shipment.shipment_number}`);
  assert.equal(source.status, 200, JSON.stringify(source.body));
  assert.equal(source.body.data.details[0].id, String(issue.id));
  assert.ok(!source.body.data.bins.some(bin => bin.id === String(otherBin)));
  const body = {
    eventId: randomUUID(), sourceId: f.shipmentId, returnDate: "2026-11-25", reason: "Synthetic returns fixture",
    lines: [{ sourceDetailId: String(issue.id), baseQuantity: "1", binId: String(otherBin) }]
  };
  const post = (path, payload) => api("POST", path, payload, { key: payload.eventId });
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

  const { receipt, detail: receiptDetail } = await confirmedSupplierReceipt(f, api, issue.bin_id);
  const supplierSource = await api("GET", `/api/v1/supplier-returns/sources/${receipt.number}`);
  assert.equal(supplierSource.status, 200, JSON.stringify(supplierSource.body));
  assert.equal(supplierSource.body.data.details[0].remainingBaseQuantity, "5");
  const supplierBody = {
    ...body, eventId: randomUUID(), sourceId: String(receipt.id),
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
});
