import { randomUUID } from "node:crypto";

export async function customerCredit(f, post, get) {
  const code = `RFC-${randomUUID().slice(0, 8)}`, now = Date.now();
  const [{ insertId: partyId }] = await f.db.query("INSERT INTO customers SET ?", [{
    customer_code: code, customer_code_key: code.toLowerCase(), legal_name: code, legal_name_key: code.toLowerCase(),
    default_currency_code: "HKD", status: "active", version: 1, created_at: now, updated_at: now
  }]);
  const ref = randomUUID();
  const [{ insertId: invoice }] = await f.db.query("INSERT INTO ar_invoices SET ?", [{
    invoice_number: code, opening_reference: ref, active_opening_reference: ref, status: "CONFIRMED",
    customer_id: partyId, customer_code_snapshot: code, customer_name_snapshot: code, currency_code: f.other, currency_decimal_places: 2,
    invoice_date: f.today, due_date: f.today, total_amount: "40.0000", allocated_amount: "40.0000", outstanding_amount: "0.0000",
    created_by_label: "fixture", created_at: now, updated_at: now
  }]);
  const draft = f.ok(await post("/api/v1/ar-credit-notes", { invoiceId: Number(invoice), creditDate: f.today, reason: "Synthetic opening credit", lines: [{ amount: "10" }] }));
  const path = `/api/v1/ar-credit-notes/${draft.id}`;
  const confirmed = f.ok(await post(path + "/confirm", { version: draft.version }));
  if (f.other !== "HKD") await f.db.query("UPDATE currencies SET status = 'INACTIVE' WHERE code = ?", [f.other]);
  await f.db.query("UPDATE customers SET status = 'inactive' WHERE id = ?", [partyId]);
  return { partyKey: "customerId", partyId: Number(partyId), currency: f.other, credit: () => get(path), number: confirmed.number };
}

export async function supplierCredit(f, post, get) {
  const code = `RFD-${randomUUID().slice(0, 8)}`;
  const now = Date.now();
  const [{ insertId: supplierId }] = await f.db.query("INSERT INTO suppliers SET ?", [{
    supplier_code: code, supplier_code_key: code.toLowerCase(), supplier_name: code, supplier_name_key: code.toLowerCase(),
    default_currency_code: "HKD", status: "active", created_at: now, updated_at: now
  }]);
  const [{ insertId: invoiceId }] = await f.db.query("INSERT INTO ap_invoices SET ?", [{
    invoice_number: code, status: "CONFIRMED", supplier_id: supplierId, supplier_code_snapshot: code, supplier_name_snapshot: code,
    currency_code: "HKD", currency_decimal_places: 2, supplier_invoice_number: code, invoice_date: f.today, due_date: f.today,
    total_amount: "40.0000", allocated_amount: "40.0000", outstanding_amount: "0.0000", created_by_label: "fixture", created_at: now, updated_at: now
  }]);
  const [{ insertId: invoiceLineId }] = await f.db.query(
    "INSERT INTO ap_invoice_lines (invoice_id, line_no, line_type, line_amount) VALUES (?, 1, 'EXPENSE', 40)", [invoiceId]);
  const draft = f.ok(await post("/api/v1/ap-credit-notes", {
    invoiceId: Number(invoiceId), creditDate: f.today, reason: "Synthetic supplier credit", lines: [{ invoiceLineId: Number(invoiceLineId), amount: "10" }]
  }));
  const path = `/api/v1/ap-credit-notes/${draft.id}`;
  const confirmed = f.ok(await post(path + "/confirm", { version: draft.version }));
  await f.db.query("UPDATE suppliers SET status = 'archived' WHERE id = ?", [supplierId]);
  return { partyKey: "supplierId", partyId: Number(supplierId), currency: "HKD", credit: () => get(path), number: confirmed.number };
}
