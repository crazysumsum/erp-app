import assert from "node:assert/strict";
import test from "node:test";
import * as validation from "../src/modules/inventory/inventoryPurchaseValidation.js";

function command() {
  return { actor: { userId: 7, serviceName: "", claimedRoles: ["adjuster"],
    claimedPermissions: ["purchasing.view", "inventory.adjust"] }, correlationId: "reverse-test-1",
  source: { documentId: "51", eventId: "11111111-1111-4111-8111-111111111111" },
  goodsReceiptId: "42", reasonText: "Correct received quantity",
  lines: [{ sourceLineId: "91", originalSourceLineId: "81", originalMovementId: 100, baseQuantity: 2 }] };
}

test("Purchase reversal accepts the exact partial-reversal ABI without mutating its input", () => {
  const input = command(), original = structuredClone(input);
  assert.deepEqual(validation.normalizePurchaseReversal(input), original);
  assert.deepEqual(input, original);
});

for (const [name, change] of [
  ["caller-selected permission", c => { c.permission = "inventory.operation"; }],
  ["caller-selected source module", c => { c.source.module = "RETURNS"; }],
  ["unsafe original movement", c => { c.lines[0].originalMovementId = Number.MAX_SAFE_INTEGER + 1; }],
  ["zero quantity", c => { c.lines[0].baseQuantity = 0; }],
  ["negative quantity", c => { c.lines[0].baseQuantity = -1; }],
  ["fractional quantity", c => { c.lines[0].baseQuantity = 1.5; }],
  ["coerced quantity", c => { c.lines[0].baseQuantity = "2"; }],
  ["noncanonical source ID", c => { c.lines[0].sourceLineId = "091"; }],
  ["numeric original detail ID", c => { c.lines[0].originalSourceLineId = 81; }],
  ["unsafe receipt ID", c => { c.goodsReceiptId = "9007199254740992"; }],
  ["extra physical dimension", c => { c.lines[0].binId = 1; }],
  ["duplicate original movement", c => { c.lines.push({ ...c.lines[0], sourceLineId: "92" }); }],
  ["duplicate reversal detail", c => { c.lines.push({ ...c.lines[0], originalMovementId: 101, originalSourceLineId: "82" }); }],
  ["empty batch", c => { c.lines = []; }],
  ["sparse batch", c => { c.lines = new Array(1); }],
  ["201-line batch", c => { c.lines = Array.from({ length: 201 }, (_, i) => ({ sourceLineId: String(i + 1),
    originalSourceLineId: String(i + 1), originalMovementId: i + 1, baseQuantity: 1 })); }],
  ["uppercase event UUID", c => { c.source.eventId = "AAAAAAAA-1111-4111-8111-111111111111"; }],
  ["missing adjustment permission", c => { c.actor.claimedPermissions = ["purchasing.view", "receiving.operation"]; }],
  ["control character reason", c => { c.reasonText = "Invalid\nreason"; }],
  ["empty reason", c => { c.reasonText = "   "; }],
  ["oversize UTF8 reason", c => { c.reasonText = "界".repeat(167); }]
]) test(`Purchase reversal rejects ${name}`, () => {
  const input = command(); change(input);
  assert.throws(() => validation.normalizePurchaseReversal(input), error =>
    ["INVENTORY_INPUT_INVALID", "INVENTORY_QUANTITY_INVALID", "PERMISSION_STALE"].includes(error.code));
});

test("Purchase reversal accepts all200 unique details and preserves response ordering input", () => {
  const input = command(); input.lines = Array.from({ length: 200 }, (_, i) => ({ sourceLineId: String(200 - i),
    originalSourceLineId: String(i + 1), originalMovementId: i + 1, baseQuantity: 1 }));
  const normalized = validation.normalizePurchaseReversal(input);
  assert.equal(normalized.lines.length, 200); assert.equal(normalized.lines[0].sourceLineId, "200");
});

test("Purchase reversal business hash excludes new actor, correlation, context and input permutation", () => {
  const a = command(); a.lines.push({ sourceLineId: "9", originalSourceLineId: "82", originalMovementId: 101, baseQuantity: 1 });
  const b = structuredClone(a); b.actor.userId = 8; b.correlationId = "different-attempt"; b.context = {}; b.lines.reverse();
  assert.equal(validation.purchaseReversalBusinessHash(validation.normalizePurchaseReversal(a)),
    validation.purchaseReversalBusinessHash(validation.normalizePurchaseReversal(b)));
  assert.deepEqual(validation.purchaseReversalBusinessPayload(validation.normalizePurchaseReversal(b)).lines.map(l => l.sourceLineId), ["9", "91"]);
});

test("Purchase reversal business hash binds receipt, event, membership, original and quantity", () => {
  const original = command(), hash = validation.purchaseReversalBusinessHash(validation.normalizePurchaseReversal(original));
  for (const change of [c => { c.goodsReceiptId = "43"; }, c => { c.reasonText = "Different valid reason"; },
    c => { c.source.documentId = "52"; }, c => { c.lines[0].originalMovementId++; },
    c => { c.lines[0].originalSourceLineId = "82"; }, c => { c.lines[0].baseQuantity++; }]) {
    const input = structuredClone(original); change(input);
    assert.notEqual(validation.purchaseReversalBusinessHash(validation.normalizePurchaseReversal(input)), hash);
  }
});
