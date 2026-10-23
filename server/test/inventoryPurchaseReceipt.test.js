import assert from "node:assert/strict";
import test from "node:test";
import { purchaseReceiptCommand } from "../test-support/inventoryPurchaseFixtures.js";
import { normalizePurchaseReceipt, purchaseReceiptBusinessHash } from "../src/modules/inventory/inventoryPurchaseValidation.js";

const invalid = (command) => assert.throws(() => normalizePurchaseReceipt(command));

test("Purchase receipt normalization copies input and keeps explicit null dimensions", () => {
  const command = purchaseReceiptCommand();
  const result = normalizePurchaseReceipt(command);
  assert.deepEqual(result, command);
  result.lines[0].commitment.baseUomCodeSnapshot = "OTHER";
  assert.equal(command.lines[0].commitment.baseUomCodeSnapshot, "EA");
});

test("Purchase receipt accepts 200 details, rejects zero and 201", () => {
  const command = purchaseReceiptCommand();
  const line = command.lines[0];
  command.lines = Array.from({ length: 200 }, (_, i) => ({ ...line, sourceLineId: String(i + 1),
    commitment: { ...line.commitment, purchaseOrderLineId: i + 1 } }));
  assert.equal(normalizePurchaseReceipt(command).lines.length, 200);
  invalid({ ...command, lines: [...command.lines, { ...line, sourceLineId: "201" }] });
  invalid({ ...command, lines: [] });
});

test("Purchase receipt rejects unknown fields at every command boundary", () => {
  for (const location of [c => c, c => c.actor, c => c.source, c => c.lines[0], c => c.lines[0].commitment]) {
    const command = purchaseReceiptCommand();
    location(command).permission = "inventory.adjust";
    invalid(command);
  }
});

test("Purchase receipt requires canonical, safe source identifiers", () => {
  for (const value of [1, "0", "01", "-1", "1e2", "9007199254740992", " 1"] ) {
    for (const field of ["documentId", "sourceLineId"]) {
      const command = purchaseReceiptCommand();
      (field === "documentId" ? command.source : command.lines[0])[field] = value;
      invalid(command);
    }
  }
});

test("Purchase receipt rejects noncanonical event UUIDs", () => {
  for (const value of ["event-1", "AAAAAAAA-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111111111 "]) {
    const command = purchaseReceiptCommand(); command.source.eventId = value; invalid(command);
  }
});

test("Purchase receipt rejects duplicate detail identity", () => {
  const command = purchaseReceiptCommand();
  command.lines.push({ ...command.lines[0], binId: 3 }); invalid(command);
});

test("Purchase receipt permits shared bucket for different PO lines, not a repeated PO dimension", () => {
  const command = purchaseReceiptCommand(), line = command.lines[0];
  command.lines.push({ ...line, sourceLineId: "82", commitment: { ...line.commitment, purchaseOrderLineId: 7 } });
  assert.equal(normalizePurchaseReceipt(command).lines.length, 2);
  command.lines[1].commitment.purchaseOrderLineId = 6; invalid(command);
});

