import assert from "node:assert/strict";
import test from "node:test";
import { fulfillmentQueuePageQuery } from "../../src/modules/fulfillment/FulfillmentQueueService.js";
import { normalizeFulfillmentQueueQuery, encodeFulfillmentQueueCursor } from "../../src/modules/fulfillment/fulfillmentQueueQuery.js";
const last = { requestedDeliveryDate: null, orderDate: "2026-10-23", salesOrderNumber: "SO-1", id: "9" };
test("Queue bounds header discovery, parameterizes searches and never uses OFFSET", () => {
  const malicious = "x%' OR 1=1 --", { sql, values } = fulfillmentQueuePageQuery(normalizeFulfillmentQueueQuery({ q: malicious, pageSize: 10, hasActiveWork: false, hasBackorder: true, warehouseId: 3 }));
  assert.doesNotMatch(sql, /OFFSET|x%/u); assert.match(sql, /LIMIT \?/u);
  assert.equal(values.at(-1), 11); assert.ok(values.includes(malicious));
  assert.ok(values.includes("x!%' OR 1=1 --%"));
  assert.match(sql, /NOT EXISTS/u);
});
test("Queue default seek preserves nullable-date ties and stable primary-key ordering", () => {
  const first = normalizeFulfillmentQueueQuery({}), cursor = encodeFulfillmentQueueCursor(first, last);
  const { sql, values } = fulfillmentQueuePageQuery(normalizeFulfillmentQueueQuery({ page: 2, cursor }));
  assert.match(sql, /o.requested_delivery_date IS NOT NULL/u);
  assert.match(sql, /o.requested_delivery_date <=> \?/u);
  assert.match(sql, /o.id > \?/u); assert.ok(values.includes("9"));
  assert.match(sql, /ORDER BY o.requested_delivery_date ASC,o.order_date ASC,o.sales_order_number ASC,o.id ASC/u);
});
test("Queue descending seek includes NULL after a real date and applies selected sort", () => {
  const first = normalizeFulfillmentQueueQuery({ descending: true });
  const cursor = encodeFulfillmentQueueCursor(first, { ...last, requestedDeliveryDate: "2026-10-24" });
  const { sql } = fulfillmentQueuePageQuery(normalizeFulfillmentQueueQuery({ descending: true, page: 2, cursor }));
  assert.match(sql, /o.requested_delivery_date < \? OR o.requested_delivery_date IS NULL/u);
  assert.match(sql, /o.id < \?/u);
  assert.match(fulfillmentQueuePageQuery(normalizeFulfillmentQueueQuery({ sortBy: "salesOrderNumber" })).sql, /ORDER BY o.sales_order_number ASC,o.id ASC/u);
});
