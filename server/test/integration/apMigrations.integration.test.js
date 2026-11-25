import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const permissions = [
  "ap.credit.mgmt", "ap.invoice.mgmt", "ap.invoice.price.override", "ap.payment.mgmt", "ap.refund.mgmt", "ap.view"
];

async function connect(t) {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });
  t.after(() => db.end());
  return db;
}

integrationTest("AP installs exactly eleven tables and grants the six permissions only to system-admin", async (t) => {
  const db = await connect(t);
  const [tables] = await db.query(
    "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LEFT(TABLE_NAME, 3) = 'ap_' ORDER BY TABLE_NAME"
  );
  assert.deepEqual(tables.map(({ TABLE_NAME }) => TABLE_NAME), [
    "ap_audit_logs", "ap_credit_applications", "ap_credit_note_lines", "ap_credit_notes",
    "ap_document_sequences", "ap_invoice_lines", "ap_invoices", "ap_operation_requests",
    "ap_payment_allocations", "ap_payments", "ap_supplier_refunds"
  ]);
  for (const table of tables) {
    assert.equal(table.ENGINE, "InnoDB");
    assert.equal(table.TABLE_COLLATION, "utf8mb4_unicode_ci");
  }
  const [grants] = await db.query(
    "SELECT p.name, r.name AS role FROM permissions p LEFT JOIN role_permissions rp ON rp.permission_id = p.id LEFT JOIN roles r ON r.id = rp.role_id WHERE p.name LIKE 'ap.%' ORDER BY p.name"
  );
  assert.deepEqual(grants, permissions.map((name) => ({ name, role: "system-admin" })));

  const [foreignKeys] = await db.query(
    "SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ap_invoice_lines' AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY REFERENCED_TABLE_NAME, ORDINAL_POSITION"
  );
  assert.deepEqual(foreignKeys.map((row) => Object.values(row)), [
    ["invoice_id", "ap_invoices", "id"],
    ["goods_receipt_line_id", "goods_receipt_lines", "id"],
    ["goods_receipt_id", "goods_receipt_lines", "goods_receipt_id"],
    ["goods_receipt_id", "goods_receipts", "id"]
  ]);

  const [creditLineKeys] = await db.query(`
    SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ap_credit_note_lines'
       AND REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY REFERENCED_TABLE_NAME, ORDINAL_POSITION
  `);
  assert.deepEqual(creditLineKeys.map((row) => Object.values(row)), [
    ["credit_note_id", "ap_credit_notes", "id"],
    ["invoice_id", "ap_credit_notes", "invoice_id"],
    ["invoice_line_id", "ap_invoice_lines", "id"],
    ["supplier_return_line_id", "supplier_return_lines", "id"]
  ]);
});

