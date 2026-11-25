import { calculateDueDate } from "../businessMaster/businessMasterRules.js";
import { amountUnits, formatUnits, localDate, onlyFields, text } from "./apCommand.js";
import { apError } from "./apErrors.js";

export const MAX_RECEIPTS = 20;
const MAX_LINES = 65_535;
const MAX_AMOUNT = 9_999_999_999_999_999_999n;
const MAX_SOURCE_ID = (1n << 64n) - 1n;
const invalid = (field) => apError("AP_INPUT_INVALID", { field });

export function sourceId(value, field) {
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/u.test(value) || BigInt(value) > MAX_SOURCE_ID) throw invalid(field);
  return value;
}

export function supplierInvoiceNumber(value) {
  if (typeof value !== "string") throw invalid("supplierInvoiceNumber");
  const number = text(value.trim(), "supplierInvoiceNumber", { minimum: 1, maximum: 100 });
  const key = text(number.toUpperCase(), "supplierInvoiceNumber", { minimum: 1, maximum: 100 });
  return { number, key };
}

export function requiredText(value, field) {
  if (typeof value !== "string") throw invalid(field);
  return text(value.trim(), field, { minimum: 1, maximum: 500, multiline: true });
}

function roundHalfUp(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

function checkedAmount(units, field) {
  if (units > MAX_AMOUNT) throw invalid(field);
  return formatUnits(units);
}

export function receiptAmounts(quantity, unitPrice, toBaseFactor) {
  const poUnits = amountUnits(unitPrice, "poUnitPrice");
  const units = roundHalfUp(BigInt(quantity) * poUnits, BigInt(toBaseFactor));
  return { poUnitPrice: formatUnits(poUnits), poLineAmount: checkedAmount(units, "poLineAmount") };
}

export function invoiceUnitPrice(amount, quantity, toBaseFactor) {
  return formatUnits(roundHalfUp(amountUnits(amount, "lineAmount") * BigInt(toBaseFactor), BigInt(quantity)));
}

export function invoiceTotal(lines, decimalPlaces) {
  if (!lines.length || lines.length > MAX_LINES) throw invalid("lines");
  const sum = lines.reduce((total, line) => total + amountUnits(line.line_amount, "lineAmount"), 0n);
  const step = 10n ** BigInt(4 - decimalPlaces);
  return checkedAmount(roundHalfUp(sum, step) * step, "totalAmount");
}

export function draftExpenses(items) {
  if (!Array.isArray(items) || items.length > MAX_LINES) throw invalid("expenses");
  return items.map((item, index) => {
    const field = `expenses.${index}`;
    const { description, lineAmount } = onlyFields(item, ["description", "lineAmount"], field);
    const units = amountUnits(lineAmount, `${field}.lineAmount`);
    if (units === 0n) throw invalid(`${field}.lineAmount`);
    return { line_type: "EXPENSE", line_amount: formatUnits(units), description: requiredText(description, `${field}.description`) };
  });
}

export function draftOverrides(items) {
  if (!Array.isArray(items) || items.length > MAX_LINES) throw invalid("receiptOverrides");
  const overrides = items.map((item, index) => {
    const field = `receiptOverrides.${index}`;
    const { goodsReceiptLineId, lineAmount, reason } = onlyFields(item, ["goodsReceiptLineId", "lineAmount", "reason"], field);
    return {
      goodsReceiptLineId: sourceId(goodsReceiptLineId, `${field}.goodsReceiptLineId`),
      lineAmount: formatUnits(amountUnits(lineAmount, `${field}.lineAmount`)),
      reason: requiredText(reason, `${field}.reason`)
    };
  });
  if (new Set(overrides.map(({ goodsReceiptLineId }) => goodsReceiptLineId)).size !== overrides.length) throw invalid("receiptOverrides");
  return overrides;
}

export function initialDueDate(receipts, { invoiceDate, dueDate, dueDateReason }) {
  const term = receipts[0]?.paymentTerm;
  const common = term && receipts.every(({ paymentTerm }) => paymentTerm?.code === term.code &&
    paymentTerm.calculationType === term.calculationType && paymentTerm.dueDays === term.dueDays) ? term : null;
  const computed = common ? calculateDueDate(common, invoiceDate).dueDate : null;
  const due = dueDate ?? computed;
  if (!due) throw apError("AP_DUE_DATE_REQUIRED");
  if (due < invoiceDate) throw invalid("dueDate");
  const overridden = computed !== null && due !== computed;
  return {
    due_date: due,
    due_date_overridden: overridden ? 1 : 0,
    due_date_reason: overridden ? requiredText(dueDateReason, "dueDateReason") : "",
    payment_term_code_snapshot: common?.code ?? "",
    payment_term_name_snapshot: common?.name ?? ""
  };
}

export function editedDueDate(invoice, { dueDate, dueDateReason }) {
  if (dueDate === undefined || dueDate === invoice.due_date) return {};
  if (dueDate < invoice.invoice_date) throw invalid("dueDate");
  return {
    due_date: dueDate,
    due_date_overridden: 1,
    due_date_reason: requiredText(dueDateReason, "dueDateReason")
  };
}

export function draftFields(body, creating = false) {
  const fields = {};
  if (creating || Object.hasOwn(body, "supplierInvoiceNumber")) fields.invoiceNumber = supplierInvoiceNumber(body.supplierInvoiceNumber);
  if (creating) fields.invoiceDate = localDate(body.invoiceDate, "invoiceDate");
  if (Object.hasOwn(body, "dueDate")) fields.dueDate = localDate(body.dueDate, "dueDate");
  if (Object.hasOwn(body, "dueDateReason")) fields.dueDateReason = text(body.dueDateReason, "dueDateReason", { maximum: 500, multiline: true });
  if (Object.hasOwn(body, "supplierTotalAmount")) {
    fields.supplierTotal = body.supplierTotalAmount === null ? null : formatUnits(amountUnits(body.supplierTotalAmount, "supplierTotalAmount"));
  }
  if (Object.hasOwn(body, "notes")) fields.notes = text(body.notes, "notes", { maximum: 2000, multiline: true });
  if (creating || Object.hasOwn(body, "expenses")) fields.expenses = draftExpenses(body.expenses ?? []);
  if (creating || Object.hasOwn(body, "receiptOverrides")) fields.overrides = draftOverrides(body.receiptOverrides ?? []);
  return fields;
}
