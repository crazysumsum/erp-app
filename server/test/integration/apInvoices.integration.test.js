import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { ADMIN, runRunner, scratchDatabase } from "./supplierScratchDatabase.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const base = "/api/v1/ap-invoices";
const invoiceDate = "2026-11-24";
let shared, application, cleanupScratch;

after(async () => {
  try {
    await application?.shutdown("ap_invoice_tests_complete");
  } finally {
    await cleanupScratch?.();
  }
});

function fixture() { return shared ??= setup(); }

async function setup() {
  // Confirmed receipts and AP audits are immutable. Keep their retained records and
  // the fixture payment term out of the shard's shared schema.
  const { name } = await scratchDatabase({ after: (callback) => { cleanupScratch = callback; } });
  await runRunner(name);
  const source = defaultConfigurationSource();
  application = await createApplication({ configurationSource: {
    ...source, application: { ...source.application, port: 0 },
    database: { ...source.database, ...ADMIN, socketPath: undefined, database: name },
    requestLimiter: { ...source.requestLimiter, maxRequestsPerIpPerWindow: 100 }
  } });
  const db = application.services.require("mysqldatabase"), time = application.services.require("time");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12), now = time.nowMs();
  const timestamps = { created_at: now, updated_at: now };
  const insert = async (table, row) => Number((await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
  async function person(label, permissions) {
    const name = `ap_invoice_${label}_${tag}`;
    const roleId = await insert("roles", { name, created_at: now });
    for (const permission of permissions) {
      await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [roleId, permission]);
    }
    const userId = await insert("users", { username: name, password_hash: "synthetic", display_name: name, ...timestamps });
    await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
    const version = await application.services.require("tokenRevocation").currentVersion(String(userId));
    const token = await application.services.require("jwt").issue({ roles: [name], permissions }, {
      subject: String(userId), version, authTime: Math.floor(now / 1000)
    });
    return { userId, token };
  }
  const normal = await person("normal", ["ap.view", "ap.invoice.mgmt"]);
  const overrider = await person("price", ["ap.view", "ap.invoice.mgmt", "ap.invoice.price.override"]);
  const viewer = await person("read", ["ap.view"]);

  let partyCount = 0;
  async function supplier() {
    const code = `AP-${tag}-${++partyCount}`;
    const id = await insert("suppliers", { supplier_code: code, supplier_code_key: code.toLowerCase(), supplier_name: code,
      supplier_name_key: code.toLowerCase(), status: "active", default_currency_code: "HKD", ...timestamps });
    return { id, code };
  }
  const item = await insert("items", { name: `AP Invoice ${tag}`, status: "active", ...timestamps });
  const sku = await insert("item_skus", { item_id: item, sku_code: `SKU-${tag}`, sku_name: "AP-SKU", status: "active",
    purchasable: 1, inventory_tracked: 1, tracking_policy: "none", ...timestamps });
  const units = [];
  for (const [kind, factor] of [["E", 1], ["P", 2]]) {
    const code = `${kind}${tag}`;
    const id = await insert("item_uoms", { code, name: kind, ...timestamps });
    const link = await insert("item_sku_uoms", { sku_id: sku, uom_id: id, to_base_factor: factor, is_base: factor === 1, ...timestamps });
    units.push({ id, code, link });
  }
  const terms = { code: `AP-${tag}`, name: "PO snapshot net 30", calculationType: "NET_DAYS", dueDays: 30 };
  const termId = await insert("payment_terms", { code: terms.code, code_key: terms.code.toLowerCase(), name: terms.name,
    calculation_type: terms.calculationType, due_days: 30, status: "ACTIVE", version: 1, ...timestamps });

  async function receipt(party, dueDays = 30) {
    const month = "209501";
    const [[{ sequence }]] = await db.query("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS sequence FROM purchase_orders WHERE document_year_month = ?", [month]);
    const suffix = String(sequence).padStart(6, "0");
    const partyFields = { supplier_id: party.id, supplier_code_snapshot: party.code, supplier_name_snapshot: party.code };
    const po = await insert("purchase_orders", {
      ...partyFields, po_number: `PO-${month}-${suffix}`, document_year_month: month, sequence_no: sequence,
      currency_code: "HKD", currency_name_snapshot: "Hong Kong Dollar", currency_decimal_places_snapshot: 2,
      payment_term_id: termId, payment_term_snapshot: JSON.stringify({ ...terms, dueDays }),
      order_date: invoiceDate, buyer_id: normal.userId, buyer_label: "AP Test",
      total_amount: "125.0000", subtotal_amount: "125.0000", has_outstanding: 1,
      created_by_label: "AP Test", updated_by_label: "AP Test", ...timestamps
    });
    const poLine = await insert("purchase_order_lines", { purchase_order_id: po, line_number: 1, sku_id: sku, sku_code_snapshot: `SKU-${tag}`,
      sku_name_snapshot: "AP-SKU", inventory_tracked_snapshot: 1, tracking_policy_snapshot: "none",
      base_uom_id: units[0].id, base_uom_code_snapshot: units[0].code, purchase_sku_uom_id: units[1].link,
      purchase_uom_code_snapshot: units[1].code, uom_to_base_factor_snapshot: 2, ordered_quantity: "5", ordered_base_quantity: 10,
      unit_price: "25.0000", line_amount: "125.0000", has_outstanding: 1, ...timestamps });
    await db.query("UPDATE purchase_orders SET status = 'CONFIRMED', confirmed_at = ? WHERE id = ?", [now, po]);
    const gr = await insert("goods_receipts", { ...partyFields, gr_number: `GR-${month}-${suffix}`, document_year_month: month,
      sequence_no: sequence, purchase_order_id: po, business_receipt_date: "2026-11-25", total_received_base_quantity: 5,
      created_by_label: "AP Test", updated_by_label: "AP Test", ...timestamps });
    const line = await insert("goods_receipt_lines", { goods_receipt_id: gr, purchase_order_id: po, purchase_order_line_id: poLine, line_number: 1,
      sku_id: sku, sku_code_snapshot: `SKU-${tag}`, sku_name_snapshot: "AP-SKU", received_base_quantity: 5, ...timestamps });
    await db.query("UPDATE goods_receipts SET status = 'CONFIRMED', confirmed_at = ?, confirm_event_id = ? WHERE id = ?", [now, randomUUID(), gr]);
    return { id: String(gr), line: String(line) };
  }

  const { url } = await application.start();
  async function request(path, input, token = normal.token) {
    const response = await fetch(url + path, { method: input ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(input ? { "Content-Type": "application/json", "Idempotency-Key": input.eventId } : {}) },
      body: input ? JSON.stringify(input) : undefined });
    return { status: response.status, body: await response.json() };
  }
  const post = (path, fields, token) => request(base + path, { eventId: randomUUID(), ...fields }, token);
  return { db, termId, post, supplier, receipt, overrider: overrider.token, viewer: viewer.token,
    read: (id) => request(`${base}/${id}`), linked: (ids) => request(`/api/v1/ap-invoiced-receipts?goodsReceiptIds=${ids.join(",")}`) };
}

