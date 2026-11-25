import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

const load = () => import("../../src/modules/accounts-payable/ApSupplierReferenceCheckers.js");
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

test("Supplier AP reference checks lock payments before invoices and propagate database errors", async () => {
  const { apSupplierReferenceChecker, openApSupplierInvoiceChecker } = await load();
  const tables = [];
  const connection = {
    async query(sql, args) {
      tables.push(sql.match(/FROM (\w+)/u)[1]);
      assert.deepEqual(args, ["23"]);
      assert.match(sql, /FOR SHARE$/u);
      return [[{ reference_count: String(tables.length) }]];
    }
  };
  assert.equal(apSupplierReferenceChecker.name, "應付文件");
  assert.equal(await apSupplierReferenceChecker.count(connection, "23"), 10);
  assert.deepEqual(tables, ["ap_payments", "ap_credit_notes", "ap_invoices", "ap_supplier_refunds"]);
  const failure = new Error("lock timeout");
  const locked = { async query() { throw failure; } };
  for (const checker of [apSupplierReferenceChecker, openApSupplierInvoiceChecker]) {
    await assert.rejects(checker.count(locked, "23"), (error) => error === failure);
  }
});

integrationTest("Supplier AP checks see current references and only open confirmed invoices block archive", async (t) => {
  const { apSupplierReferenceChecker, openApSupplierInvoiceChecker } = await load();
  const config = {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  };
  const reader = await mysql.createConnection(config);
  t.after(() => reader.end());
  const writer = await mysql.createConnection(config);
  t.after(() => writer.end());
  const supplier = "9000000000000000100";
  const otherSupplier = "9000000000000000101";
  await writer.query("SET SESSION FOREIGN_KEY_CHECKS = 0");
  await reader.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await reader.beginTransaction();
  try {
    const [[before]] = await reader.query("SELECT COUNT(*) AS total FROM ap_invoices WHERE supplier_id = ?", [supplier]);
    assert.equal(before.total, 0);
    await writer.query(`
      INSERT INTO ap_invoices (supplier_id, status, outstanding_amount, allocated_amount, total_amount,
        supplier_code_snapshot, supplier_name_snapshot, currency_code, currency_decimal_places, supplier_invoice_number,
        invoice_date, due_date, created_by_label, created_at, updated_at)
      VALUES
        (?, 'CONFIRMED', 5, 0, 5, 'AP-A', 'AP A', 'ZZZ', 2, 'AP-CURRENT', '2026-11-24', '2026-11-24', 'test', 1, 1),
        (?, 'CONFIRMED', 0, 5, 5, 'AP-A', 'AP A', 'ZZZ', 2, 'AP-PAID', '2026-11-24', '2026-11-24', 'test', 1, 1),
        (?, 'DRAFT', 5, 0, 5, 'AP-A', 'AP A', 'ZZZ', 2, 'AP-DRAFT', '2026-11-24', '2026-11-24', 'test', 1, 1),
        (?, 'VOID', 5, 0, 5, 'AP-A', 'AP A', 'ZZZ', 2, 'AP-VOID', '2026-11-24', '2026-11-24', 'test', 1, 1),
        (?, 'CONFIRMED', 5, 0, 5, 'AP-B', 'AP B', 'ZZZ', 2, 'AP-OTHER', '2026-11-24', '2026-11-24', 'test', 1, 1)
    `, [supplier, supplier, supplier, supplier, otherSupplier]);
    await writer.query(`
      INSERT INTO ap_payments (supplier_id, status, amount, allocated_amount, available_amount, supplier_code_snapshot,
        supplier_name_snapshot, currency_code, currency_decimal_places, payment_date, payment_method, created_by_label, created_at, updated_at)
      VALUES (?, 'VOID', 5, 0, 0, 'AP-A', 'AP A', 'ZZZ', 2, '2026-11-24', 'OTHER', 'test', 1, 1)
    `, [supplier]);
    const [credit] = await writer.execute(`
      INSERT INTO ap_credit_notes (invoice_id, supplier_id, supplier_code_snapshot, supplier_name_snapshot, currency_code,
        currency_decimal_places, credit_date, reason, total_amount, available_amount, created_by_label, created_at, updated_at)
      SELECT id, supplier_id, supplier_code_snapshot, supplier_name_snapshot, currency_code, currency_decimal_places,
        invoice_date, 'Test', 2, 2, 'test', 1, 1 FROM ap_invoices WHERE supplier_id = ? AND supplier_invoice_number = 'AP-PAID'
    `, [supplier]);
    await writer.execute(`
      INSERT INTO ap_supplier_refunds (credit_note_id, supplier_id, currency_code, refund_date, amount,
        payment_method, created_by_label, created_at, updated_at)
      VALUES (?, ?, 'ZZZ', '2026-11-24', 1, 'OTHER', 'test', 1, 1)
    `, [credit.insertId, supplier]);

    assert.equal(openApSupplierInvoiceChecker.name, "未付應付發票");
    assert.equal(await openApSupplierInvoiceChecker.count(reader, supplier), 1);
    assert.equal(await apSupplierReferenceChecker.count(reader, supplier), 7);
    assert.equal(await apSupplierReferenceChecker.count(reader, "9000000000000000102"), 0);
  } finally {
    await reader.rollback();
    await writer.query("DELETE FROM ap_supplier_refunds WHERE supplier_id = ?", [supplier]);
    await writer.query("DELETE FROM ap_credit_notes WHERE supplier_id = ?", [supplier]);
    await writer.query("DELETE FROM ap_payments WHERE supplier_id = ?", [supplier]);
    await writer.query("DELETE FROM ap_invoices WHERE supplier_id IN (?, ?)", [supplier, otherSupplier]);
  }
});
