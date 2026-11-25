import { revealSecret } from "../../framework/configuration/SecretValue.js";
import { readInvoiceShipmentReferences } from "../fulfillment/readInvoiceShipmentReferences.js";
import { arError } from "./arErrors.js";

const REQUIRED_COMPANY_FIELDS = {
  issuerName: "AR_INVOICE_PRINT_COMPANY_NAME_MISSING",
  paymentInstructions: "AR_INVOICE_PRINT_PAYMENT_MISSING"
};

/** Only the fields used on the invoice. No addresses from current customer master data. */
export async function getArInvoicePrint({ database, company, id }) {
  const [[invoice]] = await database.query(`SELECT invoice_number, status, customer_name_snapshot, billing_address_snapshot,
    currency_code, currency_decimal_places, DATE_FORMAT(invoice_date, '%Y-%m-%d') AS invoice_date,
    DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date, payment_term_code_snapshot, payment_term_name_snapshot, total_amount,
    EXISTS(SELECT 1 FROM ar_invoice_lines WHERE invoice_id = ar_invoices.id) AS has_shipment_lines
    FROM ar_invoices WHERE id = ?`, [id]);
  if (!invoice) throw arError("AR_INVOICE_NOT_FOUND");
  if (invoice.status !== "CONFIRMED" || !invoice.invoice_number || Number(invoice.has_shipment_lines) !== 1) throw arError("AR_INVOICE_NOT_PRINTABLE");
  if (!invoice.billing_address_snapshot) throw arError("AR_INVOICE_PRINT_SNAPSHOT_MISSING");
  const printCompany = {
    issuerName: company?.name ?? "", issuerHeader: company?.header ?? "",
    paymentInstructions: revealSecret(company?.paymentInstructions), footer: company?.footer ?? ""
  };
  for (const [field, code] of Object.entries(REQUIRED_COMPANY_FIELDS)) {
    if (!printCompany[field].trim()) throw arError(code);
  }

  const [lines] = await database.query(`SELECT line_no, shipment_id, sku_code_snapshot, sku_name_snapshot, base_uom_code_snapshot,
    sales_uom_code_snapshot, to_base_factor_snapshot, quantity, unit_price_snapshot, line_amount
    FROM ar_invoice_lines WHERE invoice_id = ? ORDER BY line_no`, [id]);
  let sources;
  try {
    sources = await readInvoiceShipmentReferences(database, [...new Set(lines.map((line) => Number(line.shipment_id)))]);
  } catch (error) {
    if (["FULFILLMENT_INPUT_INVALID", "SHIPMENT_NOT_FOUND"].includes(error.code)) throw arError("AR_INVOICE_PRINT_SOURCE_MISSING");
    throw error;
  }
  const byShipment = new Map(sources.map(({ shipmentId, ...numbers }) => [shipmentId, numbers]));
  return {
    number: invoice.invoice_number, customerName: invoice.customer_name_snapshot, billingAddress: invoice.billing_address_snapshot.split("\n"),
    currencyCode: invoice.currency_code, currencyDecimalPlaces: Number(invoice.currency_decimal_places),
    invoiceDate: invoice.invoice_date, dueDate: invoice.due_date, paymentTermCode: invoice.payment_term_code_snapshot,
    paymentTermName: invoice.payment_term_name_snapshot, totalAmount: invoice.total_amount,
    ...printCompany,
    lines: lines.map((line) => ({
      lineNo: Number(line.line_no), skuCode: line.sku_code_snapshot, skuName: line.sku_name_snapshot,
      baseUomCode: line.base_uom_code_snapshot, salesUomCode: line.sales_uom_code_snapshot, toBaseFactor: Number(line.to_base_factor_snapshot),
      quantity: String(line.quantity), unitPrice: line.unit_price_snapshot, lineAmount: line.line_amount, ...byShipment.get(Number(line.shipment_id))
    }))
  };
}
