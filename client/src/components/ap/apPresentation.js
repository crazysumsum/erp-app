export {
  allocationStatusLabels, fromUnits, invoiceOutstandingText, invoiceStatusLabels, money, paymentMethodLabels,
  receiptStatusLabels as paymentStatusLabels, statusColors, timestamp, today, toUnits
} from "@/components/ar/arPresentation.js";

export function amountInputValid(value, decimalPlaces, allowZero = false) {
  const parts = /^(\d{1,15})(?:\.(\d{1,4}))?$/u.exec(value);
  return Boolean(parts && !/[1-9]/u.test((parts[2] ?? "").slice(decimalPlaces)) && (allowZero || /[1-9]/u.test(value)));
}
