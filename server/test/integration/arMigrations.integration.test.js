/**
 * 開票與應收：在真 MySQL 核對首期七張表、發票行兩欄，以及 0126 的期初欄位、唯一鍵及權限。
 * 表結構正本是 TL 的 TABLES.md（sha256 2ffa6b0b…8aca）及 TABLES-ADDENDUM-1.md（45f24a54…bcd9），均經 Sam 2026-11-19 批准；這裡把欄位、鍵、外鍵及 CHECK 的名單釘住，
 * 任何增減都會紅。
 * 期初兩欄、唯一鍵及權限依 TL 的 OPENING-AR-SCOPE.md r3（a3dbcaea…72ff）及 DECISIONS.md（949296ef…0275）。
 * 0127 的帳單地址快照依 BILLING-SNAPSHOT.md r3（024e4ec0…39cb），Sam 2026-11-23 批准。
 *
 * 資料：每個約束案例在自己的 transaction 內寫最多 3 列，完結即 ROLLBACK；該連線關掉外鍵檢查，所以不需要客戶、
 * 出貨或訂單 fixture（外鍵本身由 information_schema 驗證）。1 條連線，無並發，每案 1 次。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import mysql from "mysql2/promise";

import { up as seedPermissions } from "../../database/migrations/0122_seed_ar_permissions.js";
import { up as createTables } from "../../database/migrations/0123_create_ar_tables.js";
import { up as addInvoiceLineSalesUom } from "../../database/migrations/0124_add_ar_invoice_line_sales_uom.js";
import { up as addOpeningInvoices } from "../../database/migrations/0126_add_ar_opening_invoices.js";
import { up as addBillingSnapshot } from "../../database/migrations/0127_add_ar_invoice_billing_snapshot.js";
import { ArBusinessMasterImpactChecker } from "../../src/modules/ar/ArBusinessMasterImpactChecker.js";
import { PERMISSION_CATALOGUE } from "../../src/modules/authorization/permissionCatalogue.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const FIRST_PHASE_PERMISSIONS = ["ar.view", "ar.invoice.mgmt", "ar.receipt.mgmt"];
const PERMISSIONS = [...FIRST_PHASE_PERMISSIONS, "ar.opening.mgmt"];

const PARTY = ["customer_id", "customer_code_snapshot", "customer_name_snapshot", "currency_code", "currency_decimal_places"];
const COLUMNS = {
  ar_document_sequences: ["document_type", "business_year", "next_value", "updated_at"],
  ar_operation_requests: ["id", "event_id", "command_type", "target_type", "target_id", "request_hash", "actor_user_id", "actor_label",
    "result_summary", "created_at", "completed_at"],
  ar_invoices: ["id", "invoice_number", "status", ...PARTY, "invoice_date", "due_date", "payment_term_code_snapshot", "payment_term_name_snapshot",
    "due_date_overridden", "due_date_reason", "total_amount", "allocated_amount", "outstanding_amount", "notes", "void_reason", "version",
    "created_by", "created_by_label", "confirmed_by", "confirmed_by_label", "confirmed_at", "voided_by", "voided_by_label", "voided_at",
    "created_at", "updated_at", "opening_reference", "active_opening_reference", "billing_address_snapshot"],
  ar_invoice_lines: ["id", "invoice_id", "line_no", "shipment_id", "shipment_line_id", "sales_order_id", "sales_order_line_id",
    "active_shipment_line_id", "sku_code_snapshot", "sku_name_snapshot", "base_uom_code_snapshot",
    "sales_uom_code_snapshot", "to_base_factor_snapshot", // 這兩欄由 0124 加上（TABLES-ADDENDUM-1，Sam 2026-11-19「批准加兩欄」）。
    "quantity", "unit_price_snapshot", "line_amount"],
  ar_receipts: ["id", "receipt_number", "status", ...PARTY, "receipt_date", "amount", "allocated_amount", "available_amount", "payment_method",
    "reference", "notes", "void_reason", "voided_by", "voided_by_label", "voided_at", "version", "created_by", "created_by_label",
    "confirmed_by", "confirmed_by_label", "confirmed_at", "created_at", "updated_at"],
  ar_receipt_allocations: ["id", "receipt_id", "invoice_id", "amount", "status", "created_by", "created_by_label", "created_at",
    "unapplied_by", "unapplied_by_label", "unapplied_at"],
  ar_audit_logs: ["id", "occurred_at", "actor_user_id", "actor_label", "action", "outcome", "target_type", "target_id", "customer_id",
    "target_label", "reason", "detail", "request_id", "correlation_id", "ip"]
};
// 索引名 → [是否唯一, 欄位]。
const INDEXES = {
  ar_document_sequences: { PRIMARY: [true, "document_type,business_year"] },
  ar_operation_requests: { PRIMARY: [true, "id"], uq_ar_operation_event: [true, "event_id"], idx_ar_operation_target: [false, "target_type,target_id,id"],
    fk_ar_operation_actor: [false, "actor_user_id"] },
  ar_invoices: { PRIMARY: [true, "id"], uq_ar_invoice_number: [true, "invoice_number"],
    uq_ar_invoice_active_opening_reference: [true, "active_opening_reference"],
    idx_ar_invoice_customer: [false, "customer_id,currency_code,status,due_date,id"], idx_ar_invoice_list: [false, "status,invoice_date,id"],
    fk_ar_invoice_currency: [false, "currency_code"], fk_ar_invoice_created_by: [false, "created_by"],
    fk_ar_invoice_confirmed_by: [false, "confirmed_by"], fk_ar_invoice_voided_by: [false, "voided_by"] },
  ar_invoice_lines: { PRIMARY: [true, "id"], uq_ar_invoice_line_active_shipment_line: [true, "active_shipment_line_id"],
    uq_ar_invoice_line_no: [true, "invoice_id,line_no"], idx_ar_invoice_line_order_line: [false, "sales_order_line_id,id"],
    idx_ar_invoice_line_shipment: [false, "shipment_id,id"], fk_ar_invoice_line_shipment_line: [false, "shipment_line_id"],
    fk_ar_invoice_line_order: [false, "sales_order_id"] },
  ar_receipts: { PRIMARY: [true, "id"], uq_ar_receipt_number: [true, "receipt_number"],
    idx_ar_receipt_customer: [false, "customer_id,currency_code,status,receipt_date,id"], fk_ar_receipt_currency: [false, "currency_code"],
    fk_ar_receipt_voided_by: [false, "voided_by"], fk_ar_receipt_created_by: [false, "created_by"], fk_ar_receipt_confirmed_by: [false, "confirmed_by"] },
  ar_receipt_allocations: { PRIMARY: [true, "id"], idx_ar_allocation_receipt: [false, "receipt_id,status,id"],
    idx_ar_allocation_invoice: [false, "invoice_id,status,id"], fk_ar_allocation_created_by: [false, "created_by"],
    fk_ar_allocation_unapplied_by: [false, "unapplied_by"] },
  ar_audit_logs: { PRIMARY: [true, "id"], idx_ar_audit_time: [false, "occurred_at,id"], idx_ar_audit_customer: [false, "customer_id,occurred_at,id"],
    idx_ar_audit_actor: [false, "actor_user_id,occurred_at,id"] }
};
// 外鍵名 → [被引用的表, 刪除規則]。
const FOREIGN_KEYS = {
  fk_ar_operation_actor: ["users", "SET NULL"],
  fk_ar_invoice_customer: ["customers", "RESTRICT"], fk_ar_invoice_currency: ["currencies", "RESTRICT"],
  fk_ar_invoice_created_by: ["users", "SET NULL"], fk_ar_invoice_confirmed_by: ["users", "SET NULL"], fk_ar_invoice_voided_by: ["users", "SET NULL"],
  fk_ar_invoice_line_invoice: ["ar_invoices", "RESTRICT"], fk_ar_invoice_line_shipment: ["shipments", "RESTRICT"],
  fk_ar_invoice_line_shipment_line: ["shipment_lines", "RESTRICT"], fk_ar_invoice_line_order: ["sales_orders", "RESTRICT"],
  fk_ar_invoice_line_order_line: ["sales_order_lines", "RESTRICT"],
  fk_ar_receipt_customer: ["customers", "RESTRICT"], fk_ar_receipt_currency: ["currencies", "RESTRICT"],
  fk_ar_receipt_voided_by: ["users", "SET NULL"], fk_ar_receipt_created_by: ["users", "SET NULL"], fk_ar_receipt_confirmed_by: ["users", "SET NULL"],
  fk_ar_allocation_receipt: ["ar_receipts", "RESTRICT"], fk_ar_allocation_invoice: ["ar_invoices", "RESTRICT"],
  fk_ar_allocation_created_by: ["users", "SET NULL"], fk_ar_allocation_unapplied_by: ["users", "SET NULL"],
  fk_ar_audit_actor: ["users", "SET NULL"]
};
const CHECKS = ["chk_ar_allocation_amount", "chk_ar_allocation_status", "chk_ar_audit_detail", "chk_ar_audit_outcome", "chk_ar_audit_target",
  "chk_ar_invoice_amounts", "chk_ar_invoice_due_date", "chk_ar_invoice_line_values", "chk_ar_invoice_status", "chk_ar_receipt_amount",
  "chk_ar_receipt_amounts", "chk_ar_receipt_method", "chk_ar_receipt_status", "chk_ar_sequence_type"];

async function connect(t) {
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  t.after(() => db.end());
  return db;
}

/** 約束案例：關掉這條連線的外鍵檢查，在 transaction 內做完即 ROLLBACK。 */
async function probe(t, work) {
  const db = await connect(t);
  await db.query("SET FOREIGN_KEY_CHECKS = 0");
  await db.query("START TRANSACTION");
  const insert = async (table, row) => Number((await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
  try { await work(db, insert); } finally { await db.query("ROLLBACK"); }
}

/** 斷言 DB 錯誤碼；CHECK 另對約束名，證明擋住的是預期那一條。 */
async function rejects(promise, code, constraint) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `${error.code}: ${error.message}`);
    if (constraint) assert.match(error.message, new RegExp(`'${constraint}'`, "u"));
    return true;
  });
}
const CHECK = "ER_CHECK_CONSTRAINT_VIOLATED", DUPLICATE = "ER_DUP_ENTRY";

