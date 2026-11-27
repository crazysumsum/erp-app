const PAYMENT_REFERENCES = "SELECT COUNT(*) AS reference_count FROM ap_payments WHERE supplier_id = ? FOR SHARE";
const CREDIT_REFERENCES = "SELECT COUNT(*) AS reference_count FROM ap_credit_notes WHERE supplier_id = ? FOR SHARE";
const INVOICE_REFERENCES = "SELECT COUNT(*) AS reference_count FROM ap_invoices WHERE supplier_id = ? FOR SHARE";
const REFUND_REFERENCES = "SELECT COUNT(*) AS reference_count FROM ap_supplier_refunds WHERE supplier_id = ? FOR SHARE";
const OPEN_INVOICES = "SELECT COUNT(*) AS reference_count FROM ap_invoices WHERE supplier_id = ? AND status = 'CONFIRMED' AND outstanding_amount > 0 FOR SHARE";

async function countReferences(connection, sql, supplierId) {
  const [[row]] = await connection.query(sql, [supplierId]);
  const count = Number(row?.reference_count ?? NaN);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid AP Supplier reference count");
  return count;
}

export const apSupplierReferenceChecker = Object.freeze({
  name: "應付文件",
  async count(connection, supplierId) {
    // Supplier holds the parent row. Take payment and credit locks before invoice locks, and credit locks before refund locks.
    const payments = await countReferences(connection, PAYMENT_REFERENCES, supplierId);
    const credits = await countReferences(connection, CREDIT_REFERENCES, supplierId);
    const invoices = await countReferences(connection, INVOICE_REFERENCES, supplierId);
    const refunds = await countReferences(connection, REFUND_REFERENCES, supplierId);
    return payments + credits + invoices + refunds;
  }
});

export const openApSupplierInvoiceChecker = Object.freeze({
  name: "未付應付發票",
  async count(connection, supplierId) {
    return countReferences(connection, OPEN_INVOICES, supplierId);
  }
});
