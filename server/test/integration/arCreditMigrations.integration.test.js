import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const tables = ["ar_credit_notes", "ar_credit_note_lines", "ar_credit_applications", "ar_refunds"];
const permissions = ["ar.credit.mgmt", "ar.refund.mgmt"];

async function connect(t) {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), socketPath: process.env.DB_SOCKET_PATH,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });
  t.after(() => db.end());
  return db;
}

integrationTest("0134 and 0135 rerun and preserve the approved AR credit and refund schema", async (t) => {
  const db = await connect(t);
  const [applied] = await db.query("SELECT name FROM fr_schema_migrations WHERE name REGEXP 'migrations/013[345]_'");
  assert.deepEqual(applied.map(({ name }) => name).sort(), [
    "migrations/0133_create_returns_tables.js",
    "migrations/0134_seed_ar_credit_permissions.js",
    "migrations/0135_create_ar_credit_tables.js"
  ]);

  const { up: seedPermissions } = await import("../../database/migrations/0134_seed_ar_credit_permissions.js");
  const { up: createTables } = await import("../../database/migrations/0135_create_ar_credit_tables.js");
  await seedPermissions(db);
  await createTables(db);

  const [seeded] = await db.query(`
    SELECT p.name, r.name AS roleName FROM permissions p
    LEFT JOIN role_permissions rp ON rp.permission_id = p.id
    LEFT JOIN roles r ON r.id = rp.role_id
    WHERE p.name IN (?) ORDER BY p.name`, [permissions]);
  assert.deepEqual(seeded, permissions.map((name) => ({ name, roleName: "system-admin" })));

  const [columns] = await db.query(`
    SELECT TABLE_NAME AS name, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS columns
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) GROUP BY TABLE_NAME`, [tables]);
  assert.deepEqual(Object.fromEntries(columns.map((row) => [row.name, row.columns])), {
    ar_credit_notes: "id,credit_note_number,status,invoice_id,customer_id,customer_code_snapshot,customer_name_snapshot,currency_code," +
      "currency_decimal_places,credit_date,reason,customer_return_id,total_amount,applied_amount,refunded_amount,available_amount,notes," +
      "void_reason,version,created_by,created_by_label,confirmed_by,confirmed_by_label,confirmed_at,voided_by,voided_by_label,voided_at,created_at,updated_at",
    ar_credit_note_lines: "id,credit_note_id,invoice_id,line_no,invoice_line_id,customer_return_line_id,base_quantity,amount,description",
    ar_credit_applications: "id,credit_note_id,invoice_id,is_origin,amount,status,created_by,created_by_label,created_at,unapplied_by,unapplied_by_label,unapplied_at",
    ar_refunds: "id,refund_number,status,credit_note_id,customer_id,currency_code,refund_date,amount,payment_method,reference,notes,void_reason," +
      "version,created_by,confirmed_by,voided_by,created_by_label,confirmed_by_label,voided_by_label,confirmed_at,voided_at,created_at,updated_at"
  });

  const [indexes] = await db.query(`
    SELECT CONCAT(TABLE_NAME, ':', CASE INDEX_NAME WHEN 'PRIMARY' THEN 'PRIMARY' ELSE IF(NON_UNIQUE, 'KEY', 'UNIQUE') END, ':',
      GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)) AS signature
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) AND INDEX_NAME NOT LIKE 'fk=_ar=_%' ESCAPE '='
    GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE`, [tables]);
  assert.deepEqual(indexes.map((row) => row.signature).sort(), [
    "ar_credit_applications:KEY:credit_note_id,status,id",
    "ar_credit_applications:KEY:invoice_id,status,id",
    "ar_credit_applications:PRIMARY:id",
    "ar_credit_note_lines:KEY:invoice_line_id,id",
    "ar_credit_note_lines:PRIMARY:id",
    "ar_credit_note_lines:UNIQUE:credit_note_id,line_no",
    "ar_credit_notes:KEY:customer_id,currency_code,status,credit_date,id",
    "ar_credit_notes:KEY:invoice_id,status,id",
    "ar_credit_notes:PRIMARY:id",
    "ar_credit_notes:UNIQUE:credit_note_number",
    "ar_credit_notes:UNIQUE:id,invoice_id",
    "ar_refunds:KEY:credit_note_id,status,id",
    "ar_refunds:KEY:customer_id,refund_date,id",
    "ar_refunds:PRIMARY:id",
    "ar_refunds:UNIQUE:refund_number"
  ].sort());

  const [references] = await db.query(`
    SELECT CONCAT(kcu.TABLE_NAME, ':', GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION),
      '->', kcu.REFERENCED_TABLE_NAME, ':', GROUP_CONCAT(kcu.REFERENCED_COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION),
      ':', rc.DELETE_RULE) AS binding
    FROM information_schema.KEY_COLUMN_USAGE AS kcu
    JOIN information_schema.REFERENTIAL_CONSTRAINTS AS rc
      ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
    WHERE kcu.TABLE_SCHEMA = DATABASE() AND kcu.TABLE_NAME IN (?)
    GROUP BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.REFERENCED_TABLE_NAME, rc.DELETE_RULE`, [tables]);
  assert.deepEqual(references.map((row) => row.binding).sort(), [
    "ar_credit_applications:created_by->users:id:SET NULL",
    "ar_credit_applications:credit_note_id->ar_credit_notes:id:RESTRICT",
    "ar_credit_applications:invoice_id->ar_invoices:id:RESTRICT",
    "ar_credit_applications:unapplied_by->users:id:SET NULL",
    "ar_credit_note_lines:credit_note_id,invoice_id->ar_credit_notes:id,invoice_id:RESTRICT",
    "ar_credit_note_lines:customer_return_line_id->customer_return_lines:id:RESTRICT",
    "ar_credit_note_lines:invoice_line_id->ar_invoice_lines:id:RESTRICT",
    "ar_credit_notes:confirmed_by->users:id:SET NULL",
    "ar_credit_notes:created_by->users:id:SET NULL",
    "ar_credit_notes:currency_code->currencies:code:RESTRICT",
    "ar_credit_notes:customer_id->customers:id:RESTRICT",
    "ar_credit_notes:customer_return_id->customer_returns:id:RESTRICT",
    "ar_credit_notes:invoice_id->ar_invoices:id:RESTRICT",
    "ar_credit_notes:voided_by->users:id:SET NULL",
    "ar_refunds:confirmed_by->users:id:SET NULL",
    "ar_refunds:created_by->users:id:SET NULL",
    "ar_refunds:credit_note_id->ar_credit_notes:id:RESTRICT",
    "ar_refunds:currency_code->currencies:code:RESTRICT",
    "ar_refunds:customer_id->customers:id:RESTRICT",
    "ar_refunds:voided_by->users:id:SET NULL"
  ].sort());

  const [checks] = await db.query(`
    SELECT CONSTRAINT_NAME AS name, ENFORCED AS enforced FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) AND CONSTRAINT_TYPE = 'CHECK' ORDER BY CONSTRAINT_NAME`, [tables]);
  assert.deepEqual(checks, [
    "chk_ar_credit_application_amount", "chk_ar_credit_application_origin", "chk_ar_credit_application_status",
    "chk_ar_credit_note_amounts", "chk_ar_credit_note_line_amount", "chk_ar_credit_note_line_quantity",
    "chk_ar_credit_note_status", "chk_ar_credit_note_total", "chk_ar_refund_amount", "chk_ar_refund_method", "chk_ar_refund_status"
  ].map((name) => ({ name, enforced: "YES" })));

  const [triggers] = await db.query(`
    SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE IN (?)`, [tables]);
  assert.deepEqual(triggers, []);
});

