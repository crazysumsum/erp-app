/** TASK-014：PO Draft editable projection 嘅純驗證（設計 §3.1、§5.2；FR-PO-008／010／012）。唔使 DB。 */
import assert from "node:assert/strict";
import test from "node:test";

import { draftProjection } from "../../src/modules/purchasing/purchasingProjections.js";

const EVENT = "82ab8414-6879-4d87-9857-7ef3accbcf06";
const input = (overrides = {}) => ({ eventId: EVENT, supplierId: 12, currencyCode: "HKD", orderDate: "2026-09-08", buyerId: 7,
  lines: [{ skuId: 55, purchaseSkuUomId: 88, orderedQuantity: "3", unitPrice: "125.5" }], ...overrides });
const create = (value) => draftProjection(value, { maxLines: 100, update: false });
const update = (value) => draftProjection(value, { maxLines: 100, update: true });
const coded = (code, field) => (error) => {
  assert.equal(error.code, code, `${error.code}: ${error.message}`);
  assert.deepEqual(error.publicDetails, field === undefined ? undefined : { field });
  return true;
};

test("選填欄位省略即係清空；數量同單價正規化成固定 scale", () => {
  assert.deepEqual(create(input()), { eventId: EVENT, supplierId: 12, orderingAddressId: null, currencyCode: "HKD", paymentTermId: null,
    orderDate: "2026-09-08", expectedDeliveryDate: null, defaultReceivingWarehouseId: null, buyerId: 7, supplierReference: "", notes: "",
    lines: [{ id: null, skuId: 55, purchaseSkuUomId: 88, orderedQuantity: "3.000000", unitPrice: "125.5000", zeroPriceReason: "",
      expectedDeliveryDate: null, lineNote: "" }] });
  const full = update(input({ version: 3, orderingAddressId: 33, paymentTermId: 4, expectedDeliveryDate: "2026-09-15",
    defaultReceivingWarehouseId: 2, supplierReference: "QUOTE-892", notes: "多行\n備註",
    lines: [{ id: 101, skuId: 55, purchaseSkuUomId: 88, orderedQuantity: "1.5", unitPrice: "0", zeroPriceReason: "  免費樣品贈送  ",
      expectedDeliveryDate: "2026-09-08", lineNote: "note" }] }));
  assert.equal(full.version, 3);
  assert.deepEqual(full.lines[0], { id: 101, skuId: 55, purchaseSkuUomId: 88, orderedQuantity: "1.500000", unitPrice: "0.0000",
    zeroPriceReason: "免費樣品贈送", expectedDeliveryDate: "2026-09-08", lineNote: "note" });
});

test("Client 計嘅 total、快照、factor、Base quantity 同 status 一律係未知欄位", () => {
  for (const field of ["totalAmount", "subtotalAmount", "status", "poNumber", "supplierCodeSnapshot", "version"]) {
    assert.throws(() => create(input({ [field]: 1 })), coded("PURCHASING_INPUT_INVALID", "body"), field);
  }
  const line = input().lines[0];
  for (const field of ["lineAmount", "orderedBaseQuantity", "uomToBaseFactor", "skuCodeSnapshot", "lineNumber", "id"]) {
    assert.throws(() => create(input({ lines: [{ ...line, [field]: 1 }] })), coded("PURCHASING_INPUT_INVALID", "lines.0"), field);
  }
  assert.throws(() => update(input({ version: 1, lines: [{ ...line, lineAmount: "1" }] })), coded("PURCHASING_INPUT_INVALID", "lines.0"));
  assert.throws(() => update(input()), coded("PURCHASING_INPUT_INVALID", "version"));
});

test("零價一定要 5～500 字原因；非零價唔收原因（BR-011、AC-008）", () => {
  const line = { skuId: 55, purchaseSkuUomId: 88, orderedQuantity: "1", unitPrice: "0.0000" };
  assert.throws(() => create(input({ lines: [line] })), coded("ZERO_PRICE_REASON_REQUIRED", "lines.0.zeroPriceReason"));
  assert.throws(() => create(input({ lines: [{ ...line, zeroPriceReason: "" }] })), coded("ZERO_PRICE_REASON_REQUIRED", "lines.0.zeroPriceReason"));
  assert.throws(() => create(input({ lines: [{ ...line, zeroPriceReason: " abc " }] })), coded("PURCHASING_INPUT_INVALID", "lines.0.zeroPriceReason"));
  assert.throws(() => create(input({ lines: [{ ...line, unitPrice: "0.0001", zeroPriceReason: "sample" }] })),
    coded("PURCHASING_INPUT_INVALID", "lines.0.zeroPriceReason"));
  assert.throws(() => create(input({ lines: [{ ...line, unitPrice: "-1" }] })), coded("UNIT_PRICE_INVALID", "lines.0.unitPrice"));
});

test("錯誤指出邊一行邊個欄位；交期唔可以早過 Order Date；Line ID 唔可以重複", () => {
  const line = input().lines[0], second = (patch) => input({ lines: [line, { ...line, ...patch }] });
  assert.throws(() => create(second({ orderedQuantity: "0" })), coded("PURCHASING_QUANTITY_INVALID", "lines.1.orderedQuantity"));
  assert.throws(() => create(second({ orderedQuantity: "1.0000001" })), coded("PURCHASING_QUANTITY_INVALID", "lines.1.orderedQuantity"));
  assert.throws(() => create(second({ unitPrice: "1.00001" })), coded("UNIT_PRICE_INVALID", "lines.1.unitPrice"));
  assert.throws(() => create(second({ skuId: 0 })), coded("PURCHASING_INPUT_INVALID", "lines.1.skuId"));
  assert.throws(() => create(second({ expectedDeliveryDate: "2026-09-07" })), coded("PURCHASING_INPUT_INVALID", "lines.1.expectedDeliveryDate"));
  assert.throws(() => create(second({ lineNote: "x".repeat(1001) })), coded("PURCHASING_INPUT_INVALID", "lines.1.lineNote"));
  assert.throws(() => create(input({ expectedDeliveryDate: "2026-09-07" })), coded("PURCHASING_INPUT_INVALID", "expectedDeliveryDate"));
  assert.throws(() => update(input({ version: 1, lines: [{ ...line, id: 9 }, line, { ...line, id: 9 }] })), coded("PURCHASING_INPUT_INVALID", "lines.2.id"));
  assert.deepEqual(update(input({ version: 1, lines: [line, line] })).lines.map((entry) => entry.id), [null, null]);
});

test("Header 欄位、Currency 格式同 Line 數上限", () => {
  assert.throws(() => create(input({ currencyCode: "hkd" })), coded("PURCHASING_INPUT_INVALID", "currencyCode"));
  assert.throws(() => create(input({ orderDate: "2026-02-30" })), coded("PURCHASING_INPUT_INVALID", "orderDate"));
  assert.throws(() => create(input({ buyerId: null })), coded("PURCHASING_INPUT_INVALID", "buyerId"));
  assert.throws(() => create(input({ eventId: EVENT.toUpperCase() })), coded("PURCHASING_INPUT_INVALID", "eventId"));
  assert.throws(() => create(input({ supplierReference: "a\nb" })), coded("PURCHASING_INPUT_INVALID", "supplierReference"));
  assert.throws(() => create(input({ lines: [] })), coded("PURCHASING_INPUT_INVALID", "lines"));
  const line = input().lines[0];
  assert.throws(() => draftProjection(input({ lines: [line, line] }), { maxLines: 1, update: false }), coded("PURCHASING_INPUT_INVALID", "lines"));
  assert.throws(() => create(null), coded("PURCHASING_INPUT_INVALID", "body"));
});
