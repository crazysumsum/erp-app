import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQuantity, orderedBaseQuantity, assertQuantityConservation } from "../../src/modules/sales/salesQuantityMath.js";
import { mergeSalesLines, validateSalesDocument } from "../../src/modules/sales/salesValidation.js";

const line = { skuId: 1, skuUomId: 2, quantity: "0.1", unitSellingPrice: "2", lineNote: "" };
const input = { eventId: "542c7fc7-1525-44e8-8f85-115adf37c1d2", customerId: 1, currencyCode: "HKD",
  fulfillmentWarehouseId: 1, orderDate: "2026-09-30", lines: [line] };

test("TC-007 quantity conversion is exact, positive and safe; projections conserve demand", () => {
  assert.equal(normalizeQuantity("0.1"), "0.100000");
  assert.equal(orderedBaseQuantity("0.1", 10), 1);
  for (const [quantity, factor] of [["0", 1], ["-1", 1], ["1.0000001", 1], ["0.1", 1], ["1", 0], ["1", 1000001], ["99999999999999", 1000000]]) {
    assert.throws(() => orderedBaseQuantity(quantity, factor));
  }
  for (let fulfilled = 0; fulfilled <= 4; fulfilled++) for (let reserved = 0; reserved <= 4 - fulfilled; reserved++) {
    const projection = { orderedBaseQuantity: 4, fulfilledBaseQuantity: fulfilled, reservedOutstandingBaseQuantity: reserved,
      backorderedBaseQuantity: 4 - fulfilled - reserved, cancelledBaseQuantity: 0, releasedBaseQuantity: 99 };
    assert.equal(assertQuantityConservation(projection), true);
    assert.throws(() => assertQuantityConservation({ ...projection, cancelledBaseQuantity: 1 }));
  }
  assert.throws(() => assertQuantityConservation({ orderedBaseQuantity: 1, fulfilledBaseQuantity: -1,
    reservedOutstandingBaseQuantity: 2, backorderedBaseQuantity: 0, cancelledBaseQuantity: 0 }));
});

test("TC-007 duplicate lines merge exactly and reject commercial conflicts", () => {
  const merged = mergeSalesLines([line, { ...line, quantity: "0.2", unitSellingPrice: "2.0000" }]);
  assert.equal(merged.length, 1); assert.equal(merged[0].quantity, "0.300000");
  assert.equal(line.quantity, "0.1");
  assert.equal(mergeSalesLines([line, { ...line, skuUomId: 3 }]).length, 2);
  for (const changes of [{ unitSellingPrice: "3" }, { lineNote: "different" }]) assert.throws(() => mergeSalesLines([line, { ...line, ...changes }]), { code: "SALES_LINE_MERGE_CONFLICT" });
  assert.equal(mergeSalesLines(Array.from({ length: 101 }, () => line)).length, 1);
  assert.throws(() => mergeSalesLines(Array.from({ length: 101 }, (_, index) => ({ ...line, skuId: index + 1 }))));
});

test("TC-007 strict document fields, Unicode lengths, dates and zero-price warnings", () => {
  assert.equal(validateSalesDocument(input).warnings.length, 0);
  assert.equal(validateSalesDocument({ ...input, lines: [{ ...line, unitSellingPrice: "0" }] }).warnings.length, 1);
  assert.equal(validateSalesDocument({ ...input, customerPoReference: "漢".repeat(190) }).document.customerPoReference.length, 190);
  for (const changes of [{ status: "CONFIRMED" }, { total: "1" }, { shippingAddressId: 1 }, { version: 1 }, { eventId: "invalid" },
    { orderDate: "2026-02-30" }, { requestedDeliveryDate: "2026-09-29" }, { notes: "a".repeat(2001) }, { lines: [] },
    { lines: [{ ...line, toBaseFactor: 1 }] }]) assert.throws(() => validateSalesDocument({ ...input, ...changes }));
  assert.throws(() => validateSalesDocument(input, { update: true }));
  assert.throws(() => validateSalesDocument({ ...input, eventId: input.eventId + "\n" }));
  assert.throws(() => validateSalesDocument({ ...input, currencyCode: "HKD\n" }));
  assert.throws(() => mergeSalesLines([{ ...line, id: 1 }, { ...line, id: 1 }], { update: true }));
  const quote = { eventId: input.eventId, customerId: 1, currencyCode: "HKD", quotationDate: "2026-09-30", validUntil: "2026-09-30", lines: [line] };
  assert.equal(validateSalesDocument(quote, { kind: "quotation" }).warnings.length, 0);
  assert.throws(() => validateSalesDocument({ ...quote, validUntil: "2026-09-29" }, { kind: "quotation" }));
});
