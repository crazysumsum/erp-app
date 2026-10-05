import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";
import { migrationFixture } from "../sales/phase1/fixtures.js";
import { up as historyUp } from "../../database/migrations/0075_create_sales_order_status_history.js";
import { up as auditUp } from "../../database/migrations/0076_create_sales_audit_logs.js";
import { up as conversionUp } from "../../database/migrations/0077_create_sales_quotation_conversions.js";
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

async function setup(t) {
  const f = await migrationFixture(t, ["sales_order_status_history", "sales_audit_logs", "sales_quotation_conversions"]);
  await historyUp(f.scoped); await auditUp(f.scoped); await conversionUp(f.scoped);
  const quoteId = await f.insert("sales_quotations", { quotation_number: `QT-${randomUUID().slice(0, 16)}`, status: "ISSUED", customer_id: f.customerId,
    customer_code_snapshot: "Synthetic", customer_name_snapshot: "Synthetic", currency_code: f.currency, quotation_date: "2026-10-05", valid_until: "2026-10-06",
    line_count: 1, total_amount: "0.0000", created_at: f.now, updated_at: f.now, last_business_updated_at: f.now });
  const orderId = await f.insert("sales_orders", { sales_order_number: `SO-${randomUUID().slice(0, 16)}`, status: "DRAFT", source_type: "MANUAL", customer_id: f.customerId,
    customer_code_snapshot: "Synthetic", customer_name_snapshot: "Synthetic", currency_code: f.currency, fulfillment_warehouse_id: f.warehouseId,
    warehouse_code_snapshot: "Synthetic", warehouse_name_snapshot: "Synthetic", order_date: "2026-10-05", line_count: 1,
    total_amount: "0.0000", created_at: f.now, updated_at: f.now, last_business_updated_at: f.now });
  return { ...f, quoteId, orderId };
}

integrationTest("TC-015 Conversion foundation enforces one-to-one/event uniqueness and immutable difference/routing", async t => {
  const f = await setup(t), table = f.names.sales_quotation_conversions;
  const row = { quotation_id: f.quoteId, sales_order_id: f.orderId, sales_order_number_snapshot: "SO-TEST", difference_summary: "{}", difference_hash: "a".repeat(64), event_id: randomUUID(), converted_at: f.now };
  await f.db.query(`INSERT INTO ${table} SET ?`, row);
  await assert.rejects(() => f.db.query(`INSERT INTO ${table} SET ?`, row), { code: "ER_DUP_ENTRY" });
  for (const change of ["difference_summary='[]'", "sales_order_id=sales_order_id+1", "event_id='00000000-0000-4000-8000-000000000000'",
    "sales_order_number_snapshot=CONCAT(sales_order_number_snapshot,' ')"])
    await assert.rejects(() => f.db.execute(`UPDATE ${table} SET ${change}`), { code: "ER_SIGNAL_EXCEPTION" });
  await f.db.execute(`UPDATE ${table} SET is_order_archived=1`);
  await assert.rejects(() => f.db.execute(`UPDATE ${table} SET is_order_archived=0`), { code: "ER_SIGNAL_EXCEPTION" });
  await assert.rejects(() => f.db.execute("DELETE FROM sales_quotations WHERE id=?", [f.quoteId]), { code: "ER_ROW_IS_REFERENCED_2" });
  await conversionUp(f.scoped);
});

integrationTest("Sales History/Audit are append-only with unique ownership and UTF-8 byte bounds", async t => {
  const f = await setup(t), history = f.names.sales_order_status_history, audit = f.names.sales_audit_logs;
  const event = randomUUID();
  const row = { sales_order_id: f.orderId, sequence_no: 1, to_status: "DRAFT", action: "CREATE", order_version_after: 1, event_id: event,
    actor_label: "Sales probe", occurred_at: f.now };
  await f.db.query(`INSERT INTO ${history} SET ?`, row);
  await assert.rejects(() => f.db.query(`INSERT INTO ${history} SET ?`, { ...row, sequence_no: 2 }), { code: "ER_DUP_ENTRY" });
  await assert.rejects(() => f.db.execute(`UPDATE ${history} SET reason='changed'`), { code: "ER_SIGNAL_EXCEPTION" });
  const auditRow = { occurred_at: f.now, actor_label: "Sales probe", action: "QUOTATION_CREATED", target_type: "QUOTATION", outcome: "SUCCESS", details: JSON.stringify({ version: 1 }), event_id: event };
  await f.db.query(`INSERT INTO ${audit} SET ?`, auditRow);
  await assert.rejects(() => f.db.execute(`UPDATE ${audit} SET details='{}'`), { code: "ER_SIGNAL_EXCEPTION" });
  await assert.rejects(() => f.db.query(`INSERT INTO ${audit} SET ?`, { ...auditRow, details: JSON.stringify({ note: "測".repeat(6000) }) }), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  await historyUp(f.scoped); await auditUp(f.scoped);
  // Active deletion is an Archive-service operation; no domain/API delete capability is introduced here.
});

integrationTest("Conversion uniqueness chooses one winner under independent-connection insert races", async t => {
  const f = await setup(t), table = f.names.sales_quotation_conversions;
  const contender = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  t.after(() => contender.end());
  const row = { quotation_id: f.quoteId, sales_order_id: f.orderId, sales_order_number_snapshot: "SO-TEST", difference_summary: "{}",
    difference_hash: "a".repeat(64), event_id: randomUUID(), converted_at: f.now };
  // The target is a logical original ID, deliberately without a FK for Archive routing (Design §4.6).
  const results = await Promise.allSettled([f.db.query(`INSERT INTO ${table} SET ?`, row),
    contender.query(`INSERT INTO ${table} SET ?`, { ...row, sales_order_id: f.orderId + 1, event_id: randomUUID() })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "ER_DUP_ENTRY");
  assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n, 1);
});

integrationTest("Append-only migrations repair interrupted missing triggers and reject substituted trigger bodies", async t => {
  const f = await setup(t), table = f.names.sales_audit_logs;
  const [[trigger]] = await f.db.query("SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table=?", [table]);
  assert.match(trigger.name, /^[a-z0-9_]+$/u);
  await f.db.query(`DROP TRIGGER ${trigger.name}`); await auditUp(f.scoped);
  await f.db.query(`DROP TRIGGER ${trigger.name}`);
  await f.db.query(`CREATE TRIGGER ${trigger.name} BEFORE UPDATE ON ${table} FOR EACH ROW SET NEW.outcome = OLD.outcome`);
  await assert.rejects(() => auditUp(f.scoped), /trigger/u);
});
