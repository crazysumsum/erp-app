import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { arHttpFixture, arHttpShipmentFixture, failure } from "../ar/arHttpFixture.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const PATH = "/api/v1/ar-credit-notes";

async function creditFixture(f, permissions = ["ar.credit.mgmt"]) {
  const subject = String(f.outsider.id);
  await f.db.query("DELETE rp FROM role_permissions rp JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?", [subject]);
  await f.db.query(`INSERT INTO role_permissions (role_id, permission_id)
    SELECT ur.role_id, p.id FROM user_roles ur JOIN permissions p ON p.name IN (?) WHERE ur.user_id = ?`, [permissions, subject]);
  const services = f.application.services, version = await services.require("tokenRevocation").currentVersion(subject);
  const token = await services.require("jwt").issue({ roles: f.outsider.claims.roles, permissions },
    { subject, version, authTime: Math.floor(Date.now() / 1000) });
  return {
    token,
    post: (path, fields, user = token, eventId = randomUUID()) => f.send(PATH + path, { token: user, body: { eventId, ...fields } }),
    get: (path, user = f.viewer.token) => f.send(PATH + path, { token: user })
  };
}

integrationTest("an opening credit on a paid invoice keeps its funds and prevents invoice void after cash is unapplied", async () => {
  const f = await arHttpFixture(), credit = await creditFixture(f), customer = await f.customer();
  const source = await f.invoice(customer, "50.0000", { currency: f.other });
  const ref = randomUUID();
  await f.db.query("UPDATE ar_invoices SET opening_reference = ?, active_opening_reference = ? WHERE id = ?", [ref, ref, source]);
  const receipt = await f.receipt(customer, "50.00", { currencyCode: f.other });
  const cash = f.ok(await f.post(`/${receipt.id}/allocations`, { version: 2, allocations: [{ invoiceId: source, amount: "50.00" }] }));
  await f.db.query("UPDATE currencies SET status = 'INACTIVE' WHERE code = ?", [f.other]);
  await f.db.query("UPDATE customers SET status = 'inactive' WHERE id = ?", [customer.id]);
  const input = { invoiceId: source, creditDate: f.today, reason: "期初貸項", lines: [{ amount: "20" }] };

  assert.equal((await credit.post("", input, "")).status, 401);
  assert.equal((await credit.post("", input, f.viewer.token)).status, 403);
  assert.equal((await credit.get("", f.outsider.token)).status, 403);
  assert.deepEqual(failure(await credit.post("", { ...input, lines: [{ amount: "20.001" }] })), [400, "AR_INPUT_INVALID", "lines.0.amount"]);

  const draft = f.ok(await credit.post("", input));
  const edited = f.ok(await credit.post(`/${draft.id}/edit`, { version: 1, creditDate: f.today, reason: "期初金額更正", lines: [{ amount: "25" }] }));
  const key = randomUUID();
  const confirm = () => credit.post(`/${draft.id}/confirm`, { version: edited.version }, undefined, key);
  const confirmed = f.ok(await confirm());
  assert.match(confirmed.number, /^CRN-\d{4}-\d{6}$/u);
  assert.deepEqual([confirmed.appliedAmount, confirmed.availableAmount], ["0.0000", "25.0000"]);
  assert.equal(f.ok(await confirm()).number, confirmed.number);
  assert.equal(f.ok(await credit.get(`/${draft.id}`)).lines[0].invoiceLineId, null);
  f.ok(await f.post(`/${receipt.id}/allocations/${cash.allocationIds[0]}/unapply`, { version: 3 }));
  assert.deepEqual(failure(await f.invoicePost(`/${source}/void`, { version: 3, reason: "原發票須保留" })).slice(0, 2), [409, "AR_INVOICE_HAS_ALLOCATIONS"]);

  const other = await f.invoice(customer, "100.0000", { currency: f.other });
  const wrongCurrency = await f.invoice(customer, "100.0000");
  assert.deepEqual(failure(await credit.post(`/${draft.id}/applications`, { version: confirmed.version, invoiceId: wrongCurrency, amount: "10" })).slice(0, 2),
    [409, "AR_CREDIT_PARTY_MISMATCH"]);
  const apply = f.ok(await credit.post(`/${draft.id}/applications`, { version: confirmed.version, invoiceId: other, amount: "10" }));
  assert.equal((await f.invoiceRow(other)).allocated_amount, "10.0000");
  assert.equal(f.ok(await f.send(`/api/v1/ar-invoices/${other}`, { token: f.viewer.token })).creditAllocations[0].creditNoteId, draft.id);
  assert.deepEqual(failure(await credit.post(`/${draft.id}/void`, { version: apply.version, reason: "先解除才能作廢" })).slice(0, 2), [409, "AR_CREDIT_HAS_EXTERNAL_APPLICATIONS"]);
  const unapplied = f.ok(await credit.post(`/${draft.id}/applications/${apply.applicationId}/unapply`, { version: apply.version }));
  assert.equal((await f.invoiceRow(other)).allocated_amount, "0.0000");
  await f.db.query("UPDATE ar_credit_notes SET refunded_amount = 5, available_amount = 20 WHERE id = ?", [draft.id]);
  assert.deepEqual(failure(await credit.post(`/${draft.id}/void`, { version: unapplied.version, reason: "退款仍然生效" })).slice(0, 2),
    [409, "AR_CREDIT_HAS_REFUNDS"]);
  await f.db.query("UPDATE ar_credit_notes SET refunded_amount = 0, available_amount = 25 WHERE id = ?", [draft.id]);
  const voided = f.ok(await credit.post(`/${draft.id}/void`, { version: unapplied.version, reason: "解除核銷後作廢" }));
  assert.deepEqual([voided.status, voided.totalAmount, voided.availableAmount], ["VOID", "25.0000", "0.0000"]);
  assert.equal(f.ok(await f.invoicePost(`/${source}/void`, { version: 3, reason: "貸項已作廢後更正" })).status, "VOID");
});

