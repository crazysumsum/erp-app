import assert from "node:assert/strict";
import test from "node:test";

import { InventoryPostingService } from "../src/modules/inventory/InventoryPostingService.js";
import { InventoryReservationService } from "../src/modules/inventory/InventoryReservationService.js";

const STOP = new Error("claim reached");
const transaction = { async query() { throw STOP; }, async execute() { throw STOP; } };
const database = { withTransaction() { throw new Error("provider must use caller transaction"); } };

function input(permission, payload) {
  return {
    actor: { userId: 7, serviceName: "", claimedRoles: [], claimedPermissions: [permission] },
    source: { documentId: "42", lineId: "1", eventId: "posted-1" },
    correlationId: "request-1",
    payload
  };
}

function reservationService(currentPermissions, captured) {
  return new InventoryReservationService({
    database, time: { nowMs: () => 1, fileDate: () => "2026-09-29" },
    authorize: async (_transaction, request) => {
      captured.authorization = request;
      return { username: "sam", permissions: currentPermissions };
    },
    itemLookup: { async getInventoryProfileInTransaction() {
      return { usable: true, inventoryTracked: true, trackingPolicy: "none", minimumSaleLifeDays: 0 };
    } },
    operations: { async claim(_transaction, request) { captured.claim = request; throw STOP; } },
    locks: {}, audit: {}
  });
}

function postingService(currentPermissions, captured) {
  return new InventoryPostingService({
    database, time: { nowMs: () => 1, fileDate: () => "2026-09-29" },
    authorize: async (_transaction, request) => {
      captured.authorization = request;
      return { username: "sam", permissions: currentPermissions };
    },
    itemLookup: {}, operations: { async claim(_transaction, request) {
      captured.claim = request;
      throw STOP;
    } }, locks: {}, audit: {}, createMovementGroupId: () => "11111111-1111-4111-8111-111111111111"
  });
}

const reservationCases = [
  ["createSalesReservationInTransaction", "sales.operation", "SALES", "SALES_ORDER",
    { skuId: 12, warehouseId: 2, quantity: 1, purpose: "SALE", minimumRemainingDays: 0 }],
  ["releaseSalesReservationInTransaction", "sales.operation", "SALES", "SALES_ORDER",
    { reservationId: 17, expectedVersion: 1, quantity: 1 }],
  ["cancelSalesReservationInTransaction", "sales.operation", "SALES", "SALES_ORDER",
    { reservationId: 17, expectedVersion: 1 }],
  ["allocateForFulfillmentInTransaction", "fulfillment.operation", "FULFILLMENT", "PICK",
    { reservationId: 17, expectedVersion: 1, allocations: [{ balanceId: 41, expectedVersion: 1, quantity: 1 }] }],
  ["releaseFulfillmentAllocationInTransaction", "fulfillment.operation", "FULFILLMENT", "PICK",
    { reservationId: 17, expectedVersion: 1, releases: [{ allocationId: 71, expectedVersion: 1, quantity: 1 }] }],
  ["reallocateFulfillmentAllocationInTransaction", "fulfillment.operation", "FULFILLMENT", "PICK",
    { reservationId: 17, expectedVersion: 1,
      releases: [{ allocationId: 71, expectedVersion: 1, quantity: 1 }],
      allocations: [{ balanceId: 41, expectedVersion: 1, quantity: 1 }] }]
];

test("TASK-023 Sales/Fulfillment providers fix permission and source without inventory.operation", async () => {
  for (const [method, permission, module, documentType, payload] of reservationCases) {
    const captured = {};
    const service = reservationService([permission], captured);
    await assert.rejects(() => service[method](transaction, input(permission, payload)), STOP);
    assert.equal(captured.authorization.actorId, 7, method);
    assert.equal(captured.claim.source.module, module, method);
    assert.equal(captured.claim.source.documentType, documentType, method);
  }

  const captured = {};
  const service = postingService(["fulfillment.operation"], captured);
  await assert.rejects(() => service.postFulfillmentIssueInTransaction(transaction,
    input("fulfillment.operation", { reservationId: 17, expectedVersion: 1,
      lines: [{ allocationId: 71, expectedVersion: 1, balanceId: 41,
        expectedBalanceVersion: 1, quantity: 1 }] })), STOP);
  assert.equal(captured.claim.source.module, "FULFILLMENT");
  assert.equal(captured.claim.source.documentType, "SHIPMENT");
});

test("TASK-023 provider rejects caller authorization and revoked permission", async () => {
  const payload = reservationCases[0][4];
  const command = input("sales.operation", payload);
  const service = reservationService(["sales.operation"], {});
  assert.throws(() => service.createSalesReservationInTransaction(transaction, {
    ...command, authorization: { purpose: "reservation.create", requiredCallerPermission: "inventory.operation" }
  }), (error) => error.code === "INVENTORY_INPUT_INVALID" && error.details.field === "authorization");
  assert.throws(() => service.createSalesReservationInTransaction(transaction, {
    ...command, source: { ...command.source, module: "FULFILLMENT" }
  }), (error) => error.code === "INVENTORY_INPUT_INVALID" && error.details.field === "module");
  await assert.rejects(() => service.createSalesReservationInTransaction(transaction,
    input("inventory.operation", payload)), /required caller permission/);
  await assert.rejects(() => reservationService([], {}).createSalesReservationInTransaction(transaction, command),
    (error) => error.code === "PERMISSION_STALE");
  assert.throws(() => service.createSalesReservationInTransaction(null, command),
    /caller-owned transaction executor/);
});

test("TASK-023 Fulfillment candidates require fresh downstream permission and do not write", async () => {
  const request = {
    actor: input("fulfillment.operation", {}).actor,
    query: { reservationId: 17, requestedQuantity: 1, page: 1 }
  };
  const service = reservationService(["fulfillment.operation"], {});
  await assert.rejects(() => service.listFulfillmentAllocationCandidatesInTransaction(transaction, request), STOP);
  await assert.rejects(() => reservationService([], {}).listFulfillmentAllocationCandidatesInTransaction(
    transaction, request
  ), (error) => error.code === "PERMISSION_STALE");
  await assert.rejects(() => service.listFulfillmentAllocationCandidatesInTransaction(transaction, {
    ...request, authorization: { purpose: "allocation.candidates", requiredCallerPermission: "inventory.operation" }
  }), (error) => error.code === "INVENTORY_INPUT_INVALID" && error.details.field === "authorization");
});