const now = Date.now();
const party = { customer_id: 1, customer_code_snapshot: "C-1", customer_name_snapshot: "Probe", currency_code: "HKD", currency_decimal_places: 2 };
const invoice = (extra = {}) => ({ ...party, invoice_date: "2099-01-10", due_date: "2099-02-09", total_amount: "100.0000",
  outstanding_amount: "100.0000", created_by_label: "probe", created_at: now, updated_at: now, ...extra });
const receipt = (extra = {}) => ({ ...party, receipt_date: "2099-01-10", amount: "100.0000", available_amount: "100.0000",
  payment_method: "BANK_TRANSFER", created_by_label: "probe", created_at: now, updated_at: now, ...extra });
const line = (extra = {}) => ({ invoice_id: 1, line_no: 1, shipment_id: 1, shipment_line_id: 7, sales_order_id: 1, sales_order_line_id: 1,
  active_shipment_line_id: 7, sku_code_snapshot: "SKU", sku_name_snapshot: "Probe", base_uom_code_snapshot: "EA", quantity: 1,
  unit_price_snapshot: "1.0000", line_amount: "1.0000", ...extra });
const audit = (extra = {}) => ({ occurred_at: now, actor_label: "probe", action: "invoice.confirmed", outcome: "SUCCEEDED",
  target_type: "INVOICE", target_id: 1, ...extra });

