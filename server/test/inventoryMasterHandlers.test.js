import assert from "node:assert/strict";
import test from "node:test";

import { RequestValidator } from "../src/framework/validation/requestValidator.js";
import { ResponseValidator } from "../src/framework/validation/responseValidator.js";
import * as binHandlers from "../src/handlers/inventory/binHandlers.js";
import * as warehouseHandlers from "../src/handlers/inventory/warehouseHandlers.js";

const handlers = [...Object.values(warehouseHandlers), ...Object.values(binHandlers)]
  .filter((value) => typeof value === "function" && value.api);

test("TASK-010 Warehouse and Bin routes expose the designed strict contract", () => {
  assert.equal(handlers.length, 14);
  for (const Handler of handlers) {
    for (const schema of Object.values(Handler.api.requestSchema)) {
      assert.equal(schema.additionalProperties, false, Handler.handlerName);
    }
  }

  const reads = handlers.filter((Handler) => Handler.api.method === "GET");
  const writes = handlers.filter((Handler) => Handler.api.method === "POST");
  for (const Handler of reads) {
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["inventory.view"]);
  }
  for (const Handler of writes) {
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["inventory.view", "inventory.mgmt"]);
    assert.deepEqual(Handler.api.idempotency, { enabled: true });
  }
});

test("TASK-010 route paths, auth strength and mutable command inputs are fixed", () => {
  assert.deepEqual(handlers.map((Handler) => Handler.api.path).sort(), [
    "/api/v1/inventory/warehouses",
    "/api/v1/inventory/warehouses/:id",
    "/api/v1/inventory/warehouses/:id/deactivate",
    "/api/v1/inventory/warehouses/:id/delete",
    "/api/v1/inventory/warehouses/:id/reactivate",
    "/api/v1/inventory/warehouses/:id/update",
    "/api/v1/inventory/warehouses/:warehouseId/bins",
    "/api/v1/inventory/warehouses/:warehouseId/bins/:binId",
    "/api/v1/inventory/warehouses/:warehouseId/bins/:binId/deactivate",
    "/api/v1/inventory/warehouses/:warehouseId/bins/:binId/delete",
    "/api/v1/inventory/warehouses/:warehouseId/bins/:binId/reactivate",
    "/api/v1/inventory/warehouses/:warehouseId/bins/:binId/update",
    "/api/v1/inventory/warehouses/:warehouseId/bins/create",
    "/api/v1/inventory/warehouses/create"
  ]);

  for (const Handler of [
    warehouseHandlers.DeactivateWarehouseHandler,
    warehouseHandlers.ReactivateWarehouseHandler,
    binHandlers.DeactivateBinHandler,
    binHandlers.ReactivateBinHandler
  ]) {
    assert.equal(Handler.api.authType, "jwt-password", Handler.handlerName);
    assert.deepEqual(Handler.api.requestSchema.body.required.sort(), ["password", "reason", "version"]);
  }
  for (const Handler of [warehouseHandlers.DeleteWarehouseHandler, binHandlers.DeleteBinHandler]) {
    assert.equal(Handler.api.authType, "jwt-device-password", Handler.handlerName);
    assert.deepEqual(Handler.api.requestSchema.body.required.sort(), ["password", "reason", "version"]);
  }
  for (const Handler of [warehouseHandlers.UpdateWarehouseHandler, binHandlers.UpdateBinHandler]) {
    assert.ok(Handler.api.requestSchema.body.required.includes("version"), Handler.handlerName);
  }
});

test("TASK-010 list schemas expose bounded pagination, allowlisted sorting and Bin lock status", () => {
  const warehouses = warehouseHandlers.ListWarehousesHandler.api.requestSchema.query.properties;
  assert.equal(warehouses.pageSize.default, 20);
  assert.equal(warehouses.pageSize.maximum, 100);
  assert.deepEqual(warehouses.sortBy.enum, ["code", "name", "status", "updatedAt"]);
  assert.equal(warehouses.status.default, "ACTIVE");

  const bins = binHandlers.ListBinsHandler.api.requestSchema.query.properties;
  assert.equal(bins.pageSize.default, 20);
  assert.deepEqual(bins.sortBy.enum, ["code", "name", "status", "updatedAt"]);
  assert.deepEqual(bins.lockStatus.enum, ["ALL", "LOCKED", "UNLOCKED"]);
  assert.equal(bins.lockStatus.default, "ALL");
});

test("TASK-010 request and response schemas compile under the production validators", () => {
  const request = new RequestValidator();
  const response = new ResponseValidator({ environment: "production" });
  for (const Handler of handlers) {
    request.compile(Handler.api.requestSchema, Handler.api.path);
    response.compile(Handler.api.responseSchema, Handler.api.path);
  }
});

test("TASK-010 handlers map validated owner IDs and request metadata to the domain service", async () => {
  const services = {
    require(name) {
      if (name === "mysqldatabase") return { query() {}, withTransaction() {} };
      if (name === "logging") return { logger: { error() {} } };
      if (name === "time") return { nowMs: () => 1 };
      throw new Error(name);
    }
  };
  const handler = new binHandlers.UpdateBinHandler(services);
  let received;
  handler.inventory = { async updateBin(input) { received = input; return { id: 9 }; } };

  const result = await handler.execute({
    auth: { claims: { sub: "7", roles: ["warehouse-manager"], permissions: ["inventory.view", "inventory.mgmt"] } },
    input: {
      params: { warehouseId: 4, binId: 9 },
      body: { binCode: "A-01", binName: "A", description: "Primary", version: 3 }
    },
    requestId: "request-1",
    ip: "127.0.0.1"
  });

  assert.deepEqual(received, {
    actorId: 7,
    claimedRoles: ["warehouse-manager"],
    claimedPermissions: ["inventory.view", "inventory.mgmt"],
    requestId: "request-1",
    ip: "127.0.0.1",
    warehouseId: 4,
    binId: 9,
    binCode: "A-01",
    binName: "A",
    description: "Primary",
    version: 3
  });
  assert.deepEqual(result.data, { id: 9 });
});