function ok(result) {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.data;
}

function denied(result, status, code) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  if (code) assert.equal(result.body.error.code, code);
}

integrationTest("AP reserves full receipts, uses PO payment-term snapshots and reopens sources after void", async () => {
  const f = await fixture();
  const party = await f.supplier();
  const first = await f.receipt(party), second = await f.receipt(party);
  await f.db.query("UPDATE payment_terms SET due_days = 60 WHERE id = ?", [f.termId]);
  const create = { goodsReceiptIds: [second.id, first.id], supplierInvoiceNumber: "  Paper-001  ", invoiceDate };
  const draft = ok(await f.post("", create));
  assert.deepEqual([draft.totalAmount, draft.number, draft.version], ["125.0000", null, 1]);
  const detail = ok(await f.read(draft.id));
  assert.deepEqual([detail.invoiceDate, detail.dueDate, detail.paymentTermName, detail.supplierInvoiceNumber],
    [invoiceDate, "2026-12-24", "PO snapshot net 30", "Paper-001"]);
  assert.deepEqual(detail.lines.map((line) => [line.goodsReceiptLineId, line.quantity, line.poUnitPrice, line.poLineAmount, line.invoiceUnitPrice]),
    [[first.line, "5", "25.0000", "62.5000", "25.0000"], [second.line, "5", "25.0000", "62.5000", "25.0000"]]);
  assert.equal(ok(await f.linked([first.id, second.id])).items.length, 2);
  denied(await f.post("", { ...create, supplierInvoiceNumber: "Paper-002" }), 409, "AP_RECEIPT_ALREADY_INVOICED");
  denied(await f.post(`/${draft.id}/confirm`, { version: 1 }), 409, "AP_INVOICE_TOTAL_MISMATCH");
  denied(await f.post(`/${draft.id}/update`, { version: 1, invoiceDate: "2026-11-23" }), 400, "AP_INPUT_INVALID");
  denied(await f.post(`/${draft.id}/update`, { version: 1, dueDate: "2026-12-28" }), 400, "AP_INPUT_INVALID");
  ok(await f.post(`/${draft.id}/update`, { version: 1, dueDate: "2026-12-28", dueDateReason: "Supplier agreed", supplierTotalAmount: "125.00" }));
  const adjusted = ok(await f.read(draft.id));
  assert.deepEqual([adjusted.dueDate, adjusted.dueDateOverridden, adjusted.dueDateReason], ["2026-12-28", true, "Supplier agreed"]);
  await f.db.query("UPDATE suppliers SET status = 'archived' WHERE id = ?", [party.id]);
  const confirmed = ok(await f.post(`/${draft.id}/confirm`, { version: 2 }));
  assert.match(confirmed.number, /^APV-\d{4}-\d{6}$/u);
  ok(await f.post(`/${draft.id}/void`, { version: 3, reason: "Supplier cancelled original" }));
  assert.deepEqual(ok(await f.linked([first.id, second.id])).items, []);
  const replacements = await Promise.all([f.post("", create), f.post("", { ...create, supplierInvoiceNumber: "Paper-003" })]);
  assert.deepEqual(replacements.map(({ status }) => status).sort(), [200, 409]);
  denied(replacements.find(({ status }) => status === 409), 409, "AP_RECEIPT_ALREADY_INVOICED");
});

