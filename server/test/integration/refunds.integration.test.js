import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { arHttpFixture, failure } from "../ar/arHttpFixture.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

async function refundUser(f, user, permissions) {
  const subject = String(user.id);
  await f.db.query("DELETE rp FROM role_permissions rp JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?", [subject]);
  await f.db.query(`INSERT INTO role_permissions (role_id, permission_id)
    SELECT ur.role_id, p.id FROM user_roles ur JOIN permissions p ON p.name IN (?) WHERE ur.user_id = ?`, [permissions, subject]);
  const services = f.application.services, version = await services.require("tokenRevocation").currentVersion(subject);
  return services.require("jwt").issue({ roles: user.claims.roles, permissions },
    { subject, version, authTime: Math.floor(Date.now() / 1000) });
}

async function customerCredit(f, post, get) {
  const party = await f.customer();
  const invoice = await f.invoice(party, "40.0000", { currency: f.other, allocated: "40.0000" });
  const ref = randomUUID();
  await f.db.query("UPDATE ar_invoices SET opening_reference = ?, active_opening_reference = ? WHERE id = ?", [ref, ref, invoice]);
  const draft = f.ok(await post("/api/v1/ar-credit-notes", { invoiceId: invoice, creditDate: f.today, reason: "Synthetic opening credit", lines: [{ amount: "10" }] }));
  const path = `/api/v1/ar-credit-notes/${draft.id}`;
  f.ok(await post(path + "/confirm", { version: draft.version }));
  await f.db.query("UPDATE currencies SET status = 'INACTIVE' WHERE code = ?", [f.other]);
  await f.db.query("UPDATE customers SET status = 'inactive' WHERE id = ?", [party.id]);
  return { partyKey: "customerId", partyId: party.id, currency: f.other, credit: () => get(path) };
}

async function supplierCredit(f, post, get) {
  const code = `RFD-${randomUUID().slice(0, 8)}`;
  const now = Date.now();
  const [{ insertId: supplierId }] = await f.db.query("INSERT INTO suppliers SET ?", [{
    supplier_code: code, supplier_code_key: code.toLowerCase(), supplier_name: code, supplier_name_key: code.toLowerCase(),
    default_currency_code: "HKD", status: "active", created_at: now, updated_at: now
  }]);
  const [{ insertId: invoiceId }] = await f.db.query("INSERT INTO ap_invoices SET ?", [{
    invoice_number: code, status: "CONFIRMED", supplier_id: supplierId, supplier_code_snapshot: code, supplier_name_snapshot: code,
    currency_code: "HKD", currency_decimal_places: 2, supplier_invoice_number: code, invoice_date: f.today, due_date: f.today,
    total_amount: "40.0000", allocated_amount: "40.0000", outstanding_amount: "0.0000", created_by_label: "fixture", created_at: now, updated_at: now
  }]);
  const [{ insertId: invoiceLineId }] = await f.db.query(
    "INSERT INTO ap_invoice_lines (invoice_id, line_no, line_type, line_amount) VALUES (?, 1, 'EXPENSE', 40)", [invoiceId]);
  const draft = f.ok(await post("/api/v1/ap-credit-notes", {
    invoiceId: Number(invoiceId), creditDate: f.today, reason: "Synthetic supplier credit", lines: [{ invoiceLineId: Number(invoiceLineId), amount: "10" }]
  }));
  const path = `/api/v1/ap-credit-notes/${draft.id}`;
  f.ok(await post(path + "/confirm", { version: draft.version }));
  await f.db.query("UPDATE suppliers SET status = 'archived' WHERE id = ?", [supplierId]);
  return { partyKey: "supplierId", partyId: Number(supplierId), currency: "HKD", credit: () => get(path) };
}

