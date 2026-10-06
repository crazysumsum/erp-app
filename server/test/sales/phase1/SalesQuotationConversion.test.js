import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { quotationDifferences, validateQuotationLifecycle } from "../../../src/modules/sales/SalesQuotationService.js";
import { quotationLifecycleRequest } from "../../../src/handlers/sales-quotations/salesQuotationSchemas.js";
const line = (skuId, skuUomId = skuId) => ({ skuId, skuUomId, lineNo: skuId, quantity: "2.000000", unitSellingPrice: "3.0000", lineNote: "private note" });
test("TC-015 Conversion differences match SKU/UOM and retain only IDs/positions/exact decimal changes", () => {
  const difference = quotationDifferences([line(1), line(2)], [{ ...line(1), quantity: "3.000000", unitSellingPrice: "4.0000" }, line(3)]);
  assert.deepEqual(difference.quantityChanged, [{ skuId: 1, skuUomId: 1, fromLineNo: 1, toLineNo: 1, beforeQuantity: "2.000000", afterQuantity: "3.000000" }]);
  assert.equal(difference.added[0].skuId, 3);assert.equal(difference.removed[0].skuId, 2);
  assert.equal(difference.priceChanged[0].afterPrice, "4.0000");assert.equal(JSON.stringify(difference).includes("private note"), false);
});
test("TC-015 Reordering or note-only edits do not change quoted quantities/prices; UOM changes are remove/add", () => {
  assert.deepEqual(quotationDifferences([line(1), line(2)], [{ ...line(2), lineNote: "other" }, line(1)]), { added: [], removed: [], quantityChanged: [], priceChanged: [] });
  const difference = quotationDifferences([line(1)], [line(1, 99)]);
  assert.equal(difference.added.length, 1); assert.equal(difference.removed.length, 1);assert.equal(difference.quantityChanged.length, 0);
});
test("TC-014 Lifecycle contracts reject hidden fields, missing versions and short/blank cancellation reasons", () => {
  const input = { eventId: randomUUID(), version: 1 };
  assert.deepEqual(validateQuotationLifecycle(input, "ISSUE"), input);
  for (const value of [{ ...input, status: "CONVERTED" }, { ...input, version: "1" }, { ...input, eventId: "invalid" }])
    assert.throws(() => validateQuotationLifecycle(value, "ISSUE"), { code: "SALES_INPUT_INVALID" });
  for (const reason of ["abc", "     "]) assert.throws(() => validateQuotationLifecycle({ ...input, reason }, "CANCEL"), { code: "SALES_INPUT_INVALID" });
  assert.equal(validateQuotationLifecycle({ ...input, reason: "  Customer withdrew  " }, "CANCEL").reason, "Customer withdrew");
});
test("TC-012/015 Conversion HTTP input preserves financial types and prevents nested event/snapshot injection", () => {
  const body = { eventId: randomUUID(), version: 2, order: { customerId: 1, currencyCode: "HKD", fulfillmentWarehouseId: 1,
    orderDate: "2026-10-01", lines: [{ skuId: 1, skuUomId: 1, quantity: "2.000000", unitSellingPrice: "3.0000" }] } };
  const req = input => ({ input: { body: input, params: { id: 7 } }, auth: { claims: { sub: "1", roles: [], permissions: [] } } });
  assert.equal(quotationLifecycleRequest(req(body), "CONVERT").input.order.lines[0].unitSellingPrice, "3.0000");
  for (const order of [{ ...body.order, eventId: randomUUID() }, { ...body.order, sourceType: "MANUAL" },
    { ...body.order, lines: [{ ...body.order.lines[0], unitSellingPrice: 3 }] }])
    assert.throws(() => quotationLifecycleRequest(req({ ...body, order }), "CONVERT"), { code: "SALES_INPUT_INVALID" });
});
