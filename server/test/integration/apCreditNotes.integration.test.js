import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { ApCommandRunner } from "../../src/modules/accounts-payable/apCommand.js";
import { ApCreditNoteService } from "../../src/modules/accounts-payable/ApCreditNoteService.js";
import { apInvoiceService } from "../../src/handlers/accounts-payable/apSchemas.js";
import { createSupplierHarness } from "./supplierHttpHarness.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1";
const integrationTest = enabled ? test : test.skip;
const h = createSupplierHarness("apcredit");
const why = "Supplier corrected the original invoice";
let time, manager, viewer, service;

before(async () => {
  if (!enabled) return;
  await h.start();
  time = h.application.services.require("time");
  manager = await h.makeUser("manager", ["ap.view", "ap.credit.mgmt", "ap.invoice.mgmt"]);
  viewer = await h.makeUser("viewer", ["ap.view"]);
  service = makeService(h.db);
});
after(() => h.stop());

function makeService(database) {
  return new ApCreditNoteService({ commands: new ApCommandRunner({ database, time }), time });
}

function command(input, creditNoteId, extra = {}) {
  const claims = { sub: String(manager.userId), roles: [manager.username], permissions: manager.permissions };
  return { claims, input: { eventId: randomUUID(), ...input }, creditNoteId, ...extra };
}

async function fixture(t) {
  const code = `APC-${randomUUID().slice(0, 8)}`;
  const supplierId = await h.seedSupplier(code, code);
  const today = time.fileDate(time.at(time.nowMs()));
  t.after(async () => {
    await h.db.query("DELETE FROM ap_credit_applications WHERE credit_note_id IN (SELECT id FROM ap_credit_notes WHERE supplier_id = ?)", [supplierId]);
    await h.db.query("DELETE FROM ap_credit_note_lines WHERE credit_note_id IN (SELECT id FROM ap_credit_notes WHERE supplier_id = ?)", [supplierId]);
    await h.db.query("DELETE FROM ap_credit_notes WHERE supplier_id = ?", [supplierId]);
    await h.db.query("DELETE FROM ap_invoice_lines WHERE invoice_id IN (SELECT id FROM ap_invoices WHERE supplier_id = ?)", [supplierId]);
    await h.db.query("DELETE FROM ap_invoices WHERE supplier_id = ?", [supplierId]);
  });
  const invoice = async ({ total = "0.0300", allocated = "0.0200", outstanding = "0.0100" } = {}) => {
    const number = `${code}-${randomUUID().slice(0, 8)}`;
    const now = time.nowMs();
    const [result] = await h.db.query("INSERT INTO ap_invoices SET ?", [{
      invoice_number: number, status: "CONFIRMED", supplier_id: supplierId,
      supplier_code_snapshot: code, supplier_name_snapshot: code, currency_code: "HKD", currency_decimal_places: 2,
      supplier_invoice_number: number, invoice_date: today, due_date: today,
      total_amount: total, allocated_amount: allocated, outstanding_amount: outstanding,
      created_by_label: "fixture", created_at: now, updated_at: now
    }]);
    return Number(result.insertId);
  };
  const line = async (invoiceId, lineNo, lineAmount) => {
    const [result] = await h.db.query(
      "INSERT INTO ap_invoice_lines (invoice_id, line_no, line_type, line_amount) VALUES (?, ?, 'EXPENSE', ?)",
      [invoiceId, lineNo, lineAmount]);
    return Number(result.insertId);
  };
  const balances = async (invoiceId) => {
    const [[row]] = await h.db.query("SELECT allocated_amount, outstanding_amount FROM ap_invoices WHERE id = ?", [invoiceId]);
    return [row.allocated_amount, row.outstanding_amount];
  };
  const draft = (invoiceId, lines) => ({ invoiceId, creditDate: today, reason: why, lines });
  return { invoice, line, draft, balances, today };
}

