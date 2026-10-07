import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";
import { createTestCurrency, lockSalesFixture } from "../sales/phase1/fixtures.js";
import { up as headerUp, inspectSalesQuotationSchema } from "../../database/migrations/0070_create_sales_quotations.js";
import { up as lineUp, inspectSalesQuotationLineSchema } from "../../database/migrations/0071_create_sales_quotation_lines.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
async function setup(t) {
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const suffix = randomUUID().replaceAll("-", "");
  const header = `sales_quote_probe_${suffix}`, lines = `sales_ql_probe_${suffix}`;
  const scoped = { async query(sql, args = []) {
    const result = await db.query(sql.replace(/\bsales_quotation_lines\b/gu, lines).replace(/\bsales_quotations\b/gu, header)
      .replace(/fk_sales_([a-z_]+)/gu, `fk_${suffix}_$1`).replace(/chk_sales_([a-z_]+)/gu, `chk_${suffix}_$1`),
    args.map(value => value === "sales_quotations" ? header : value === "sales_quotation_lines" ? lines : value));
    if (Array.isArray(result[0])) for (const row of result[0]) if (row.target === header) row.target = "sales_quotations";
    return result;
  } };
  const cleanup = [];
  t.after(async () => { try { await db.query(`DROP TABLE IF EXISTS ${lines}`); await db.query(`DROP TABLE IF EXISTS ${header}`);
    for (const action of cleanup.reverse()) if (typeof action === "function") await action(); else await db.execute(...action); } finally { await db.end(); } });
  const now = Date.now(), code = `SQ-${suffix.slice(0, 10)}`;
  await lockSalesFixture(db);
  const currency = await createTestCurrency(db, cleanup, now);
  const [uom] = await db.execute("INSERT INTO item_uoms (code,name,created_at,updated_at) VALUES (?, 'Each', ?, ?)", [code, now, now]);
  cleanup.push(["DELETE FROM item_uoms WHERE id = ?", [uom.insertId]]);
  const [customer] = await db.execute(`INSERT INTO customers (customer_code,customer_code_key,legal_name,legal_name_key,
    default_currency_code,status,version,created_at,updated_at) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`, [code, code.toLowerCase(), code, code.toLowerCase(), currency, now, now]);
  cleanup.push(["DELETE FROM customers WHERE id = ?", [customer.insertId]]);
  const [item] = await db.execute("INSERT INTO items (name,status,created_at,updated_at) VALUES (?, 'active', ?, ?)", [code, now, now]);
  cleanup.push(["DELETE FROM items WHERE id = ?", [item.insertId]]);
  const [sku] = await db.execute("INSERT INTO item_skus (item_id,sku_code,sku_name,status,created_at,updated_at) VALUES (?, ?, ?, 'active', ?, ?)", [item.insertId, code, code, now, now]);
  const [mapping] = await db.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?, ?, 1, 1, ?, ?)", [sku.insertId, uom.insertId, now, now]);
  const [user] = await db.execute("INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?, 'synthetic', 'Sales probe', ?, ?)", [code, now, now]);
  cleanup.push(["DELETE FROM users WHERE id = ?", [user.insertId]]);
  const insertHeader = async (overrides = {}) => {
    const row = { quotation_number: code, status: "DRAFT", customer_id: customer.insertId, customer_code_snapshot: code,
      customer_name_snapshot: code, currency_code: currency, quotation_date: "2026-10-05", valid_until: "2026-10-06",
      line_count: 1, total_amount: "0.0000", created_at: now, updated_at: now, last_business_updated_at: now, created_by: user.insertId, ...overrides };
    const [result] = await db.query(`INSERT INTO ${header} SET ?`, row); return result.insertId;
  };
  const insertLine = async (quotationId, overrides = {}) => {
    const row = { quotation_id: quotationId, line_no: 1, sku_id: sku.insertId, item_name_snapshot: code,
      sku_code_snapshot: code, sku_name_snapshot: code, sku_uom_id: mapping.insertId, uom_code_snapshot: "EA", uom_name_snapshot: "Each",
      to_base_factor_snapshot: 1, quantity: "1.000000", base_quantity: 1, unit_selling_price: "0.0000", price_source: "MANUAL",
      line_amount: "0.0000", created_at: now, updated_at: now, ...overrides };
    return db.query(`INSERT INTO ${lines} SET ?`, row);
  };
  return { db, scoped, header, lines, customer, sku, mapping, user, insertHeader, insertLine };
}

