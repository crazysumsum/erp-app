import { SecretValue, secretValue } from "../../framework/configuration/SecretValue.js";

function invoiceText(value, field, maximum, multiline = false) {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new TypeError(`${field} must be text`);
  const normalized = multiline ? value.replaceAll("\r\n", "\n") : value;
  const controls = /\p{Cc}/u.test(multiline ? normalized.replaceAll("\n", "") : normalized);
  if (!normalized.isWellFormed() || [...normalized].length > maximum || controls) {
    throw new TypeError(`${field} must have at most ${maximum} characters and no control characters except permitted line breaks`);
  }
  return normalized;
}

export function normalizeInvoiceCompanyConfig(config) {
  const payment = config?.paymentInstructions;
  return Object.freeze({
    name: invoiceText(config?.name, "AR_INVOICE_COMPANY_NAME", 190),
    header: invoiceText(config?.header, "AR_INVOICE_COMPANY_HEADER", 2000, true),
    paymentInstructions: secretValue(
      invoiceText(payment instanceof SecretValue ? payment.reveal() : payment, "AR_INVOICE_PAYMENT_INSTRUCTIONS", 2000, true),
      "AR_INVOICE_PAYMENT_INSTRUCTIONS"
    ),
    footer: invoiceText(config?.footer, "AR_INVOICE_FOOTER", 2000, true)
  });
}
