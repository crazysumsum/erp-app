import assert from "node:assert/strict";
import test from "node:test";

import { RequestValidator } from "../src/framework/validation/requestValidator.js";
import { ResponseValidator } from "../src/framework/validation/responseValidator.js";
import { PostInventoryIssueHandler, PostInventoryReceiptHandler } from "../src/handlers/inventory/postingHandlers.js";
import * as postingHandlers from "../src/handlers/inventory/postingHandlers.js";
import { InventoryPostingService } from "../src/modules/inventory/InventoryPostingService.js";

test("TASK-014 Receipt route exposes the strict operation contract", () => {
  const api = PostInventoryReceiptHandler.api;
  assert.equal(api.method, "POST");
  assert.equal(api.path, "/api/v1/inventory/receipts");
  assert.deepEqual(api.authorizationPolicies[0].options.permissions, ["inventory.view", "inventory.operation"]);
  assert.deepEqual(api.idempotency, { enabled: true });
  assert.equal(api.requestSchema.body.additionalProperties, false);
  assert.deepEqual(api.requestSchema.body.properties.stockStatus.enum, ["AVAILABLE", "QUARANTINED", "DAMAGED"]);
  new RequestValidator().compile(api.requestSchema, api.path);
  new ResponseValidator({ environment: "production" }).compile(api.responseSchema, api.path);
});

test("TASK-014 Receipt handler maps trusted actor and source into a fixed command context", async () => {
  const services = {
    require(name) {
      if (name === "mysqldatabase") return { query() {}, withTransaction() {} };
      if (name === "logging") return { logger: { error() {} } };
      if (name === "time") return { nowMs: () => 1, fileDate: () => "2026-09-28" };
      throw new Error(name);
    }
  };
  const handler = new PostInventoryReceiptHandler(services);
  let received;
  handler.inventory = { async postReceipt(input) { received = input; return { status: "POSTED" }; } };
  const body = {
    source: {
      module: "RECEIVING", documentType: "PURCHASE_RECEIPT", documentId: "receipt-42",
      lineId: "10", eventId: "posted-1"
    },
    skuId: 12, quantity: 2, uomId: 8, warehouseId: 2, binId: 35, stockStatus: "AVAILABLE"
  };

  const response = await handler.execute({
    auth: { claims: { sub: "7", roles: ["warehouse-operator"], permissions: ["inventory.view", "inventory.operation"] } },
    input: { body },
    requestId: "request-1"
  });

  assert.deepEqual(received, {
    actor: {
      userId: 7,
      serviceName: "",
      claimedRoles: ["warehouse-operator"],
      claimedPermissions: ["inventory.view", "inventory.operation"]
    },
    authorization: { purpose: "receipt.post", requiredCallerPermission: "inventory.operation" },
    source: body.source,
    correlationId: "request-1",
    payload: { skuId: 12, quantity: 2, uomId: 8, warehouseId: 2, binId: 35, stockStatus: "AVAILABLE" }
  });
  assert.deepEqual(response.data, { status: "POSTED" });
});

test("TASK-023 direct Issue HTTP path uses Inventory operation, not Fulfillment internal permission", async () => {
  const paths = Object.values(postingHandlers)
    .filter((value) => typeof value === "function" && value.api)
    .map((Handler) => Handler.api.path);
  assert.equal(paths.includes("/api/v1/inventory/issues"), true);
  assert.equal(typeof InventoryPostingService.prototype.postIssueInTransaction, "function");
  const api = PostInventoryIssueHandler.api;
  assert.deepEqual(api.authorizationPolicies[0].options.permissions, ["inventory.view", "inventory.operation"]);
  assert.deepEqual(api.idempotency, { enabled: true });
  assert.equal(api.requestSchema.body.additionalProperties, false);
  new RequestValidator().compile(api.requestSchema, api.path);
  new ResponseValidator({ environment: "production" }).compile(api.responseSchema, api.path);
  const handler = new PostInventoryIssueHandler({ require(name) {
    if (name === "mysqldatabase") return { withTransaction() {} };
    if (name === "logging") return { logger: { error() {} } };
    if (name === "time") return { nowMs: () => 1, fileDate: () => "2026-09-29" };
    throw new Error(name);
  } });
  let received;
  handler.inventory = { async postIssue(command) { received = command; return { status: "POSTED" }; } };
  const source = { module: "FULFILLMENT", documentType: "SHIPMENT", documentId: "S-1", eventId: "post-1" };
  const lines = [{ allocationId: 8, expectedVersion: 2, balanceId: 4, expectedBalanceVersion: 3, quantity: 1 }];
  await handler.execute({
    auth: { claims: { sub: "9", roles: [], permissions: ["inventory.operation"] } },
    input: { body: { source, reservationId: 7, version: 5, lines } }, requestId: "req-1"
  });
  assert.deepEqual(received.authorization, { purpose: "issue.post", requiredCallerPermission: "inventory.operation" });
  assert.deepEqual(received.payload, { reservationId: 7, expectedVersion: 5, lines });
  assert.deepEqual(received.source, source);
});
