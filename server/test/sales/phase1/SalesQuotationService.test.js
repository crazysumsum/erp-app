import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { validateQuotationInput, QUOTATION_CREATE_INPUT, QUOTATION_UPDATE_INPUT } from "../../../src/handlers/sales-quotations/salesQuotationSchemas.js";
import { CreateSalesQuotationHandler } from "../../../src/handlers/sales-quotations/createSalesQuotationHandler.js";
import { UpdateSalesQuotationHandler } from "../../../src/handlers/sales-quotations/updateSalesQuotationHandler.js";
import { validateSalesDocument } from "../../../src/modules/sales/salesValidation.js";

const document = () => ({ eventId: randomUUID(), customerId: 1, currencyCode: "HKD", quotationDate: "2026-10-01", validUntil: "2026-10-31",
  lines: [{ skuId: 1, skuUomId: 1, quantity: "1.5", unitSellingPrice: "0.3333" }] });
test("TC-011 Quotation Draft input normalizes and merges before precise line math", () => {
  const input = document(); input.lines.push({ ...input.lines[0] });
  const validated = validateQuotationInput(input);
  assert.deepEqual(validateSalesDocument(validated, { kind: "quotation" }).document.lines, [
    { skuId: 1, skuUomId: 1, quantity: "3.000000", unitSellingPrice: "0.3333", lineNote: "" }]);
});
test("TC-011 Quotation's 100-line limit applies after merging duplicate business lines", () => {
  const input = document(); input.lines = Array.from({ length: 101 }, () => ({ ...input.lines[0] }));
  assert.equal(validateSalesDocument(validateQuotationInput(input), { kind: "quotation" }).document.lines.length, 1);
});
test("TC-012 Quotation schemas reject hidden state, snapshots and numeric money without coercion", () => {
  for (const patch of [{ status: "ISSUED" }, { totalAmount: "1.0000" }, { customerName: "spoof" },
    { lines: [{ ...document().lines[0], unitSellingPrice: 1 }] }, { lines: [{ ...document().lines[0], quantity: 1 }] },
    { lines: [{ ...document().lines[0], baseQuantity: 5 }] }, { lines: [] }])
    assert.throws(() => validateQuotationInput({ ...document(), ...patch }), { code: "SALES_INPUT_INVALID" });
});
test("TC-012 Quotation schema and domain guards reject invalid dates, negative prices and overflow", () => {
  for (const patch of [{ validUntil: "2026-02-30" }, { validUntil: "2026-09-30" },
    { lines: [{ ...document().lines[0], quantity: "0" }] },
    { lines: [{ ...document().lines[0], unitSellingPrice: "-1" }] },
    { lines: [{ ...document().lines[0], unitSellingPrice: "1000000000000000" }] }])
    assert.throws(() => validateSalesDocument(validateQuotationInput({ ...document(), ...patch }), { kind: "quotation" }));
});
test("TC-017 Quotation update requires version and allows only editable line identifiers", () => {
  assert.throws(() => validateQuotationInput(document(), true), { code: "SALES_INPUT_INVALID" });
  const input = { ...document(), version: 1 }; input.lines[0].id = 3;
  assert.equal(validateQuotationInput(input, true).lines[0].id, 3);
  assert.equal(QUOTATION_CREATE_INPUT.additionalProperties, false);
  assert.equal(QUOTATION_UPDATE_INPUT.additionalProperties, false);
});
test("Quotation handlers retain framework auth/idempotency and strict local command validation", () => {
  for (const Handler of [CreateSalesQuotationHandler, UpdateSalesQuotationHandler]) {
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["sales.view", "sales.mgmt"]);
    assert.equal(Handler.api.idempotency.enabled, true);
  }
});
