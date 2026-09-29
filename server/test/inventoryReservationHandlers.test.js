import assert from "node:assert/strict";
import test from "node:test";

import { RequestValidator } from "../src/framework/validation/requestValidator.js";
import { ResponseValidator } from "../src/framework/validation/responseValidator.js";
import {
  CancelInventoryReservationHandler,
  CreateInventoryReservationHandler,
  ListInventoryAllocationCandidatesHandler,
  ReleaseInventoryReservationHandler
} from "../src/handlers/inventory/reservationHandlers.js";

test("TASK-023 Reservation create exposes a strict idempotent operation contract", () => {
  const api = CreateInventoryReservationHandler.api;
  assert.equal(api.path, "/api/v1/inventory/reservations/create");
  assert.deepEqual(api.authorizationPolicies[0].options.permissions, ["inventory.view", "inventory.operation"]);
  assert.deepEqual(api.idempotency, { enabled: true });
  assert.equal(api.requestSchema.body.additionalProperties, false);
  new RequestValidator().compile(api.requestSchema, api.path);
  new ResponseValidator({ environment: "production" }).compile(api.responseSchema, api.path);
});

test("TASK-023 allocation candidates are a read-only, operation-authorized query", async () => {
  const api = ListInventoryAllocationCandidatesHandler.api;
  assert.equal(api.method, "GET");
  assert.equal(api.path, "/api/v1/inventory/reservations/:id/allocation-candidates");
  assert.equal(api.idempotency, undefined);
  assert.deepEqual(api.authorizationPolicies[0].options.permissions, ["inventory.view", "inventory.operation"]);
  new RequestValidator().compile(api.requestSchema, api.path);
  new ResponseValidator({ environment: "production" }).compile(api.responseSchema, api.path);
  const handler = new ListInventoryAllocationCandidatesHandler({ require(name) {
    if (name === "mysqldatabase") return { withTransaction() {} };
    if (name === "logging") return { logger: { error() {} } };
    if (name === "time") return { nowMs: () => 1, fileDate: () => "2026-09-29" };
    throw new Error(name);
  } });
  let received;
  handler.inventory = { async listAllocationCandidates(query) { received = query; return { items: [] }; } };
  await handler.execute({ input: { params: { id: 7 }, query: { requestedQuantity: 3, page: 2 } } });
  assert.deepEqual(received, { reservationId: 7, requestedQuantity: 3, page: 2 });
});

test("TASK-023 Reservation create maps trusted actor, fixed permission, source and payload", async () => {
  const services = { require(name) {
    if (name === "mysqldatabase") return { withTransaction() {} };
    if (name === "logging") return { logger: { error() {} } };
    if (name === "time") return { nowMs: () => 1, fileDate: () => "2026-09-29" };
    throw new Error(name);
  } };
  const handler = new CreateInventoryReservationHandler(services);
  let received;
  handler.inventory = { async create(command) { received = command; return { id: 1 }; } };
  const source = { module: "SALES", documentType: "SALES_ORDER", documentId: "SO-1", lineId: "1", eventId: "reserve-1" };
  const body = { source, skuId: 4, warehouseId: 2, quantity: 7, purpose: "SALE", minimumRemainingDays: 10 };
  const response = await handler.execute({
    auth: { claims: { sub: "9", roles: ["sales"], permissions: ["inventory.operation"] } },
    input: { body }, requestId: "req-1"
  });
  assert.deepEqual(received, {
    actor: { userId: 9, serviceName: "", claimedRoles: ["sales"], claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: "reservation.create", requiredCallerPermission: "inventory.operation" },
    source, correlationId: "req-1",
    payload: { skuId: 4, warehouseId: 2, quantity: 7, purpose: "SALE", minimumRemainingDays: 10 }
  });
  assert.deepEqual(response.data, { id: 1 });
});

test("TASK-023 Reservation release and cancel bind path owner, version and source", async () => {
  const source = { module: "SALES", documentType: "SALES_ORDER", documentId: "SO-1", eventId: "change-1" };
  for (const [Handler, method, body, expectedPayload] of [
    [ReleaseInventoryReservationHandler, "release", { source, version: 2, quantity: 3 },
      { reservationId: 7, expectedVersion: 2, quantity: 3 }],
    [CancelInventoryReservationHandler, "cancel", { source, version: 2 },
      { reservationId: 7, expectedVersion: 2 }]
  ]) {
    const api = Handler.api;
    assert.equal(api.requestSchema.body.additionalProperties, false);
    assert.deepEqual(api.idempotency, { enabled: true });
    new RequestValidator().compile(api.requestSchema, api.path);
    new ResponseValidator({ environment: "production" }).compile(api.responseSchema, api.path);
    const handler = new Handler({ require(name) {
      if (name === "mysqldatabase") return { withTransaction() {} };
      if (name === "logging") return { logger: { error() {} } };
      if (name === "time") return { nowMs: () => 1, fileDate: () => "2026-09-29" };
      throw new Error(name);
    } });
    let received;
    handler.inventory = { async [method](command) { received = command; return { id: 7 }; } };
    await handler.execute({
      auth: { claims: { sub: "9", roles: [], permissions: ["inventory.operation"] } },
      input: { params: { id: 7 }, body }, requestId: "req-2"
    });
    assert.deepEqual(received.authorization, {
      purpose: `reservation.${method}`, requiredCallerPermission: "inventory.operation"
    });
    assert.deepEqual(received.source, source);
    assert.deepEqual(received.payload, expectedPayload);
  }
});