integrationTest("AP no-PO expenses preserve supplier number uniqueness and require an active supplier at confirmation", async () => {
  const f = await fixture();
  const party = await f.supplier(), other = await f.supplier();
  const request = { supplierId: party.id, currencyCode: "HKD", supplierInvoiceNumber: " Service-a ", invoiceDate,
    dueDate: "2026-11-30", noPoReason: "Service fee", expenses: [{ description: "Freight", lineAmount: "24.005" }] };
  denied(await f.post("", request, f.viewer), 403);
  denied(await f.post("", { ...request, dueDate: undefined }), 409, "AP_DUE_DATE_REQUIRED");
  const draft = ok(await f.post("", request));
  assert.equal(draft.totalAmount, "24.0100");
  denied(await f.post("", { ...request, supplierInvoiceNumber: "SERVICE-A" }), 409, "AP_DUPLICATE_SUPPLIER_INVOICE");
  ok(await f.post("", { ...request, supplierId: other.id }));
  denied(await f.post(`/${draft.id}/update`, { version: 1, expenses: [] }), 400, "AP_INPUT_INVALID");
  ok(await f.post(`/${draft.id}/update`, { version: 1, supplierTotalAmount: "30", expenses: [{ description: "Freight", lineAmount: "30.00" }] }));
  const updated = ok(await f.read(draft.id));
  assert.equal(updated.lines.length, 1);
  assert.deepEqual([updated.lines[0].lineType, updated.lines[0].invoiceUnitPrice, updated.lines[0].lineAmount], ["EXPENSE", null, "30.0000"]);
  await f.db.query("UPDATE suppliers SET status = 'archived' WHERE id = ?", [party.id]);
  denied(await f.post(`/${draft.id}/confirm`, { version: 2 }), 409, "SUPPLIER_NOT_USABLE");
  denied(await f.post("", { ...request, supplierInvoiceNumber: "blocked" }), 409, "SUPPLIER_NOT_USABLE");
  ok(await f.post(`/${draft.id}/cancel`, { version: 2 }));
  await f.db.query("UPDATE suppliers SET status = 'active' WHERE id = ?", [party.id]);
  ok(await f.post("", request));
});

