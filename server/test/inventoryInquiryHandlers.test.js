import assert from "node:assert/strict";
import test from "node:test";

import { RequestValidator } from "../src/framework/validation/requestValidator.js";
import { ResponseValidator } from "../src/framework/validation/responseValidator.js";
import * as inquiryHandlers from "../src/handlers/inventory/inquiryHandlers.js";

const handlers = Object.values(inquiryHandlers)
  .filter((value) => typeof value === "function" && value.api);

test("TASK-016 inquiry routes expose strict read-only inventory.view contracts", () => {
  assert.equal(handlers.length, 8);
  assert.ok(
    handlers.indexOf(inquiryHandlers.GetInventoryStockAggregateHandler) <
      handlers.indexOf(inquiryHandlers.GetInventoryStockHandler),
    "the static /stocks/summary route must register before /stocks/:balanceId"
  );
  assert.deepEqual(handlers.map((Handler) => Handler.api.path).sort(), [
    "/api/v1/inventory/expiry",
    "/api/v1/inventory/lots",
    "/api/v1/inventory/movements",
    "/api/v1/inventory/movements/:id",
    "/api/v1/inventory/operations/by-source",
    "/api/v1/inventory/stocks",
    "/api/v1/inventory/stocks/:balanceId",
    "/api/v1/inventory/stocks/summary"
  ]);
  for (const Handler of handlers) {
    assert.equal(Handler.api.method, "GET");
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["inventory.view"]);
    for (const schema of Object.values(Handler.api.requestSchema)) assert.equal(schema.additionalProperties, false);
  }
});

test("TASK-016 inquiry schemas compile and bound every paginated list to 100 rows", () => {
  const request = new RequestValidator();
  const response = new ResponseValidator({ environment: "production" });
  for (const Handler of handlers) {
    request.compile(Handler.api.requestSchema, Handler.api.path);
    response.compile(Handler.api.responseSchema, Handler.api.path);
  }
  for (const Handler of [
    inquiryHandlers.ListInventoryStocksHandler,
    inquiryHandlers.ListInventoryLotsHandler,
    inquiryHandlers.ListInventoryMovementsHandler,
    inquiryHandlers.ListInventoryExpiryHandler
  ]) {
    assert.equal(Handler.api.requestSchema.query.properties.pageSize.maximum, 100);
    assert.equal(Handler.api.requestSchema.query.properties.pageSize.default, 20);
  }
  assert.equal(inquiryHandlers.ListInventoryMovementsHandler.api.requestSchema.query.properties.sortBy, undefined);
});

test("TASK-016 handlers pass only validated params and query values to the inquiry service", async () => {
  const services = {
    require(name) {
      if (name === "mysqldatabase") return { query() {} };
      if (name === "time") return { fileDate: () => "2026-09-28" };
      throw new Error(name);
    }
  };
  const handler = new inquiryHandlers.GetInventoryStockHandler(services);
  let received;
  handler.inventory = { async getStock(balanceId) { received = balanceId; return { balanceId }; } };

  const result = await handler.execute({ input: { params: { balanceId: 12 }, query: {} } });
  assert.equal(received, 12);
  assert.deepEqual(result.data, { balanceId: 12 });
});

test("TASK-016 source lookup constructs the complete exact tuple", async () => {
  const services = {
    require(name) {
      if (name === "mysqldatabase") return { query() {} };
      if (name === "time") return { fileDate: () => "2026-09-28" };
      throw new Error(name);
    }
  };
  const handler = new inquiryHandlers.GetInventoryOperationBySourceHandler(services);
  let received;
  handler.inventory = { async findOperationBySource(input) { received = input; return null; } };
  const query = {
    sourceModule: "RETURNS", sourceDocumentType: "CUSTOMER_RETURN", sourceDocumentId: "R-1",
    sourceLineId: "", sourceEventId: "posted"
  };

  const result = await handler.execute({ input: { params: {}, query } });
  assert.deepEqual(received, {
    source: { module: "RETURNS", documentType: "CUSTOMER_RETURN", documentId: "R-1", lineId: "", eventId: "posted" }
  });
  assert.deepEqual(result.data, null);
});