test("0122 lists exactly the three AR permissions with the catalogue descriptions and grants no role", async () => {
  const source = await readFile(new URL("../../database/migrations/0122_seed_ar_permissions.js", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/name:\s*"([a-z.]+)"/gu)].map((match) => match[1]), FIRST_PHASE_PERMISSIONS);
  for (const name of FIRST_PHASE_PERMISSIONS) assert.ok(source.includes(PERMISSION_CATALOGUE.find((entry) => entry.name === name).description), name);
  assert.doesNotMatch(source, /role_permissions/iu);
});

integrationTest("AR migrations rerun: permissions and the seven AR tables match the approved schema", async (t) => {
  const db = await connect(t);
  await seedPermissions(db);
  await createTables(db);
  await addInvoiceLineSalesUom(db);
  await addOpeningInvoices(db);
  await addBillingSnapshot(db);
  await addBillingSnapshot(db);
  const [[billing]] = await db.query(`SELECT column_type AS type, is_nullable AS nullable, column_default AS fallback FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'ar_invoices' AND column_name = 'billing_address_snapshot'`);
  assert.deepEqual([billing.type, billing.nullable, billing.fallback], ["varchar(1200)", "NO", ""]);

  const [permissions] = await db.query("SELECT name, description FROM permissions WHERE name LIKE 'ar.%' ORDER BY id");
  assert.deepEqual(permissions.map((row) => row.name), PERMISSIONS);
  for (const row of permissions) assert.equal(row.description, PERMISSION_CATALOGUE.find((entry) => entry.name === row.name).description);

  const [columns] = await db.query(`SELECT table_name AS t, column_name AS c FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name LIKE 'ar\\_%' ORDER BY table_name, ordinal_position`);
  const found = Object.groupBy(columns, (row) => row.t);
  assert.deepEqual(Object.keys(found).sort(), Object.keys(COLUMNS).sort());
  for (const [table, expected] of Object.entries(COLUMNS)) assert.deepEqual(found[table].map((row) => row.c), expected, table);

  const [openingColumns] = await db.query(`SELECT column_type AS type, is_nullable AS nullable, column_default AS fallback
    FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'ar_invoices'
      AND column_name IN ('opening_reference', 'active_opening_reference') ORDER BY ordinal_position`);
  assert.deepEqual(openingColumns, Array.from({ length: 2 }, () => ({ type: "varchar(50)", nullable: "YES", fallback: null })));
  const [grants] = await db.query(`SELECT r.name FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id WHERE p.name = 'ar.opening.mgmt' AND r.name = 'system-admin'`);
  assert.deepEqual(grants.map(({ name }) => name), ["system-admin"]);
});