integrationTest("AP restricts receipt price overrides while preserving PO amounts and mixed-term manual due dates", async () => {
  const f = await fixture();
  const party = await f.supplier();
  const n30 = await f.receipt(party), n60 = await f.receipt(party, 60);
  const create = { goodsReceiptIds: [n30.id, n60.id], supplierInvoiceNumber: "MIXED-001", invoiceDate };
  denied(await f.post("", create), 409, "AP_DUE_DATE_REQUIRED");
  const receiptOverrides = [{ goodsReceiptLineId: n30.line, lineAmount: "60.01", reason: "Supplier price" }];
  const priced = { ...create, dueDate: "2026-12-30", receiptOverrides };
  denied(await f.post("", priced), 403, "AP_PRICE_OVERRIDE_FORBIDDEN");
  const draft = ok(await f.post("", priced, f.overrider));
  const detail = ok(await f.read(draft.id));
  assert.deepEqual([detail.paymentTermCode, detail.paymentTermName, detail.totalAmount], ["", "", "122.5100"]);
  assert.deepEqual([detail.lines[0].poLineAmount, detail.lines[0].lineAmount, detail.lines[0].invoiceUnitPrice],
    ["62.5000", "60.0100", "24.0040"]);
  denied(await f.post(`/${draft.id}/update`, { version: 1, receiptOverrides: [{ ...receiptOverrides[0], lineAmount: "60.02" }] }),
    403, "AP_PRICE_OVERRIDE_FORBIDDEN");
  denied(await f.post(`/${draft.id}/update`, { version: 1,
    receiptOverrides: [{ ...receiptOverrides[0], lineAmount: "62.5000", reason: "Restore PO amount" }] }),
    403, "AP_PRICE_OVERRIDE_FORBIDDEN");
  ok(await f.post(`/${draft.id}/update`, { version: 1, notes: "Matched PO and supplier amounts", receiptOverrides: [] }));
  assert.equal(ok(await f.read(draft.id)).lines[0].lineAmount, "60.0100");
  ok(await f.post(`/${draft.id}/update`, { version: 2,
    receiptOverrides: [{ ...receiptOverrides[0], lineAmount: "59.01", reason: "Corrected supplier price" }] }, f.overrider));
  ok(await f.post(`/${draft.id}/update`, { version: 3,
    receiptOverrides: [{ ...receiptOverrides[0], lineAmount: "62.5000", reason: "Restore PO amount" }] }, f.overrider));
  assert.deepEqual(ok(await f.read(draft.id)).lines.map((row) => [row.lineAmount, row.amountOverrideReason]), [["62.5000", ""], ["62.5000", ""]]);
  const [audit] = await f.db.query("SELECT actor_label, reason, detail FROM ap_audit_logs WHERE target_id = ? AND action = 'invoice.receipt_amount_changed' ORDER BY id", [draft.id]);
  assert.ok(audit.every((row) => row.actor_label.startsWith("ap_invoice_price_")));
  assert.deepEqual(audit.map((row) => {
    const entry = typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail;
    return [entry.goodsReceiptLineId, entry.poLineAmount, entry.previousAmount, entry.lineAmount, row.reason];
  }), [
    [n30.line, "62.5000", "62.5000", "60.0100", "Supplier price"],
    [n30.line, "62.5000", "60.0100", "59.0100", "Corrected supplier price"],
    [n30.line, "62.5000", "59.0100", "62.5000", "Restore PO amount"]
  ]);
});

integrationTest("AP rejects future invoice dates before writing or issuing a number and allows cancelling legacy drafts", async () => {
  const f = await fixture();
  const party = await f.supplier();
  const request = { supplierId: party.id, currencyCode: "HKD", supplierInvoiceNumber: "FUTURE", dueDate: "2099-01-31",
    supplierTotalAmount: "10.00", noPoReason: "Test services", expenses: [{ description: "Service", lineAmount: "10.00" }] };
  denied(await f.post("", { ...request, invoiceDate: "2099-01-01" }), 409, "AP_DATE_IN_FUTURE");
  const draft = ok(await f.post("", { ...request, invoiceDate }));
  await f.db.query("UPDATE ap_invoices SET invoice_date = '2099-01-01' WHERE id = ?", [draft.id]);
  denied(await f.post(`/${draft.id}/confirm`, { version: 1 }), 409, "AP_DATE_IN_FUTURE");
  assert.equal(ok(await f.read(draft.id)).number, null);
  ok(await f.post(`/${draft.id}/cancel`, { version: 1 }));
});