integrationTest("0135 enforces credit balances, positive lines and applications, refund methods and case-sensitive document kinds", async (t) => {
  const db = await connect(t);
  // FK definitions are verified separately. These synthetic rows probe the CHECKs in a single transaction.
  await db.query("SET FOREIGN_KEY_CHECKS = 0");
  await db.beginTransaction();
  try {
    const now = Date.now();
    const invoiceId = 1;
    const document = { customer_id: 1, currency_code: "HKD", created_by_label: "probe", created_at: now, updated_at: now };
    const note = {
      ...document, invoice_id: invoiceId, customer_code_snapshot: "C-1", customer_name_snapshot: "Probe",
      currency_decimal_places: 2, credit_date: "2099-01-01", reason: "Probe", total_amount: "10.0000", available_amount: "10.0000"
    };
    const check = { code: "ER_CHECK_CONSTRAINT_VIOLATED" };
    await assert.rejects(db.query("INSERT INTO ar_credit_notes SET ?", [{ ...note, refunded_amount: "-1.0000", available_amount: "11.0000" }]), check);
    await assert.rejects(db.query("INSERT INTO ar_credit_notes SET ?", [{ ...note, available_amount: "9.0000" }]), check);
    const [{ insertId: noteId }] = await db.query("INSERT INTO ar_credit_notes SET ?", [note]);

    const line = { credit_note_id: noteId, invoice_id: invoiceId, line_no: 1, invoice_line_id: null, amount: "10.0000" };
    await assert.rejects(db.query("INSERT INTO ar_credit_note_lines SET ?", [{ ...line, base_quantity: 0 }]), check);
    await assert.rejects(db.query("INSERT INTO ar_credit_note_lines SET ?", [{ ...line, amount: "0.0000" }]), check);
    await db.query("INSERT INTO ar_credit_note_lines SET ?", [line]);

    const application = { credit_note_id: noteId, invoice_id: invoiceId, is_origin: 1, amount: "3.0000", created_by_label: "probe", created_at: now };
    await assert.rejects(db.query("INSERT INTO ar_credit_applications SET ?", [{ ...application, is_origin: 2 }]), check);
    await assert.rejects(db.query("INSERT INTO ar_credit_applications SET ?", [{ ...application, status: "VOID" }]), check);
    await assert.rejects(db.query("INSERT INTO ar_credit_applications SET ?", [{ ...application, amount: "0.0000" }]), check);
    await db.query("INSERT INTO ar_credit_applications SET ?", [application]);

    const refund = { ...document, credit_note_id: noteId, refund_date: "2099-01-01", amount: "2.0000", payment_method: "BANK_TRANSFER" };
    await assert.rejects(db.query("INSERT INTO ar_refunds SET ?", [{ ...refund, payment_method: "bank_transfer" }]), check);
    await assert.rejects(db.query("INSERT INTO ar_refunds SET ?", [{ ...refund, status: "POSTED" }]), check);
    await assert.rejects(db.query("INSERT INTO ar_refunds SET ?", [{ ...refund, amount: "0.0000" }]), check);
    await db.query("INSERT INTO ar_refunds SET ?", [refund]);

    await db.query("UPDATE ar_credit_notes SET status = 'CONFIRMED', applied_amount = 3, refunded_amount = 2, available_amount = 5 WHERE id = ?", [noteId]);
    await assert.rejects(db.query("UPDATE ar_credit_notes SET status = 'VOID' WHERE id = ?", [noteId]), check);
    await db.query("UPDATE ar_credit_notes SET status = 'VOID', applied_amount = 0, refunded_amount = 0, available_amount = 0 WHERE id = ?", [noteId]);
    const [[voidNote]] = await db.query("SELECT total_amount FROM ar_credit_notes WHERE id = ?", [noteId]);
    assert.equal(voidNote.total_amount, "10.0000");

    for (const type of ["CREDIT_NOTE", "REFUND"]) {
      await db.query("INSERT INTO ar_document_sequences (document_type, business_year, updated_at) VALUES (?, 2099, ?)", [type, now]);
    }
    await assert.rejects(db.query("INSERT INTO ar_document_sequences (document_type, business_year, updated_at) VALUES ('credit_note', 2099, ?)", [now]), check);
    for (const target of ["CREDIT_NOTE", "CREDIT_APPLICATION", "REFUND"]) {
      await db.query("INSERT INTO ar_audit_logs (occurred_at, actor_label, action, outcome, target_type) VALUES (?, 'probe', 'probe', 'SUCCEEDED', ?)", [now, target]);
    }
    await assert.rejects(db.query("INSERT INTO ar_audit_logs (occurred_at, actor_label, action, outcome, target_type) VALUES (?, 'probe', 'probe', 'SUCCEEDED', 'refund')", [now]), check);
  } finally {
    await db.rollback();
  }
});