integrationTest("the AR schema retains exactly the approved keys, foreign keys, CHECK constraints and audit triggers", async (t) => {
  const db = await connect(t);
  const [statistics] = await db.query(`SELECT table_name AS t, index_name AS i, MAX(non_unique) AS n,
      GROUP_CONCAT(column_name ORDER BY seq_in_index) AS c
    FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name LIKE 'ar\\_%' GROUP BY table_name, index_name`);
  const indexes = {};
  for (const row of statistics) (indexes[row.t] ??= {})[row.i] = [Number(row.n) === 0, row.c];
  assert.deepEqual(indexes, INDEXES);

  const [references] = await db.query(`SELECT constraint_name AS name, referenced_table_name AS target, delete_rule AS rule
    FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name LIKE 'ar\\_%'`);
  assert.deepEqual(Object.fromEntries(references.map((row) => [row.name, [row.target, row.rule]])), FOREIGN_KEYS);

  const [checks] = await db.query(`SELECT constraint_name AS name FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE() AND table_name LIKE 'ar\\_%' AND constraint_type = 'CHECK' ORDER BY constraint_name`);
  assert.deepEqual(checks.map((row) => row.name), CHECKS);

  const [triggers] = await db.query(`SELECT trigger_name AS name, event_object_table AS t FROM information_schema.triggers
    WHERE trigger_schema = DATABASE() AND event_object_table LIKE 'ar\\_%' ORDER BY trigger_name`);
  assert.deepEqual(triggers.map((row) => [row.name, row.t]), [["trg_ar_audit_delete", "ar_audit_logs"], ["trg_ar_audit_update", "ar_audit_logs"]]);
});

