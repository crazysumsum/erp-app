import assert from "node:assert/strict";
import test from "node:test";
import { fulfillmentQueueRequest, FULFILLMENT_QUEUE_RESPONSE } from "../../src/handlers/fulfillment-queue/fulfillmentQueueSchemas.js";
import { ListFulfillmentQueueHandler } from "../../src/handlers/fulfillment-queue/listFulfillmentQueueHandler.js";
import { RequestValidator } from "../../src/framework/validation/requestValidator.js";
test("Queue HTTP query conversion is isolated, exact and rejects unknown or malformed filters", () => {
  const query = { page: "1", pageSize: "10", hasBackorder: "false", warehouseId: "4" };
  const result = fulfillmentQueueRequest({ input: { query } });
  assert.equal(result.page, 1); assert.equal(result.pageSize, 10); assert.equal(result.hasBackorder, false); assert.equal(result.warehouseId, 4);
  assert.equal(query.page, "1");
  for (const input of [{ extra: "x" }, { pageSize: "101" }, { hasBackorder: "maybe" }, { requestedDateFrom: "2026-02-30" }, { page: "2" }, { salesOrderStatus: "CANCELLED" }]) assert.throws(() => fulfillmentQueueRequest({ input: { query: input } }), { code: "FULFILLMENT_INPUT_INVALID" });
});
test("Queue handler requires view and exposes bounded allowlisted output", () => {
  assert.equal(ListFulfillmentQueueHandler.api.method, "GET"); assert.equal(ListFulfillmentQueueHandler.api.path, "/api/v1/fulfillment-queue");
  assert.deepEqual(ListFulfillmentQueueHandler.api.authorizationPolicies, [{ name: "hasPermission", options: { permissions: ["fulfillment.view"] } }]);
  assert.equal(FULFILLMENT_QUEUE_RESPONSE.properties.items.maxItems, 100);
  assert.equal(FULFILLMENT_QUEUE_RESPONSE.properties.items.items.properties.lines.maxItems, 100);
  assert.equal(FULFILLMENT_QUEUE_RESPONSE.properties.items.items.additionalProperties, false);
  assert.doesNotMatch(JSON.stringify(FULFILLMENT_QUEUE_RESPONSE), /price|tax|bank|address|token/iu);
});
test("Queue response contract rejects accidental private fields and malformed pagination", () => {
  const validate = new RequestValidator({ config: { enabled: true, coerceTypes: false } }).compile({ body: FULFILLMENT_QUEUE_RESPONSE }, "Queue response test");
  validate({ body: { items: [], page: 1, pageSize: 20, hasMore: false, nextCursor: null } });
  for (const body of [{ items: [], page: 1, pageSize: 20, hasMore: false, nextCursor: null, bank: "private" }, { items: [], page: 0, pageSize: 20, hasMore: false, nextCursor: null }]) assert.throws(() => validate({ body }), { code: "REQUEST_VALIDATION_FAILED" });
});