test("Purchase receipt numeric IDs and quantities reject coercion, zero, fraction and overflow", () => {
  for (const field of ["skuId", "warehouseId", "binId", "baseQuantity"]) {
    for (const value of ["1", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const command = purchaseReceiptCommand(); command.lines[0][field] = value; invalid(command);
    }
  }
});

test("Purchase receipt requires positive snapshot IDs/version and exact SKU match", () => {
  for (const field of ["purchaseOrderId", "purchaseOrderLineId", "confirmedVersion", "baseUomIdSnapshot"]) {
    const command = purchaseReceiptCommand(); command.lines[0].commitment[field] = 0; invalid(command);
  }
  const command = purchaseReceiptCommand(); command.lines[0].commitment.skuId = 13; invalid(command);
  command.lines[0].commitment.skuId = 12; command.lines[0].commitment.inventoryTrackedSnapshot = false; invalid(command);
});

test("Purchase receipt has a human actor with exact required claim names, no service actor", () => {
  for (const patch of [{ userId: null }, { serviceName: "worker" }, { claimedPermissions: ["receiving.operation"] },
    { claimedRoles: ["receiver", "receiver"] }]) {
    const command = purchaseReceiptCommand(); Object.assign(command.actor, patch); invalid(command);
  }
});

test("Purchase receipt none tracking forbids lot data and serial is unsupported", () => {
  const command = purchaseReceiptCommand(); command.lines[0].lotNumber = "L1"; invalid(command);
  command.lines[0].commitment.trackingPolicySnapshot = "serial"; invalid(command);
});

test("Purchase receipt batch preserves case, trims lot, and expiry tracking requires a date", () => {
  const command = purchaseReceiptCommand(), line = command.lines[0];
  line.commitment.trackingPolicySnapshot = "batch"; line.lotNumber = " Lot-A ";
  assert.equal(normalizePurchaseReceipt(command).lines[0].lotNumber, "Lot-A");
  line.commitment.trackingPolicySnapshot = "batch_expiry"; invalid(command);
  line.expiryDate = "2027-01-01";
  assert.equal(normalizePurchaseReceipt(command).lines[0].expiryDate, "2027-01-01");
});

test("Purchase receipt rejects invalid dates and same exact lot with inconsistent dates", () => {
  const command = purchaseReceiptCommand(), line = command.lines[0];
  line.commitment.trackingPolicySnapshot = "batch_expiry"; line.lotNumber = "L1"; line.expiryDate = "2027-02-29";
  invalid(command); line.expiryDate = "2027-03-01"; line.manufactureDate = "2027-03-02"; invalid(command);
  line.manufactureDate = null;
  command.lines.push({ ...line, sourceLineId: "82", binId: 3, expiryDate: "2027-04-01" }); invalid(command);
});

test("Purchase receipt reason bounds are UTF-8 bytes, not UTF-16 length", () => {
  for (const reason of ["abcd", "x".repeat(501), "界".repeat(167), "valid\nreason"]) {
    const command = purchaseReceiptCommand(); command.lines[0].commitment.skuExceptionReason = reason; invalid(command);
  }
  const command = purchaseReceiptCommand(); command.lines[0].commitment.skuExceptionReason = "界界";
  assert.equal(normalizePurchaseReceipt(command).lines[0].commitment.skuExceptionReason, "界界");
});

test("Purchase receipt validates evidence shape without trusting caller day counts", () => {
  const command = purchaseReceiptCommand(), line = command.lines[0];
  line.minimumLifeEvidence = { reason: "allowed low life", minimumLifeDaysApplied: 10, actualRemainingLifeDays: 2 };
  assert.deepEqual(normalizePurchaseReceipt(command).lines[0].minimumLifeEvidence, line.minimumLifeEvidence);
  line.minimumLifeEvidence.minimumLifeDaysApplied = -1; invalid(command);
  line.minimumLifeEvidence.minimumLifeDaysApplied = 10; line.minimumLifeEvidence.override = true; invalid(command);
});

test("Purchase receipt validates stock status, snapshot UOM and minimum life", () => {
  const command = purchaseReceiptCommand(), line = command.lines[0];
  line.stockStatus = "EXPIRED"; invalid(command); line.stockStatus = "AVAILABLE";
  line.commitment.baseUomCodeSnapshot = ""; invalid(command); line.commitment.baseUomCodeSnapshot = "EA";
  line.commitment.minimumReceiptLifeDaysSnapshot = 1.5; invalid(command);
});

test("Purchase receipt hash ignores input order, fresh actor and correlation but not business intent", () => {
  const command = purchaseReceiptCommand(), line = command.lines[0];
  command.lines.push({ ...line, sourceLineId: "9", binId: 3 });
  const hash = purchaseReceiptBusinessHash(normalizePurchaseReceipt(command));
  command.lines.reverse(); command.actor.userId = 8; command.correlationId = "new-request";
  assert.equal(purchaseReceiptBusinessHash(normalizePurchaseReceipt(command)), hash);
  command.lines[0].baseQuantity += 1;
  assert.notEqual(purchaseReceiptBusinessHash(normalizePurchaseReceipt(command)), hash);
});

test("Purchase receipt canonicalizes omitted nullable fields without dropping commitment intent", () => {
  const command = purchaseReceiptCommand(), hash = purchaseReceiptBusinessHash(normalizePurchaseReceipt(command));
  delete command.lines[0].lotNumber; delete command.lines[0].expiryDate; delete command.lines[0].manufactureDate;
  delete command.lines[0].minimumLifeEvidence; delete command.lines[0].commitment.skuExceptionReason;
  delete command.lines[0].commitment.minimumReceiptLifeDaysSnapshot;
  assert.equal(purchaseReceiptBusinessHash(normalizePurchaseReceipt(command)), hash);
  command.lines[0].commitment.confirmedVersion += 1;
  assert.notEqual(purchaseReceiptBusinessHash(normalizePurchaseReceipt(command)), hash);
});