integrationTest("sequence and operation tables: one row per type and year, known types only, one effect per event_id", (t) => probe(t, async (db, insert) => {
  await insert("ar_document_sequences", { document_type: "INVOICE", business_year: 2099, updated_at: now });
  await insert("ar_document_sequences", { document_type: "RECEIPT", business_year: 2099, updated_at: now });
  await rejects(insert("ar_document_sequences", { document_type: "INVOICE", business_year: 2099, updated_at: now }), DUPLICATE);
  await rejects(insert("ar_document_sequences", { document_type: "invoice", business_year: 2098, updated_at: now }), CHECK, "chk_ar_sequence_type");

  const operation = { event_id: randomUUID(), command_type: "CONFIRM_INVOICE", target_type: "INVOICE", request_hash: "0".repeat(64), actor_label: "probe", created_at: now };
  await insert("ar_operation_requests", operation);
  await rejects(insert("ar_operation_requests", { ...operation, command_type: "VOID_INVOICE", target_id: 9 }), DUPLICATE);
}));

integrationTest("invoices: statuses, non-negative amounts, outstanding = total − allocated, due date not before invoice date, unique numbers", (t) => probe(t, async (db, insert) => {
  const first = await insert("ar_invoices", invoice());
  await insert("ar_invoices", invoice()); // 兩張 Draft 的號碼都是 NULL，不互相衝突。
  await db.query("UPDATE ar_invoices SET invoice_number = 'INV-2099-000001', status = 'CONFIRMED' WHERE id = ?", [first]);
  await rejects(insert("ar_invoices", invoice({ invoice_number: "INV-2099-000001" })), DUPLICATE);
  await db.query("UPDATE ar_invoices SET allocated_amount = '40.0000', outstanding_amount = '60.0000' WHERE id = ?", [first]);

  await rejects(insert("ar_invoices", invoice({ status: "PAID" })), CHECK, "chk_ar_invoice_status");
  await rejects(insert("ar_invoices", invoice({ outstanding_amount: "99.9999" })), CHECK, "chk_ar_invoice_amounts");
  await rejects(insert("ar_invoices", invoice({ total_amount: "-1.0000", outstanding_amount: "-1.0000" })), CHECK, "chk_ar_invoice_amounts");
  await rejects(insert("ar_invoices", invoice({ allocated_amount: "100.0001", outstanding_amount: "-0.0001" })), CHECK, "chk_ar_invoice_amounts");
  await rejects(insert("ar_invoices", invoice({ due_date: "2099-01-09" })), CHECK, "chk_ar_invoice_due_date");
  await insert("ar_invoices", invoice({ due_date: "2099-01-10" }));
}));

