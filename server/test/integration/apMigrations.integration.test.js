import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const permissions = ["ap.invoice.mgmt", "ap.invoice.price.override", "ap.payment.mgmt", "ap.view"];

async function connect(t) {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });
  t.after(() => db.end());
  return db;
}

integrationTest("AP installs exactly seven tables and registers the four permissions without default role grants", async (t) => {
  const db = await connect(t);
  const [tables] = await db.query(
    "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LEFT(TABLE_NAME, 3) = 'ap_' ORDER BY TABLE_NAME"
  );
  assert.deepEqual(tables.map(({ TABLE_NAME }) => TABLE_NAME), [
    "ap_audit_logs", "ap_document_sequences", "ap_invoice_lines", "ap_invoices",
    "ap_operation_requests", "ap_payment_allocations", "ap_payments"
  ]);
  for (const table of tables) {
    assert.equal(table.ENGINE, "InnoDB");
    assert.equal(table.TABLE_COLLATION, "utf8mb4_unicode_ci");
  }
  const [grants] = await db.query(
    "SELECT p.name, r.name AS role FROM permissions p LEFT JOIN role_permissions rp ON rp.permission_id = p.id LEFT JOIN roles r ON r.id = rp.role_id WHERE p.name LIKE 'ap.%' ORDER BY p.name"
  );
  assert.deepEqual(grants, permissions.map((name) => ({ name, role: null })));

  const [foreignKeys] = await db.query(
    "SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ap_invoice_lines' AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY REFERENCED_TABLE_NAME, ORDINAL_POSITION"
  );
  assert.deepEqual(foreignKeys.map((row) => Object.values(row)), [
    ["invoice_id", "ap_invoices", "id"],
    ["goods_receipt_line_id", "goods_receipt_lines", "id"],
    ["goods_receipt_id", "goods_receipt_lines", "goods_receipt_id"],
    ["goods_receipt_id", "goods_receipts", "id"]
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
