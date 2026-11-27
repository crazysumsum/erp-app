import assert from "node:assert/strict";
import test from "node:test";

import {
  assertInventoryLotConsistency,
  validateInventoryCommandContext,
  validateInventoryLotInput,
  validateInventoryStockStatus
} from "../src/modules/inventory/inventoryValidation.js";

import { normalizePurchaseReversal } from "../src/modules/inventory/inventoryPurchaseValidation.js";

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

test("Inventory accepts role names up to 190 Unicode code points and 760 UTF-8 bytes", () => {
  const claimedRoles = ["銷售", "a".repeat(190), "倉".repeat(189) + "𠮷", "𠮷".repeat(190)];
  assert.equal(Buffer.byteLength(claimedRoles[3], "utf8"), 760);
  const input = command({ actor: { ...command().actor, claimedRoles } });

  assert.deepEqual(validateInventoryCommandContext(transaction, input, EXPECTED_AUTHORIZATION).actor.claimedRoles,
    claimedRoles);
});

test("Inventory still rejects invalid role names and keeps permission codes ASCII-only", () => {
  const tooManyBytes = "𠮷".repeat(190) + "a";
  assert.equal(Buffer.byteLength(tooManyBytes, "utf8"), 761);
  for (const claimedRoles of [["倉".repeat(191)], [tooManyBytes], ["銷\n售"], ["倉\x7f務"], ["倉務", "倉務"], [""]]) {
    const input = command({ actor: { ...command().actor, claimedRoles } });
    assert.throws(() => validateInventoryCommandContext(transaction, input, EXPECTED_AUTHORIZATION), /claimedRoles/);
  }
  for (const claimedPermissions of [["receiving.operation", "補貨"], ["receiving.operation", "a".repeat(101)]]) {
    const input = command({ actor: { ...command().actor, claimedRoles: ["warehouse-operator"], claimedPermissions } });
    assert.throws(() => validateInventoryCommandContext(transaction, input, EXPECTED_AUTHORIZATION), /claimedPermissions/);
  }
});

test("Purchase reversal accepts the same Unicode role names and retains its rejection field", () => {
  const role = "𠮷".repeat(190);
  const input = {
    actor: { userId: 7, serviceName: "", claimedRoles: [role], claimedPermissions: ["purchasing.view", "inventory.adjust"] },
    correlationId: "",
    source: { documentId: "42", eventId: "00000000-0000-4000-8000-000000000001" },
    goodsReceiptId: "42",
    reasonText: "Correct original receipt",
    lines: [{ sourceLineId: "1", originalSourceLineId: "1", originalMovementId: 12, baseQuantity: 1 }]
  };
  assert.deepEqual(normalizePurchaseReversal(input).actor.claimedRoles, [role]);
  for (const claimedRoles of [[role + "a"], ["倉\n務"], [role, role]]) {
    assert.throws(() => normalizePurchaseReversal({ ...input, actor: { ...input.actor, claimedRoles } }),
      error => error.code === "INVENTORY_INPUT_INVALID" && error.details.field === "claimedRoles");
  }
});

test("Inventory Lot input follows the current SKU tracking policy", () => {
  assert.deepEqual(validateInventoryLotInput({ trackingPolicy: "none" }), {
    trackingPolicy: "none",
    lotNumber: null,
    normalizedLotNumber: null,
    expiryDate: null,
    manufactureDate: null
  });
  assert.deepEqual(validateInventoryLotInput({
    trackingPolicy: "batch",
    lotNumber: "  Lot-A  ",
    expiryDate: "2027-09-01",
    manufactureDate: "2026-09-01"
  }), {
    trackingPolicy: "batch",
    lotNumber: "Lot-A",
    normalizedLotNumber: "Lot-A",
    expiryDate: "2027-09-01",
    manufactureDate: "2026-09-01"
  });
  assert.equal(validateInventoryLotInput({
    trackingPolicy: "batch_expiry",
    lotNumber: "LOT-2",
    expiryDate: "2027-09-01"
  }).normalizedLotNumber, "LOT-2");
});

test("Inventory Lot input rejects missing, forbidden, serial and inconsistent data", () => {
  assert.throws(
    () => validateInventoryLotInput({ trackingPolicy: "none", lotNumber: "LOT-1" }),
    (error) => error.code === "INVENTORY_INPUT_INVALID"
  );
  assert.throws(
    () => validateInventoryLotInput({ trackingPolicy: "batch" }),
    (error) => error.code === "LOT_REQUIRED"
  );
  assert.throws(
    () => validateInventoryLotInput({ trackingPolicy: "batch_expiry", lotNumber: "LOT-1" }),
    (error) => error.code === "EXPIRY_REQUIRED"
  );
  assert.throws(
    () => validateInventoryLotInput({ trackingPolicy: "serial" }),
    (error) => error.code === "SERIAL_TRACKING_UNSUPPORTED"
  );
  assert.throws(
    () => validateInventoryLotInput({
      trackingPolicy: "batch",
      lotNumber: "LOT-1",
      expiryDate: "2026-09-01",
      manufactureDate: "2026-09-02"
    }),
    (error) => error.code === "INVENTORY_INPUT_INVALID"
  );
});

test("An existing SKU Lot identity rejects date changes or backfill", () => {
  const lot = { expiryDate: "2027-09-01", manufactureDate: null };
  assert.deepEqual(assertInventoryLotConsistency(lot, { ...lot }), lot);
  assert.throws(
    () => assertInventoryLotConsistency(lot, { expiryDate: "2027-09-02", manufactureDate: null }),
    (error) => error.code === "LOT_DATA_CONFLICT" && error.details.field === "expiryDate"
  );
  assert.throws(
    () => assertInventoryLotConsistency(lot, { ...lot, manufactureDate: "2026-09-01" }),
    (error) => error.code === "LOT_DATA_CONFLICT" && error.details.field === "manufactureDate"
  );
});

test("Inventory Stock Status accepts only the fixed business allowlist", () => {
  for (const status of ["AVAILABLE", "QUARANTINED", "DAMAGED"]) {
    assert.equal(validateInventoryStockStatus(status), status);
  }
  assert.throws(
    () => validateInventoryStockStatus("EXPIRED"),
    (error) => error.code === "INVENTORY_INPUT_INVALID"
  );
});