integrationTest("AP credits apply the original cap and reverse only their own invoice effects", async (t) => {
  const f = await fixture(t);
  const origin = await f.invoice(), target = await f.invoice({ total: "5.0000", allocated: "0.0000", outstanding: "5.0000" });
  const first = await f.line(origin, 1, "0.0149"), second = await f.line(origin, 2, "0.0149");
  const lines = [{ invoiceLineId: first, amount: "0.02" }, { invoiceLineId: second, amount: "0.01" }];
  await assert.rejects(service.create(command(f.draft(origin, [{ invoiceLineId: second, amount: "0.02" }]))), { code: "AP_CREDIT_EXCEEDS_INVOICE" });
  const credit = await service.create(command(f.draft(origin, lines)));
  const other = await service.create(command(f.draft(origin, [{ invoiceLineId: first, amount: "0.01" }])));
  const changed = await service.update(command({ version: 1, creditDate: f.today, reason: why, lines, notes: "Updated note" }, credit.id));
  const issue = command({ version: changed.version }, credit.id);
  const confirmed = await service.confirm(issue);
  assert.match(confirmed.number, /^SCN-\d{4}-\d{6}$/u);
  assert.deepEqual([confirmed.appliedAmount, confirmed.availableAmount], ["0.0100", "0.0200"]);
  assert.equal((await service.confirm(issue)).replayed, true);
  assert.deepEqual(await f.balances(origin), ["0.0300", "0.0000"]);
  await assert.rejects(service.confirm(command({ version: other.version }, other.id)), { code: "AP_CREDIT_EXCEEDS_INVOICE" });

  const [[originApplication]] = await h.db.query("SELECT id FROM ap_credit_applications WHERE credit_note_id = ? AND is_origin = 1", [credit.id]);
  await assert.rejects(service.unapply(command({ version: confirmed.version }, credit.id, { allocationId: Number(originApplication.id) })),
    { code: "AP_CREDIT_ORIGIN_ALLOCATION" });
  const applied = await service.allocate(command({ version: confirmed.version, invoiceId: target, amount: "0.02" }, credit.id));
  assert.deepEqual(await f.balances(target), ["0.0200", "4.9800"]);
  await assert.rejects(service.void(command({ version: applied.version, reason: why }, credit.id)), { code: "AP_CREDIT_HAS_ACTIVITY" });
  const unapplied = await service.unapply(command({ version: applied.version }, credit.id, { allocationId: applied.allocationId }));
  assert.deepEqual(await f.balances(target), ["0.0000", "5.0000"]);
  await h.db.execute("UPDATE ap_credit_notes SET refunded_amount = available_amount, available_amount = 0 WHERE id = ?", [credit.id]);
  await assert.rejects(service.void(command({ version: unapplied.version, reason: why }, credit.id)), { code: "AP_CREDIT_HAS_ACTIVITY" });
  await h.db.execute("UPDATE ap_credit_notes SET available_amount = refunded_amount, refunded_amount = 0 WHERE id = ?", [credit.id]);
  const voided = await service.void(command({ version: unapplied.version, reason: why }, credit.id));
  assert.deepEqual([voided.status, voided.appliedAmount, voided.availableAmount], ["VOID", "0.0000", "0.0000"]);
  assert.deepEqual(await f.balances(origin), ["0.0200", "0.0100"]);
  assert.equal((await service.confirm(command({ version: other.version }, other.id))).status, "CONFIRMED");
});

