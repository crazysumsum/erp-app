const PAYMENT_REFERENCES = "SELECT COUNT(*) AS reference_count FROM ap_payments WHERE supplier_id = ? FOR SHARE";
const INVOICE_REFERENCES = "SELECT COUNT(*) AS reference_count FROM ap_invoices WHERE supplier_id = ? FOR SHARE";
const OPEN_INVOICES = "SELECT COUNT(*) AS reference_count FROM ap_invoices WHERE supplier_id = ? AND status = 'CONFIRMED' AND outstanding_amount > 0 FOR SHARE";

async function countReferences(connection, sql, supplierId) {
  const [[row]] = await connection.query(sql, [supplierId]);
  const count = Number(row?.reference_count ?? NaN);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid AP Supplier reference count");
  return count;
}

export const apSupplierReferenceChecker = Object.freeze({
  name: "應付發票及付款",
  async count(connection, supplierId) {
    // Supplier already holds its parent row. Keep the AP payment → invoice lock order used by allocation.
    const payments = await countReferences(connection, PAYMENT_REFERENCES, supplierId);
    const invoices = await countReferences(connection, INVOICE_REFERENCES, supplierId);
    return payments + invoices;
  }
});

export const openApSupplierInvoiceChecker = Object.freeze({
  name: "未付應付發票",
  async count(connection, supplierId) {
    return countReferences(connection, OPEN_INVOICES, supplierId);
  }
});