for (const [side, base, number, makeCredit] of [
  ["AR", "/api/v1/ar-refunds", /^RFD-\d{4}-\d{6}$/u, customerCredit],
  ["AP", "/api/v1/ap-supplier-refunds", /^SRF-\d{4}-\d{6}$/u, supplierCredit]
]) {
  integrationTest(`${side} refund API creates from a real credit, serializes confirmations, and restores funds on void`, async () => {
    const f = await arHttpFixture();
    const area = side.toLowerCase();
    const token = await refundUser(f, f.outsider, [`${area}.view`, `${area}.credit.mgmt`, `${area}.refund.mgmt`]);
    const viewer = await refundUser(f, f.viewer, [`${area}.view`]);
    const post = (path, data, { auth = token, eventId = randomUUID() } = {}) => f.send(path, { token: auth, body: { eventId, ...data } });
    const get = (path, auth = token) => f.send(path, { token: auth });
    const { credit, partyKey, partyId, currency } = await makeCredit(f, post, get);
    const original = f.ok(await credit());
    assert.equal(original.availableAmount, "10.0000");
    const fields = { creditNoteId: original.id, refundDate: f.today, amount: "7.50", paymentMethod: "CHEQUE", reference: "Synthetic reference" };

    assert.equal((await post(base, fields, { auth: "" })).status, 401);
    assert.equal((await post(base, fields, { auth: viewer })).status, 403);
    assert.deepEqual(failure(await post(base, { ...fields, amount: "7.501" })), [400, "REFUND_INPUT_INVALID", "amount"]);
    const cancelled = f.ok(await post(base, fields));
    assert.equal(f.ok(await post(`${base}/${cancelled.id}/cancel`, { version: 1 })).status, "CANCELLED");

    const first = f.ok(await post(base, fields)), second = f.ok(await post(base, fields));
    assert.equal(f.ok(await credit()).availableAmount, "10.0000");
    const choices = [first, second].map(draft => ({ path: `${base}/${draft.id}`, eventId: randomUUID() }));
    const confirm = ({ path, eventId }) => post(path + "/confirm", { version: 1 }, { eventId });
    const attempts = await Promise.all(choices.map(confirm));
    assert.deepEqual(attempts.map(result => result.status).sort(), [200, 409]);
    assert.equal(attempts.find(result => result.status === 409).body.error.code, "REFUND_EXCEEDS_CREDIT");
    const winnerIndex = attempts.findIndex(result => result.status === 200);
    const winner = f.ok(attempts[winnerIndex]), { path } = choices[winnerIndex];
    assert.match(winner.number, number);
    assert.deepEqual(f.ok(await confirm(choices[winnerIndex])), winner);
    const atConfirmation = f.ok(await credit());
    assert.deepEqual([atConfirmation.availableAmount, atConfirmation.refundedAmount], ["2.5000", "7.5000"]);

    const detail = f.ok(await get(path));
    assert.deepEqual([detail[partyKey], detail.currencyCode, detail.amount, detail.reference, detail.creditNoteId], [partyId, currency, "7.5000", fields.reference, original.id]);
    assert.deepEqual(detail.allowedActions, ["void"]);
    assert.deepEqual(f.ok(await get(path, viewer)).allowedActions, []);
    assert.equal((await get(path, "")).status, 401);
    const [[audit]] = await f.db.query(`SELECT COUNT(*) AS count FROM ${area}_audit_logs WHERE target_type = 'REFUND'
      AND target_id = ? AND action = 'refund.confirmed'`, [winner.id]);
    assert.equal(Number(audit.count), 1);
    const list = f.ok(await get(`${base}?creditNoteId=${original.id}&status=CONFIRMED`));
    assert.deepEqual(list.items.map(item => item.id), [winner.id]);
    assert.deepEqual(failure(await post(path + "/void", { version: 1, reason: "Synthetic correction" })).slice(0, 2), [409, "VERSION_CONFLICT"]);
    const voided = f.ok(await post(path + "/void", { version: winner.version, reason: "Synthetic correction" }));
    assert.deepEqual([voided.status, voided.number], ["VOID", winner.number]);
    const restored = f.ok(await credit());
    assert.deepEqual([restored.availableAmount, restored.refundedAmount], ["10.0000", "0.0000"]);
  });
}