integrationTest("TC-011 Quotation migrations create empty tables, preserve upgrade rows and rerun", async t => {
  const f = await setup(t);
  await headerUp(f.scoped); await lineUp(f.scoped);
  const id = await f.insertHeader(); await f.insertLine(id);
  await headerUp(f.scoped); await lineUp(f.scoped);
  assert.equal(await inspectSalesQuotationSchema(f.scoped), true);
  assert.equal(await inspectSalesQuotationLineSchema(f.scoped), true);
  const [[row]] = await f.db.query(`SELECT version,total_amount FROM ${f.header} WHERE id = ?`, [id]);
  assert.equal(row.version, 1); assert.equal(row.total_amount, "0.0000");
  await assert.rejects(() => f.insertHeader(), { code: "ER_DUP_ENTRY" });
  await assert.rejects(() => f.insertLine(id), { code: "ER_DUP_ENTRY" });
  await f.db.execute(`UPDATE ${f.lines} SET quantity = '99999999999999.999999', unit_selling_price = '999999999999999.9999', line_amount = '999999999999999.9999'`);
  const [[line]] = await f.db.query(`SELECT quantity,unit_selling_price FROM ${f.lines}`);
  assert.equal(line.quantity, "99999999999999.999999"); assert.equal(line.unit_selling_price, "999999999999999.9999");
});

integrationTest("TC-011 Quotation MySQL enforces status, dates, positive quantities, line bounds and FK delete rules", async t => {
  const f = await setup(t); await headerUp(f.scoped); await lineUp(f.scoped);
  for (const overrides of [{ status: "UNKNOWN" }, { line_count: 0 }, { line_count: 101 }, { version: 0 }, { valid_until: "2026-10-04" }, { total_amount: "-1" }])
    await assert.rejects(() => f.insertHeader(overrides), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  const id = await f.insertHeader();
  for (const overrides of [{ line_no: 0 }, { line_no: 101 }, { quantity: "0" }, { base_quantity: 0 }, { to_base_factor_snapshot: 1000001 }, { unit_selling_price: "-1" }, { price_source: "IMPORT" }])
    await assert.rejects(() => f.insertLine(id, overrides), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  await f.insertLine(id);
  for (const [table, key] of [["customers", f.customer.insertId], ["item_skus", f.sku.insertId], ["item_sku_uoms", f.mapping.insertId]])
    await assert.rejects(() => f.db.execute(`DELETE FROM ${table} WHERE id = ?`, [key]), { code: "ER_ROW_IS_REFERENCED_2" });
  await f.db.execute("DELETE FROM users WHERE id = ?", [f.user.insertId]);
  assert.equal((await f.db.query(`SELECT created_by FROM ${f.header}`))[0][0].created_by, null);
  await f.db.execute(`DELETE FROM ${f.header} WHERE id = ?`, [id]);
  assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${f.lines}`))[0][0].n, 0);
});

integrationTest("Quotation migration rejects column-type and unique-index column drift", async t => {
  const f = await setup(t); await headerUp(f.scoped); await lineUp(f.scoped);
  await f.db.query(`ALTER TABLE ${f.header} MODIFY version BIGINT UNSIGNED NOT NULL DEFAULT 1`);
  await assert.rejects(() => headerUp(f.scoped), /column version/u);
  await f.db.query(`ALTER TABLE ${f.lines} DROP INDEX uq_sales_quotation_line_number, ADD UNIQUE KEY uq_sales_quotation_line_number (quotation_id,line_no,sku_id)`);
  await assert.rejects(() => lineUp(f.scoped), /index uq_sales_quotation_line_number/u);
});

integrationTest("Quotation migration rejects case/space/charset suffix changes in ASCII CHECK literals and missing constraints", async t => {
  const f = await setup(t); await headerUp(f.scoped);
  const [[constraint]] = await f.db.query(`SELECT constraint_name AS name FROM information_schema.table_constraints
    WHERE constraint_schema=DATABASE() AND table_name=? AND constraint_type='CHECK' AND constraint_name LIKE '%quotation_status'`, [f.header]);
  assert.match(constraint.name, /^[a-z0-9_]+$/u);
  for (const literal of ["draft", "DRAFT ", "DRAFT_ascii"]) {
    await f.db.query(`ALTER TABLE ${f.header} DROP CHECK ${constraint.name}, ADD CONSTRAINT ${constraint.name}
      CHECK (status IN ('${literal}','ISSUED','EXPIRED','CONVERTED','CANCELLED'))`);
    await assert.rejects(() => headerUp(f.scoped), /check clause/u);
  }
  await f.db.query(`ALTER TABLE ${f.header} DROP CHECK ${constraint.name}`);
  await assert.rejects(() => headerUp(f.scoped), /checks/u);
});