integrationTest("invoice lines: a shipment line sits on one active invoice at a time and is free again once released", (t) => probe(t, async (db, insert) => {
  const first = await insert("ar_invoice_lines", line());
  await rejects(insert("ar_invoice_lines", line({ invoice_id: 2 })), DUPLICATE);
  // 作廢或取消時程式把 active_shipment_line_id 改為 NULL；同一出貨行即可上另一張發票。
  await db.query("UPDATE ar_invoice_lines SET active_shipment_line_id = NULL WHERE id = ?", [first]);
  await insert("ar_invoice_lines", line({ invoice_id: 2 }));
  await insert("ar_invoice_lines", line({ invoice_id: 3, active_shipment_line_id: null })); // 多行已釋放的 NULL 不互相衝突。

  await rejects(insert("ar_invoice_lines", line({ invoice_id: 2, shipment_line_id: 8, active_shipment_line_id: 8 })), DUPLICATE); // (invoice_id, line_no)
  await rejects(insert("ar_invoice_lines", line({ invoice_id: 4, shipment_line_id: 9, active_shipment_line_id: 9, quantity: 0 })), CHECK, "chk_ar_invoice_line_values");
  await rejects(insert("ar_invoice_lines", line({ invoice_id: 4, shipment_line_id: 9, active_shipment_line_id: 9, line_amount: "-0.0001" })), CHECK, "chk_ar_invoice_line_values");

  // 0124 的兩欄：型別及預設值與 sales_order_lines 相同；不帶值的行得到空代碼及換算率 1。
  const [added] = await db.query(`SELECT column_name AS name, column_type AS type, is_nullable AS nullable, column_default AS fallback FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'ar_invoice_lines' AND column_name IN ('sales_uom_code_snapshot', 'to_base_factor_snapshot') ORDER BY ordinal_position`);
  assert.deepEqual(added.map((row) => [row.name, row.type, row.nullable, row.fallback]),
    [["sales_uom_code_snapshot", "varchar(100)", "NO", ""], ["to_base_factor_snapshot", "int unsigned", "NO", "1"]]);
  const [[plain]] = await db.query("SELECT sales_uom_code_snapshot AS code, to_base_factor_snapshot AS factor FROM ar_invoice_lines WHERE id = ?", [first]);
  assert.deepEqual([plain.code, Number(plain.factor)], ["", 1]);
  const boxed = await insert("ar_invoice_lines", line({ invoice_id: 5, shipment_line_id: 10, active_shipment_line_id: 10, sales_uom_code_snapshot: "BOX", to_base_factor_snapshot: 24 }));
  const [[stored]] = await db.query("SELECT sales_uom_code_snapshot AS code, to_base_factor_snapshot AS factor FROM ar_invoice_lines WHERE id = ?", [boxed]);
  assert.deepEqual([stored.code, Number(stored.factor)], ["BOX", 24]);
}));

integrationTest("receipts: amount relation holds by status, a void receipt keeps its amount with nothing allocated or available", (t) => probe(t, async (db, insert) => {
  const id = await insert("ar_receipts", receipt());
  await db.query("UPDATE ar_receipts SET status = 'CONFIRMED', receipt_number = 'RCT-2099-000001', allocated_amount = '30.0000', available_amount = '70.0000' WHERE id = ?", [id]);
  await rejects(insert("ar_receipts", receipt({ receipt_number: "RCT-2099-000001" })), DUPLICATE);
  await rejects(db.query("UPDATE ar_receipts SET available_amount = '70.0001' WHERE id = ?", [id]), CHECK, "chk_ar_receipt_amounts");
  // 仍有核銷或可用額時不可成為 VOID；兩者歸零後可以，而 amount 保留。
  await rejects(db.query("UPDATE ar_receipts SET status = 'VOID' WHERE id = ?", [id]), CHECK, "chk_ar_receipt_amounts");
  await rejects(db.query("UPDATE ar_receipts SET status = 'VOID', allocated_amount = 0, available_amount = '100.0000' WHERE id = ?", [id]), CHECK, "chk_ar_receipt_amounts");
  await db.query("UPDATE ar_receipts SET status = 'VOID', allocated_amount = 0, available_amount = 0, void_reason = 'probe' WHERE id = ?", [id]);
  const [[row]] = await db.query("SELECT amount, allocated_amount, available_amount FROM ar_receipts WHERE id = ?", [id]);
  assert.deepEqual([row.amount, row.allocated_amount, row.available_amount], ["100.0000", "0.0000", "0.0000"]);

  await rejects(insert("ar_receipts", receipt({ amount: "0.0000", available_amount: "0.0000" })), CHECK, "chk_ar_receipt_amount");
  await rejects(insert("ar_receipts", receipt({ status: "POSTED" })), CHECK, "chk_ar_receipt_status");
  await rejects(insert("ar_receipts", receipt({ payment_method: "CARD" })), CHECK, "chk_ar_receipt_method");
}));