integrationTest("AP credit HTTP endpoints separate permissions and keep invoice cash allocations distinct", async (t) => {
  const f = await fixture(t);
  const invoiceId = await f.invoice({ total: "5.0000", allocated: "0.0000", outstanding: "5.0000" });
  const lineId = await f.line(invoiceId, 1, "5.0000");
  const base = "/api/v1/ap-credit-notes";
  const call = async (path, { user = manager, body, key = body?.eventId } = {}) => {
    const response = await fetch(h.url + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${user.token}`, ...(body ? { "Content-Type": "application/json", "Idempotency-Key": key } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, data: await response.json() };
  };
  const body = { eventId: randomUUID(), ...f.draft(invoiceId, [{ invoiceLineId: lineId, amount: "2.00" }]) };
  assert.equal((await call(base, { user: viewer, body })).status, 403);
  assert.equal((await call(base, { body, key: randomUUID() })).status, 400);
  const created = await call(base, { body });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const id = created.data.data.id;
  assert.equal((await call(base, { body })).data.data.id, id);
  const confirmed = await call(`${base}/${id}/confirm`, { body: { eventId: randomUUID(), version: 1 } });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  const detail = await call(`${base}/${id}`, { user: viewer });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.deepEqual(detail.data.data.allowedActions, []);
  assert.deepEqual(detail.data.data.lines.map(({ invoiceLineId }) => invoiceLineId), [lineId]);
  const list = await call(`${base}?invoiceId=${invoiceId}&status=CONFIRMED`, { user: viewer });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.deepEqual(list.data.data.items.map(({ id: creditId }) => creditId), [id]);
  const invoice = await call(`/api/v1/ap-invoices/${invoiceId}`, { user: viewer });
  assert.equal(invoice.status, 200, JSON.stringify(invoice.data));
  assert.deepEqual(invoice.data.data.allocations, []);
  assert.deepEqual(invoice.data.data.creditAllocations.map(({ creditNoteId, isOrigin, amount }) => [creditNoteId, isOrigin, amount]), [[id, true, "2.0000"]]);
});

integrationTest("AP invoice void also detects confirmed credits without an origin allocation", async (t) => {
  const f = await fixture(t);
  const invoiceId = await f.invoice({ total: "1.0000", allocated: "1.0000", outstanding: "0.0000" });
  const lineId = await f.line(invoiceId, 1, "1.0000");
  const credit = await service.create(command(f.draft(invoiceId, [{ invoiceLineId: lineId, amount: "1.00" }])));
  assert.equal((await service.confirm(command({ version: credit.version }, credit.id))).appliedAmount, "0.0000");
  await h.db.execute("UPDATE ap_invoices SET allocated_amount = 0, outstanding_amount = total_amount WHERE id = ?", [invoiceId]);
  await assert.rejects(apInvoiceService(h.application.services).void(command({ version: 1, reason: why }, credit.id, { invoiceId })),
    { code: "AP_INVOICE_HAS_ALLOCATIONS" });
});

integrationTest("A deadlock reported while writing AP credit lines rolls back the header and event, allowing retry", async (t) => {
  const f = await fixture(t);
  const invoiceId = await f.invoice({ total: "1.0000", allocated: "0.0000", outstanding: "1.0000" });
  const lineId = await f.line(invoiceId, 1, "1.0000");
  const failure = makeService({
    withTransaction: (work, options) => h.db.withTransaction((tx) => work({
      query(sql, args) {
        if (sql.startsWith("INSERT INTO ap_credit_note_lines")) throw Object.assign(new Error("test deadlock"), { code: "ER_LOCK_DEADLOCK" });
        return tx.query(sql, args);
      },
      execute: (sql, args) => tx.execute(sql, args)
    }), options)
  });
  const request = command(f.draft(invoiceId, [{ invoiceLineId: lineId, amount: "1.00" }]));
  await assert.rejects(failure.create(request), { code: "CONCURRENT_OPERATION", statusCode: 409 });
  const [[counts]] = await h.db.query(`
    SELECT (SELECT COUNT(*) FROM ap_credit_notes WHERE invoice_id = ?) AS credits,
           (SELECT COUNT(*) FROM ap_operation_requests WHERE event_id = ?) AS operations
  `, [invoiceId, request.input.eventId]);
  assert.deepEqual(counts, { credits: 0, operations: 0 });
  assert.equal((await service.create(request)).replayed, false);
});
