import assert from "node:assert/strict";
import test from "node:test";

import { RequestValidator } from "../src/framework/validation/requestValidator.js";
import { ResponseValidator } from "../src/framework/validation/responseValidator.js";
import {
  CreateInventoryAllocationHandler,
  ReallocateInventoryAllocationHandler,
  ReleaseInventoryAllocationHandler
} from "../src/handlers/inventory/allocationHandlers.js";

const services = { require(name) {
  if (name === "mysqldatabase") return { withTransaction() {} };
  if (name === "logging") return { logger: { error() {} } };
  if (name === "time") return { nowMs: () => 1, fileDate: () => "2026-09-29" };
  throw new Error(name);
} };

test("TASK-023 Allocation commands expose strict, idempotent, operation-authorized contracts", () => {
  for (const Handler of [CreateInventoryAllocationHandler, ReleaseInventoryAllocationHandler, ReallocateInventoryAllocationHandler]) {
    const api = Handler.api;
    assert.equal(api.method, "POST");
    assert.deepEqual(api.authorizationPolicies[0].options.permissions, ["inventory.view", "inventory.operation"]);
    assert.deepEqual(api.idempotency, { enabled: true });
    assert.equal(api.requestSchema.body.additionalProperties, false);
    new RequestValidator().compile(api.requestSchema, api.path);
    new ResponseValidator({ environment: "production" }).compile(api.responseSchema, api.path);
  }
});

test("TASK-023 Allocation handlers bind owner/version/source and never accept caller permission names", async () => {
  const source = { module: "FULFILLMENT", documentType: "SHIPMENT", documentId: "S-1", eventId: "allocate-1" };
  const allocation = { balanceId: 4, expectedVersion: 2, quantity: 3 };
  const release = { allocationId: 8, expectedVersion: 1, quantity: 3 };
  for (const [Handler, method, body, expected] of [
    [CreateInventoryAllocationHandler, "allocate", { source, version: 5, allocations: [allocation] },
      { reservationId: 7, expectedVersion: 5, allocations: [allocation] }],
    [ReleaseInventoryAllocationHandler, "releaseAllocation", { source, version: 5, releases: [release] },
      { reservationId: 7, expectedVersion: 5, releases: [release] }],
    [ReallocateInventoryAllocationHandler, "reallocateAllocation",
      { source, version: 5, releases: [release], allocations: [allocation], overrideReason: "FIFO choice" },
      { reservationId: 7, expectedVersion: 5, releases: [release], allocations: [allocation], overrideReason: "FIFO choice" }]
  ]) {
    const handler = new Handler(services);
    let received;
    handler.inventory = { async [method](command) { received = command; return { reservationId: 7 }; } };
    await handler.execute({
      auth: { claims: { sub: "9", roles: [], permissions: ["inventory.operation"] } },
      input: { params: { id: 7 }, body }, requestId: "req-1"
    });
    assert.deepEqual(received.payload, expected);
    assert.equal(received.authorization.requiredCallerPermission, "inventory.operation");
    assert.equal(received.source, source);
  }
});
