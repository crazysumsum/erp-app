import { amountUnits, formatUnits, localDate, onlyFields, positiveId, storedUnits, text } from "./apCommand.js";
import { requiredText, sourceId } from "./apInvoiceDraft.js";
import { apError } from "./apErrors.js";

const MAX_LINES = 65535;
const invalid = (field) => apError("AP_INPUT_INVALID", { field });
const optionalSourceId = (value, field) => value == null ? null : sourceId(value, field);

export function creditDraftFields(body) {
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > MAX_LINES) throw invalid("lines");
  const lines = body.lines.map((item, index) => {
    const field = `lines.${index}`;
    const line = onlyFields(item, ["invoiceLineId", "supplierReturnLineId", "baseQuantity", "amount", "description"], field);
    return {
      invoiceLineId: positiveId(line.invoiceLineId, `${field}.invoiceLineId`),
      supplierReturnLineId: optionalSourceId(line.supplierReturnLineId, `${field}.supplierReturnLineId`),
      baseQuantity: optionalSourceId(line.baseQuantity, `${field}.baseQuantity`),
      amount: formatUnits(amountUnits(line.amount, `${field}.amount`)),
      description: text(line.description ?? "", `${field}.description`, { maximum: 500, multiline: true })
    };
  });
  return {
    creditDate: localDate(body.creditDate, "creditDate"),
    reason: requiredText(body.reason, "reason"),
    supplierCreditReference: text(body.supplierCreditReference ?? "", "supplierCreditReference", { maximum: 100 }),
    supplierReturnId: optionalSourceId(body.supplierReturnId, "supplierReturnId"),
    notes: text(body.notes ?? "", "notes", { maximum: 2000, multiline: true }),
    lines
  };
}

export function creditLineCaps(lines, totalAmount, decimalPlaces) {
  const step = 10n ** BigInt(4 - decimalPlaces);
  const total = storedUnits(totalAmount);
  const ranked = lines.map((row) => {
    const units = storedUnits(row.line_amount);
    const remainder = units % step;
    return { id: Number(row.id), lineNo: Number(row.line_no), floor: units - remainder, remainder };
  });
  ranked.sort((a, b) => {
    if (a.remainder === b.remainder) return a.lineNo - b.lineNo;
    return a.remainder > b.remainder ? -1 : 1;
  });
  const residual = total - ranked.reduce((sum, row) => sum + row.floor, 0n);
  if (residual < 0n || residual % step !== 0n || residual > step * BigInt(ranked.length)) throw apError("AP_STATE_CONFLICT");
  const extraUnits = Number(residual / step);
  return new Map(ranked.map(({ id, floor }, index) => [id, floor + (index < extraUnits ? step : 0n)]));
}

export function validateCreditAmounts(lines, caps, usedByLine, invoiceTotal, creditedTotal, decimalPlaces) {
  const usage = new Map(usedByLine);
  let total = 0n;
  for (const [index, line] of lines.entries()) {
    const cap = caps.get(line.invoiceLineId);
    if (cap === undefined) throw invalid(`lines.${index}.invoiceLineId`);
    const field = `lines.${index}.amount`;
    const amount = amountUnits(line.amount, field, decimalPlaces);
    if (amount <= 0n) throw invalid(field);
    const cumulative = (usage.get(line.invoiceLineId) ?? 0n) + amount;
    if (cumulative > cap) throw apError("AP_CREDIT_EXCEEDS_INVOICE", { field });
    usage.set(line.invoiceLineId, cumulative);
    total += amount;
  }
  if (creditedTotal + total > invoiceTotal) throw apError("AP_CREDIT_EXCEEDS_INVOICE", { field: "lines" });
  return formatUnits(total);
}
