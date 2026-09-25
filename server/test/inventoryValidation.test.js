import assert from "node:assert/strict";
import test from "node:test";

import { validateInventoryCommandContext } from "../src/modules/inventory/inventoryValidation.js";

const EXPECTED_AUTHORIZATION = Object.freeze({
  purpose: "receipt.post",
  requiredCallerPermission: "receiving.operation"
});

function command(overrides = {}) {
  return {
    actor: {
      userId: 7,
      serviceName: "",
      claimedRoles: ["warehouse-operator"],
      claimedPermissions: ["purchasing.view", "receiving.operation"]
    },
    authorization: { ...EXPECTED_AUTHORIZATION },
    source: {
      module: "RECEIVING",
      documentType: "PURCHASE_RECEIPT",
      documentId: "receipt-42",
      eventId: "posted-1"
    },
    correlationId: "correlation-1",
    payload: { skuId: 12, quantity: 3 },
    ...overrides
  };
}

const transaction = Object.freeze({ async query() {}, async execute() {} });

test("Inventory internal command context requires and returns the caller-owned transaction contract", () => {
  const input = command();
  const validated = validateInventoryCommandContext(transaction, input, EXPECTED_AUTHORIZATION);

  assert.deepEqual(validated.source, {
    module: "RECEIVING",
    documentType: "PURCHASE_RECEIPT",
    documentId: "receipt-42",
    lineId: "",
    eventId: "posted-1"
  });
  assert.deepEqual(validated.payload, { skuId: 12, quantity: 3 });
  assert.notEqual(validated, input);
  assert.throws(
    () => validateInventoryCommandContext(null, command(), EXPECTED_AUTHORIZATION),
    /caller-owned transaction executor/
  );
  assert.throws(
    () => validateInventoryCommandContext({ query() {} }, command(), EXPECTED_AUTHORIZATION),
    /caller-owned transaction executor/
  );
});

test("Inventory internal command authorization must match the service-owned contract", () => {
  assert.throws(
    () => validateInventoryCommandContext(transaction, command({
      authorization: { purpose: "receipt.post", requiredCallerPermission: "inventory.adjust" }
    }), EXPECTED_AUTHORIZATION),
    /authorization contract mismatch/
  );
  assert.throws(
    () => validateInventoryCommandContext(transaction, command({
      authorization: { purpose: "adjustment.post", requiredCallerPermission: "receiving.operation" }
    }), EXPECTED_AUTHORIZATION),
    /authorization contract mismatch/
  );
  assert.throws(
    () => validateInventoryCommandContext(transaction, command({
      actor: { ...command().actor, claimedPermissions: ["purchasing.view"] }
    }), EXPECTED_AUTHORIZATION),
    /required caller permission/
  );
});

test("Inventory internal command context rejects unknown fields and authentication secrets", () => {
  assert.throws(
    () => validateInventoryCommandContext(transaction, command({ extra: true }), EXPECTED_AUTHORIZATION),
    /unknown field extra/
  );
  assert.throws(
    () => validateInventoryCommandContext(transaction, command({
      payload: { skuId: 12, authentication: { devicePassword: "secret" } }
    }), EXPECTED_AUTHORIZATION),
    /sensitive field devicePassword/
  );
  assert.throws(
    () => validateInventoryCommandContext(transaction, command({
      source: { ...command().source, lineId: null }
    }), EXPECTED_AUTHORIZATION),
    /source lineId/
  );
});

test("Inventory internal command context accepts an identified service actor", () => {
  const validated = validateInventoryCommandContext(transaction, command({
    actor: {
      userId: null,
      serviceName: "receiving-worker",
      claimedRoles: [],
      claimedPermissions: ["receiving.operation"]
    }
  }), EXPECTED_AUTHORIZATION);

  assert.equal(validated.actor.userId, null);
  assert.equal(validated.actor.serviceName, "receiving-worker");
});
