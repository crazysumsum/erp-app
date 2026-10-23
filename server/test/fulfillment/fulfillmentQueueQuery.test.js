import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFulfillmentQueueQuery, encodeFulfillmentQueueCursor, projectFulfillmentQueueLine } from "../../src/modules/fulfillment/fulfillmentQueueQuery.js";
const invalid = fn => assert.throws(fn, { code: "FULFILLMENT_INPUT_INVALID" });
const position = { requestedDeliveryDate: null, orderDate: "2026-10-23", salesOrderNumber: "SO-202610-0001", id: "91" };
test("Queue normalizes first-page defaults without mutating filters", () => {
  const input = { warehouseId: 3, hasBackorder: false }, query = normalizeFulfillmentQueueQuery(input);
  assert.equal(query.page, 1); assert.equal(query.pageSize, 20);
  assert.equal(query.sortBy, "requestedDeliveryDate"); assert.equal(query.descending, false);
  assert.deepEqual(input, { warehouseId: 3, hasBackorder: false });
});
test("Queue refuses unknown filters, coercion, invalid bounds and ineligible statuses", () => {
  for (const input of [{ page: null }, { pageSize: null }, { sortBy: null }, { descending: null }, { extra: true }, { page: 0 }, { pageSize: 101 }, { pageSize: "20" }, { warehouseId: 0 }, { customerId: 1.1 }, { hasActiveWork: "false" }, { descending: "true" }, { salesOrderStatus: "DRAFT" }, { sortBy: "price" }, { q: "x".repeat(191) }, null, []]) invalid(() => normalizeFulfillmentQueueQuery(input));
});
test("Queue validates calendar dates and ordered date bounds", () => {
  assert.equal(normalizeFulfillmentQueueQuery({ requestedDateFrom: "2024-02-29" }).requestedDateFrom, "2024-02-29");
  for (const input of [{ requestedDateFrom: "2026-02-29" }, { requestedDateTo: "2026-2-01" }, { requestedDateFrom: "2026-10-24", requestedDateTo: "2026-10-23" }]) invalid(() => normalizeFulfillmentQueueQuery(input));
});
test("Queue cursor roundtrips NULL and binds filters, sort, page size and next-page sequence", () => {
  const cursor = encodeFulfillmentQueueCursor(normalizeFulfillmentQueueQuery({ warehouseId: 3 }), position);
  assert.deepEqual(normalizeFulfillmentQueueQuery({ warehouseId: 3, page: 2, cursor }).after, position);
  for (const changed of [{ warehouseId: 4 }, { pageSize: 21 }, { descending: true }, { sortBy: "orderDate" }, { hasBackorder: false }]) invalid(() => normalizeFulfillmentQueueQuery({ warehouseId: 3, page: 2, cursor, ...changed }));
  invalid(() => normalizeFulfillmentQueueQuery({ page: 2 }));
  invalid(() => normalizeFulfillmentQueueQuery({ warehouseId: 3, page: 3, cursor }));
  invalid(() => normalizeFulfillmentQueueQuery({ warehouseId: 3, cursor }));
});
test("Queue refuses oversized, malformed, noncanonical and unknown-field cursors", () => {
  for (const cursor of ["x".repeat(2049), "not+base64", Buffer.from(JSON.stringify({ version: 1, sql: "DROP TABLE sales_orders" })).toString("base64url")]) invalid(() => normalizeFulfillmentQueueQuery({ page: 2, cursor }));
});
const line = () => ({ id: "11", sales_order_id: "1", line_no: 1, sku_id: "7", sku_code_snapshot: "SKU-7", sku_name_snapshot: "產品", reserved_outstanding_base_quantity: "20", inventory_outstanding: "20", active_claimed: "8", backordered_base_quantity: "5", fulfilled_base_quantity: "2" });
test("Queue uses actual Reservation less active Claims and allowlists public line fields", () => {
  const source = { ...line(), price: "999", contact: "private" };
  assert.deepEqual(projectFulfillmentQueueLine(source), { id: "11", salesOrderId: "1", lineNo: 1, skuId: "7", skuCode: "SKU-7", skuName: "產品", reservedOutstandingBaseQuantity: "20", activeClaimedBaseQuantity: "8", fulfillableBaseQuantity: "12", backorderedBaseQuantity: "5", fulfilledBaseQuantity: "2" });
  assert.equal(source.active_claimed, "8");
});
test("Queue preserves zero availability for fully claimed and pure backorder lines", () => {
  assert.equal(projectFulfillmentQueueLine({ ...line(), active_claimed: "20" }).fulfillableBaseQuantity, "0");
  assert.equal(projectFulfillmentQueueLine({ ...line(), reserved_outstanding_base_quantity: "0", inventory_outstanding: "0", active_claimed: "0" }).fulfillableBaseQuantity, "0");
});
test("Queue refuses negative availability and Sales/Inventory disagreement instead of clamping", () => {
  for (const patch of [{ active_claimed: "21" }, { inventory_outstanding: "19" }, { inventory_outstanding: "21" }]) assert.throws(() => projectFulfillmentQueueLine({ ...line(), ...patch }), { code: "FULFILLMENT_SOURCE_CONFLICT" });
});
test("Queue arithmetic remains exact at safe integer limit and rejects malformed counters", () => {
  assert.equal(projectFulfillmentQueueLine({ ...line(), reserved_outstanding_base_quantity: "9007199254740991", inventory_outstanding: "9007199254740991", active_claimed: "1" }).fulfillableBaseQuantity, "9007199254740990");
  for (const quantity of ["-1", "01", "9007199254740992", 20, null]) assert.throws(() => projectFulfillmentQueueLine({ ...line(), inventory_outstanding: quantity }));
});

test("Queue refuses unsafe owner IDs and malformed line positions", () => {
  for (const patch of [{ id: "0" }, { sales_order_id: "9007199254740992" }, { sku_id: "01" }, { line_no: 0 }, { line_no: "1" }, { line_no: 101 }]) assert.throws(() => projectFulfillmentQueueLine({ ...line(), ...patch }));
});