integrationTest("allocations and audit: positive amounts, known statuses, bounded detail, and audit rows cannot be changed or removed", (t) => probe(t, async (db, insert) => {
  const allocation = { receipt_id: 1, invoice_id: 1, amount: "10.0000", created_by_label: "probe", created_at: now };
  const id = await insert("ar_receipt_allocations", allocation);
  await db.query("UPDATE ar_receipt_allocations SET status = 'UNAPPLIED', unapplied_by_label = 'probe', unapplied_at = ? WHERE id = ?", [now, id]);
  await rejects(insert("ar_receipt_allocations", { ...allocation, amount: "0.0000" }), CHECK, "chk_ar_allocation_amount");
  await rejects(insert("ar_receipt_allocations", { ...allocation, status: "VOID" }), CHECK, "chk_ar_allocation_status");

  const log = await insert("ar_audit_logs", audit({ customer_id: 1, detail: JSON.stringify({ version: 2 }) }));
  await rejects(db.query("UPDATE ar_audit_logs SET reason = 'changed' WHERE id = ?", [log]), "ER_SIGNAL_EXCEPTION");
  await rejects(db.query("DELETE FROM ar_audit_logs WHERE id = ?", [log]), "ER_SIGNAL_EXCEPTION");
  await rejects(insert("ar_audit_logs", audit({ outcome: "OK" })), CHECK, "chk_ar_audit_outcome");
  await rejects(insert("ar_audit_logs", audit({ target_type: "CREDIT_NOTE" })), CHECK, "chk_ar_audit_target");
  await rejects(insert("ar_audit_logs", audit({ detail: JSON.stringify({ text: "x".repeat(8192) }) })), CHECK, "chk_ar_audit_detail");
}));

integrationTest("Business Master impact: with the AR tables present the AR checker is ready and counts open and settled documents by currency", (t) => probe(t, async (db, insert) => {
  // ar_invoices 一存在，Business Master 預留的 checker 就不再回 NOT_INSTALLED；沒有真 checker 的話所有貨幣及付款條款的異動都會被擋。
  const checker = new ArBusinessMasterImpactChecker({ database: db }), counts = async (entityType, entityKey) => {
    const { status, openUseCount, historicalCount } = await checker.check({ entityType, entityKey });
    return [status, openUseCount, historicalCount];
  };
  const code = "QZX"; // 這個交易內才有的幣別代碼（外鍵檢查已關），完結即 ROLLBACK。
  assert.deepEqual(await counts("CURRENCY", code), ["READY", 0, 0]);
  const before = (await checker.check({ entityType: "CURRENCY", entityKey: code })).watermark;

  await insert("ar_invoices", invoice({ currency_code: code })); // 草稿：進行中
  await insert("ar_invoices", invoice({ currency_code: code, status: "CONFIRMED", invoice_number: "INV-2099-900001" })); // 未收：進行中
  await insert("ar_invoices", invoice({ currency_code: code, status: "CONFIRMED", invoice_number: "INV-2099-900002", allocated_amount: "100.0000", outstanding_amount: "0.0000" }));
  await insert("ar_invoices", invoice({ currency_code: code, status: "VOID", invoice_number: "INV-2099-900003" }));
  await insert("ar_invoices", invoice({ currency_code: code, status: "CANCELLED" }));
  await insert("ar_receipts", receipt({ currency_code: code })); // 草稿：進行中
  await insert("ar_receipts", receipt({ currency_code: code, status: "CONFIRMED", receipt_number: "RCT-2099-900001" })); // 仍可核銷：進行中
  await insert("ar_receipts", receipt({ currency_code: code, status: "CONFIRMED", receipt_number: "RCT-2099-900002", allocated_amount: "100.0000", available_amount: "0.0000" }));
  await insert("ar_receipts", receipt({ currency_code: code, status: "VOID", receipt_number: "RCT-2099-900003", available_amount: "0.0000" }));
  await insert("ar_invoices", invoice({ currency_code: "QZY" })); // 另一個幣別不計。

  assert.deepEqual(await counts("CURRENCY", code), ["READY", 4, 5]);
  assert.notEqual((await checker.check({ entityType: "CURRENCY", entityKey: code })).watermark, before);
  assert.deepEqual(await counts("CURRENCY", "QZY"), ["READY", 1, 0]);
  assert.deepEqual(await counts("PAYMENT_TERM", 1), ["READY", 0, 0]);
}));