integrationTest("AP balances, invoice reservations, and audit immutability survive direct SQL writes", async (t) => {
  const db = await connect(t);
  const { ApBusinessMasterImpactChecker } = await import("../../src/modules/accounts-payable/ApBusinessMasterImpactChecker.js");
  const checker = new ApBusinessMasterImpactChecker({ database: db });
  await db.query("SET SESSION FOREIGN_KEY_CHECKS = 0");
  await db.beginTransaction();
  try {
    const supplier = "9000000000000000000";
    const receipt = "9000000000000000001";
    const receiptLine = "9000000000000000002";
    const invoiceKey = randomUUID().toUpperCase();
    const insertInvoice = (status, key, allocated, outstanding) => db.execute(
      "INSERT INTO ap_invoices (status, supplier_id, supplier_code_snapshot, supplier_name_snapshot, currency_code, currency_decimal_places, supplier_invoice_number, active_supplier_invoice_key, invoice_date, due_date, total_amount, allocated_amount, outstanding_amount, created_by_label, created_at, updated_at) VALUES (?, ?, 'AP-TEST', 'AP test', 'ZZZ', 2, ?, ?, '2026-11-20', '2026-11-24', 10, ?, ?, 'test', 1, 1)",
      [status, supplier, invoiceKey, key, allocated, outstanding]
    );
    const [invoice] = await insertInvoice("CONFIRMED", invoiceKey, 1, 9);
    await assert.rejects(insertInvoice("DRAFT", invoiceKey, 0, 10), { code: "ER_DUP_ENTRY" });
    await assert.rejects(insertInvoice("DRAFT", null, 1, 10), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
    const [second] = await insertInvoice("CONFIRMED", null, 10, 0);

    const insertReceiptLine = (invoiceId) => db.execute(
      "INSERT INTO ap_invoice_lines (invoice_id, line_no, line_type, goods_receipt_id, goods_receipt_line_id, active_goods_receipt_line_id, quantity, line_amount) VALUES (?, 1, 'RECEIPT', ?, ?, ?, 1, 10)",
      [invoiceId, receipt, receiptLine, receiptLine]
    );
    await insertReceiptLine(invoice.insertId);
    await assert.rejects(insertReceiptLine(second.insertId), { code: "ER_DUP_ENTRY" });
    await assert.rejects(db.execute(
      "INSERT INTO ap_invoice_lines (invoice_id, line_no, line_type, quantity, line_amount) VALUES (?, 2, 'EXPENSE', 1, 2)", [invoice.insertId]
    ), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });

    const insertPayment = (status, allocated, available) => db.execute(
      "INSERT INTO ap_payments (status, supplier_id, supplier_code_snapshot, supplier_name_snapshot, currency_code, currency_decimal_places, payment_date, amount, allocated_amount, available_amount, payment_method, created_by_label, created_at, updated_at) VALUES (?, ?, 'AP-TEST', 'AP test', 'ZZZ', 2, '2026-11-24', 10, ?, ?, 'BANK_TRANSFER', 'test', 1, 1)",
      [status, supplier, allocated, available]
    );
    await insertPayment("DRAFT", 0, 10);
    await insertPayment("VOID", 0, 0);
    await assert.rejects(insertPayment("VOID", 0, 10), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
    const result = await checker.check({ entityType: "CURRENCY", entityKey: "ZZZ" });
    assert.deepEqual(
      { ...result, watermark: undefined },
      { status: "READY", activeDefaultCount: 0, openUseCount: 2, historicalCount: 2, watermark: undefined }
    );
    assert.match(result.watermark, /^ap:CURRENCY:ZZZ:[0-9a-f]{64}$/u);
    const term = await checker.check({ entityType: "PAYMENT_TERM", entityKey: "1" });
    assert.equal(term.status, "READY");
    assert.equal(term.openUseCount + term.historicalCount + term.activeDefaultCount, 0);

    const [audit] = await db.execute(
      "INSERT INTO ap_audit_logs (occurred_at, actor_label, action, outcome, target_type) VALUES (1, 'test', 'payment.confirmed', 'SUCCEEDED', 'PAYMENT')"
    );
    await assert.rejects(db.execute("UPDATE ap_audit_logs SET reason = 'changed' WHERE id = ?", [audit.insertId]), { sqlState: "45000" });
    await assert.rejects(db.execute("DELETE FROM ap_audit_logs WHERE id = ?", [audit.insertId]), { sqlState: "45000" });
  } finally {
    await db.rollback();
  }
});

integrationTest("AP credit and refund tables enforce amounts and accept their sequence and audit types", async (t) => {
  const db = await connect(t);
  // Use synthetic AP references; the AP credit-line foreign keys are checked above.
  await db.query("SET SESSION FOREIGN_KEY_CHECKS = 0");
  await db.beginTransaction();
  try {
    const insertCredit = (status, applied, refunded, available) => db.execute(`
      INSERT INTO ap_credit_notes (status, invoice_id, supplier_id, supplier_code_snapshot,
        supplier_name_snapshot, currency_code, currency_decimal_places, credit_date, reason,
        total_amount, applied_amount, refunded_amount, available_amount, created_by_label, created_at, updated_at)
      VALUES (?, 1, 1, 'TEST', 'Test supplier', 'ZZZ', 2, '2026-11-25', 'Test', 10, ?, ?, ?, 'test', 1, 1)
    `, [status, applied, refunded, available]);
    const invalidCheck = { code: "ER_CHECK_CONSTRAINT_VIOLATED" };
    const [credit] = await insertCredit("CONFIRMED", 3, 2, 5);
    const { lockCreditNote } = await import("../../src/modules/accounts-payable/apCreditFunds.js");
    const locked = await lockCreditNote(db, credit.insertId);
    assert.equal(locked.status, "CONFIRMED");
    assert.equal(locked.available_amount, "5.0000");
    assert.equal(locked.refunded_amount, "2.0000");
    assert.equal(await lockCreditNote(db, 0), null);
    await insertCredit("VOID", 0, 0, 0);
    await assert.rejects(insertCredit("CONFIRMED", 3, 2, 6), invalidCheck);
    await assert.rejects(insertCredit("CONFIRMED", -1, 0, 11), invalidCheck);
    await assert.rejects(insertCredit("VOID", 0, 1, 0), invalidCheck);

    const insertLine = (quantity, amount) => db.execute(`
      INSERT INTO ap_credit_note_lines (credit_note_id, invoice_id, line_no, invoice_line_id, base_quantity, amount)
      VALUES (?, 1, 1, 1, ?, ?)
    `, [credit.insertId, quantity, amount]);
    await assert.rejects(insertLine(null, 0), invalidCheck);
    await assert.rejects(insertLine(0, 10), invalidCheck);
    await insertLine(null, 10);
    const insertApplication = (isOrigin, amount) => db.execute(`
      INSERT INTO ap_credit_applications (credit_note_id, invoice_id, is_origin, amount, created_by_label, created_at)
      VALUES (?, 1, ?, ?, 'test', 1)
    `, [credit.insertId, isOrigin, amount]);
    await assert.rejects(insertApplication(2, 3), invalidCheck);
    await assert.rejects(insertApplication(1, 0), invalidCheck);
    await insertApplication(1, 3);

    const insertRefund = (method, amount) => db.execute(`
      INSERT INTO ap_supplier_refunds (credit_note_id, supplier_id, currency_code, refund_date,
        amount, payment_method, created_by_label, created_at, updated_at)
      VALUES (?, 1, 'ZZZ', '2026-11-25', ?, ?, 'test', 1, 1)
    `, [credit.insertId, amount, method]);
    await assert.rejects(insertRefund("CASH", 0), invalidCheck);
    await assert.rejects(insertRefund("INVALID", 2), invalidCheck);
    await insertRefund("CASH", 2);

    const insertSequence = (type) => db.execute(
      "INSERT INTO ap_document_sequences (document_type, business_year, updated_at) VALUES (?, 9999, 1)", [type]
    );
    for (const type of ["INVOICE", "PAYMENT", "CREDIT_NOTE", "REFUND"]) await insertSequence(type);
    await assert.rejects(insertSequence("INVALID"), invalidCheck);
    const { nextDocumentNumber } = await import("../../src/modules/accounts-payable/apCommand.js");
    const time = { at: (nowMs) => nowMs, fileDate: () => "9999-12-31" };
    const number = (documentType) => nextDocumentNumber(db, { documentType, time, nowMs: 1 });
    assert.equal(await number("CREDIT_NOTE"), "SCN-9999-000001");
    assert.equal(await number("REFUND"), "SRF-9999-000001");
    assert.equal(await number("REFUND"), "SRF-9999-000002");
    assert.equal(await number("INVOICE"), "APV-9999-000001");
    assert.equal(await number("PAYMENT"), "PMT-9999-000001");

    const insertAudit = (type) => db.execute(
      "INSERT INTO ap_audit_logs (occurred_at, actor_label, action, outcome, target_type) VALUES (1, 'test', 'test', 'SUCCEEDED', ?)", [type]
    );
    for (const type of ["INVOICE", "PAYMENT", "ALLOCATION", "CREDIT_NOTE", "CREDIT_APPLICATION", "REFUND"]) {
      await insertAudit(type);
    }
    await assert.rejects(insertAudit("INVALID"), invalidCheck);
  } finally {
    await db.rollback();
  }
});
