import assert from "node:assert/strict";
import test from "node:test";

const load = () => import("../../src/modules/accounts-payable/apInvoiceDraft.js");

test("supplier invoice numbers keep their trimmed display text and validate the expanded uppercase key", async () => {
  const { supplierInvoiceNumber } = await load();
  assert.deepEqual(supplierInvoiceNumber("  Ab–ß  "), { number: "Ab–ß", key: "AB–SS" });
  assert.throws(() => supplierInvoiceNumber("ß".repeat(51)), { code: "AP_INPUT_INVALID" });
  assert.throws(() => supplierInvoiceNumber("   "), { code: "AP_INPUT_INVALID" });
});

test("PO amounts use receipt base quantity and half-up four-place math before rounding the invoice total", async () => {
  const { receiptAmounts, invoiceTotal, invoiceUnitPrice } = await load();
  assert.deepEqual(receiptAmounts("5", "25.0000", 2), { poUnitPrice: "25.0000", poLineAmount: "62.5000" });
  assert.deepEqual(receiptAmounts("1", "0.0001", 2), { poUnitPrice: "0.0001", poLineAmount: "0.0001" });
  assert.equal(invoiceTotal([{ line_amount: "60.0050" }, { line_amount: "1.0000" }], 2), "61.0100");
  assert.equal(invoiceUnitPrice("60.0100", "5", 2), "24.0040");
  assert.throws(() => receiptAmounts("4", "999999999999999.9999", 1), { code: "AP_INPUT_INVALID" });
  assert.throws(() => invoiceTotal([{ line_amount: "999999999999999.9999" }], 2), { code: "AP_INPUT_INVALID" });
});

test("AP calculates the initial due date from a common PO snapshot and requires a reason for later changes", async () => {
  const { initialDueDate, editedDueDate } = await load();
  const invoiceDate = "2026-11-24";
  const term = { code: "N30", name: "Net 30", calculationType: "NET_DAYS", dueDays: 30 };
  const receipts = [{ paymentTerm: term }, { paymentTerm: { ...term } }];
  assert.equal(initialDueDate(receipts, { invoiceDate }).due_date, "2026-12-24");
  assert.throws(() => initialDueDate(receipts, { invoiceDate, dueDate: "2026-12-25" }), { code: "AP_INPUT_INVALID" });
  const mixed = [receipts[0], { paymentTerm: { ...term, dueDays: 60 } }];
  assert.throws(() => initialDueDate(mixed, { invoiceDate }), { code: "AP_DUE_DATE_REQUIRED" });
  assert.equal(initialDueDate(mixed, { invoiceDate, dueDate: "2026-12-01" }).payment_term_code_snapshot, "");
  const stored = { invoice_date: invoiceDate, due_date: "2026-12-24" };
  assert.deepEqual(editedDueDate(stored, { dueDate: "2026-12-24" }), {});
  assert.throws(() => editedDueDate(stored, { dueDate: "2026-12-25" }), { code: "AP_INPUT_INVALID" });
  assert.deepEqual(editedDueDate(stored, { dueDate: "2026-12-25", dueDateReason: "Supplier agreed" }),
    { due_date: "2026-12-25", due_date_overridden: 1, due_date_reason: "Supplier agreed" });
});
