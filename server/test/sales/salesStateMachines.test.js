import assert from "node:assert/strict";
import test from "node:test";
import { transitionSalesOrder } from "../../src/modules/sales/salesOrderStateMachine.js";
import { effectiveQuotationStatus, transitionQuotation, assertQuotationEditable } from "../../src/modules/sales/salesQuotationStateMachine.js";
import { transitionImportJob, transitionIntakeOrder } from "../../src/modules/sales/salesIntakeStateMachine.js";

const context = { orderedBaseQuantity: 10, fulfilledBaseQuantity: 0, reason: "synthetic reason" };
test("TC-007 SO legal transitions and fulfilled/finalized restrictions", () => {
  for (const [from, event, to, changes] of [
    ["DRAFT", "CONFIRM_START", "CONFIRMING"], ["DRAFT", "CANCEL", "CANCELLED"],
    ["CONFIRMING", "CONFIRM_SUCCEEDED", "CONFIRMED"], ["CONFIRMING", "CONFIRM_FAILED", "DRAFT"],
    ["CONFIRMED", "WITHDRAW", "DRAFT"], ["CONFIRMED", "CANCEL", "CANCELLED"],
    ["CONFIRMED", "FULFILL", "PARTIALLY_FULFILLED", { fulfilledBaseQuantity: 1 }],
    ["CONFIRMED", "FULFILL", "COMPLETED", { fulfilledBaseQuantity: 10 }],
    ["PARTIALLY_FULFILLED", "FULFILL", "COMPLETED", { fulfilledBaseQuantity: 10 }],
    ["PARTIALLY_FULFILLED", "FULFILL", "PARTIALLY_FULFILLED", { fulfilledBaseQuantity: 5 }],
    ["PARTIALLY_FULFILLED", "CLOSE_REMAINING", "CLOSED", { fulfilledBaseQuantity: 1 }],
    ...["COMPLETED", "PARTIALLY_FULFILLED", "CLOSED"].flatMap((state) => [
      [state, "REVERSE_SHIPMENT", "CONFIRMED"], [state, "REVERSE_SHIPMENT", "PARTIALLY_FULFILLED", { fulfilledBaseQuantity: 2 }]])
  ]) assert.equal(transitionSalesOrder(from, event, { ...context, ...changes }), to);
  for (const [from, event, changes] of [["CONFIRMING", "CANCEL"], ["CONFIRMED", "WITHDRAW", { fulfilledBaseQuantity: 1 }],
    ["CONFIRMED", "CANCEL", { fulfilledBaseQuantity: 1 }], ["COMPLETED", "CANCEL"], ["CANCELLED", "REVERSE_SHIPMENT"],
    ["CLOSED", "REVERSE_SHIPMENT", { archived: true }], ["COMPLETED", "REVERSE_SHIPMENT", { hasIrreversibleDownstream: true }],
    ["COMPLETED", "REVERSE_SHIPMENT", { fulfilledBaseQuantity: 10 }], ["DRAFT", "CANCEL", { reason: "" }]]) {
    assert.throws(() => transitionSalesOrder(from, event, { ...context, ...changes }));
  }
  assert.throws(() => transitionSalesOrder("CONFIRMED", "WITHDRAW"));
  for (const length of [4, 501]) assert.throws(() => transitionSalesOrder("DRAFT", "CANCEL", { ...context, reason: "a".repeat(length) }));
  for (const length of [5, 500]) assert.equal(transitionSalesOrder("DRAFT", "CANCEL", { ...context, reason: " " + "a".repeat(length) + " " }), "CANCELLED");
});

test("TC-007 quotation effective expiry is inclusive and conversion cannot repeat", () => {
  const options = { validUntil: "2026-09-30", currentDate: "2026-09-30", reason: "synthetic reason" };
  assert.equal(effectiveQuotationStatus("ISSUED", options.validUntil, options.currentDate), "ISSUED");
  assert.equal(effectiveQuotationStatus("ISSUED", options.validUntil, "2026-10-01"), "EXPIRED");
  assert.equal(transitionQuotation("DRAFT", "ISSUE", options), "ISSUED");
  assert.equal(transitionQuotation("DRAFT", "CANCEL", options), "CANCELLED");
  assert.equal(transitionQuotation("ISSUED", "CANCEL", options), "CANCELLED");
  assert.equal(transitionQuotation("ISSUED", "CONVERT", options), "CONVERTED");
  assert.equal(transitionQuotation("ISSUED", "EXPIRE", { ...options, currentDate: "2026-10-01" }), "EXPIRED");
  assert.throws(() => transitionQuotation("ISSUED", "EXPIRE", options));
  assert.throws(() => transitionQuotation("ISSUED", "CONVERT", { ...options, currentDate: "2026-10-01" }));
  assert.throws(() => transitionQuotation("CONVERTED", "CONVERT", options), { code: "QUOTATION_ALREADY_CONVERTED" });
  assert.equal(assertQuotationEditable("DRAFT"), true);
  for (const status of ["ISSUED", "CONVERTED", "EXPIRED", "CANCELLED"]) assert.throws(() => assertQuotationEditable(status));
});

test("TC-007 import/intake transitions retain cancel windows and terminal states", () => {
  for (const [from, to] of [["UPLOADED", "VALIDATING"], ["VALIDATING", "READY"], ["VALIDATING", "FAILED"],
    ["READY", "QUEUED"], ["READY", "CANCELLED"], ["QUEUED", "PROCESSING"], ["QUEUED", "CANCELLED"],
    ["PROCESSING", "COMPLETED"], ["PROCESSING", "PARTIAL_SUCCESS"], ["PROCESSING", "FAILED"]]) assert.equal(transitionImportJob(from, to), to);
  for (const [from, to] of [["RECEIVED", "VALIDATING"], ["VALIDATING", "VALID"], ["VALIDATING", "INVALID"],
    ["VALIDATING", "DUPLICATE"], ["VALID", "QUEUED"], ["QUEUED", "PROCESSING"], ["PROCESSING", "SUCCEEDED"], ["PROCESSING", "FAILED"]]) assert.equal(transitionIntakeOrder(from, to), to);
  for (const state of ["VALIDATING", "PROCESSING", "FAILED", "COMPLETED"]) assert.throws(() => transitionImportJob(state, "CANCELLED"));
  for (const state of ["INVALID", "DUPLICATE", "SUCCEEDED", "FAILED"]) assert.throws(() => transitionIntakeOrder(state, "QUEUED"));
});