integrationTest("confirmation serializes the same invoice and applies the largest-remainder per-line caps", async (t) => {
  const f = await arHttpShipmentFixture(t, { includeSecond: true }), credit = await creditFixture(f, ["ar.credit.mgmt", "ar.view"]);
  const source = f.ok(await f.invoicePost("", { shipmentIds: f.shipmentIds, dueDate: f.day(30) })).id;
  f.ok(await f.invoicePost(`/${source}/confirm`, { version: 1 }));
  await f.db.query("UPDATE ar_invoice_lines SET line_amount = 0.0149 WHERE invoice_id = ?", [source]);
  await f.db.query("UPDATE ar_invoices SET total_amount = 0.0300, outstanding_amount = 0.0300 WHERE id = ?", [source]);
  const [lines] = await f.db.query("SELECT id FROM ar_invoice_lines WHERE invoice_id = ? ORDER BY line_no", [source]);
  const [[issue]] = await f.db.query(`SELECT d.id, d.shipment_id, d.bin_id, d.inventory_movement_id FROM shipment_issue_details d
    JOIN ar_invoice_lines l ON l.shipment_line_id = d.shipment_line_id WHERE l.id = ?`, [lines[0].id]);
  const now = Date.now();
  const [{ insertId: returnId }] = await f.db.query("INSERT INTO customer_returns SET ?", [{
    shipment_id: issue.shipment_id, customer_id: f.party.id, customer_code_snapshot: f.party.code, customer_name_snapshot: f.party.name,
    return_date: f.today, reason: "Synthetic return linkage", created_by_label: "fixture", created_at: now, updated_at: now
  }]);
  const [{ insertId: returnLineId }] = await f.db.query("INSERT INTO customer_return_lines SET ?", [{
    return_id: returnId, shipment_id: issue.shipment_id, shipment_issue_detail_id: issue.id, line_no: 1, base_quantity: 1,
    bin_id: issue.bin_id, inventory_movement_id: issue.inventory_movement_id
  }]);
  const linked = (line) => credit.post("", { invoiceId: source, creditDate: f.today, reason: "退貨貸項",
    customerReturnId: Number(returnId), lines: [{ invoiceLineId: Number(line.id), customerReturnLineId: Number(returnLineId), amount: "0.01" }] });
  assert.deepEqual(failure(await linked(lines[0])).slice(0, 2), [409, "AR_CREDIT_SOURCE_INVALID"]);
  await f.db.query("UPDATE customer_returns SET status = 'POSTED', posted_at = ? WHERE id = ?", [now, returnId]);
  const sourcePath = `/sources/${source}/returns`;
  assert.equal((await credit.get(sourcePath)).status, 403);
  assert.deepEqual(f.ok(await credit.get(sourcePath, credit.token)).items, [
    { returnId: Number(returnId), returnDate: f.today, returnLineId: Number(returnLineId), lineNo: 1, invoiceLineId: Number(lines[0].id) }
  ]);
  assert.deepEqual(failure(await linked(lines[1])), [409, "AR_CREDIT_SOURCE_INVALID", "lines.0.customerReturnLineId"]);
  const linkedDraft = f.ok(await linked(lines[0]));
  assert.equal(f.ok(await credit.get(`/${linkedDraft.id}`)).lines[0].customerReturnLineId, Number(returnLineId));
  assert.equal(f.ok(await credit.post(`/${linkedDraft.id}/cancel`, { version: 1 })).status, "CANCELLED");
  const draft = (index, amount) => credit.post("", {
    invoiceId: source, creditDate: f.today, reason: "捨入尾差驗證", lines: [{ invoiceLineId: Number(lines[index].id), amount }]
  });
  assert.deepEqual(failure(await draft(1, "0.02")).slice(0, 2), [409, "AR_CREDIT_LIMIT_EXCEEDED"]);
  const first = f.ok(await draft(0, "0.02")), competing = f.ok(await draft(0, "0.02")), second = f.ok(await draft(1, "0.01"));
  const results = await Promise.all([first, competing].map(({ id }) => credit.post(`/${id}/confirm`, { version: 1 })));
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
  assert.equal(results.find(({ status }) => status === 409).body.error.code, "AR_CREDIT_LIMIT_EXCEEDED");
  f.ok(await credit.post(`/${second.id}/confirm`, { version: 1 }));
  const invoice = f.ok(await f.send(`/api/v1/ar-invoices/${source}`, { token: f.viewer.token }));
  assert.equal(invoice.outstandingAmount, "0.0000");
  assert.deepEqual(invoice.creditAllocations.map(({ amount }) => amount), ["0.0200", "0.0100"]);
  const origin = invoice.creditAllocations[1];
  assert.deepEqual(failure(await credit.post(`/${second.id}/applications/${origin.id}/unapply`, { version: 2 })).slice(0, 2),
    [409, "AR_CREDIT_APPLICATION_IS_ORIGIN"]);
});
