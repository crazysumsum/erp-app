import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { arHttpFixture, failure } from "../ar/arHttpFixture.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const PATH = "/api/v1/ar-opening-invoices";

integrationTest("期初發票保留舊號、防重，作廢可重登，核銷後帳齡歸零", async () => {
  const f = await arHttpFixture(), party = await f.customer();
  const openingReference = "0000_ " + randomUUID().slice(0, 8);
  const input = { customerId: party.id, currencyCode: "HKD", openingReference: ` ${openingReference} `, invoiceDate: f.day(-40), dueDate: f.day(-10), amount: "65.25", notes: "截數清單" };
  const register = (token, values = {}, eventId = randomUUID()) => f.send(PATH, { token, body: { ...input, ...values, eventId } });
  const lookup = (token, code = party.code) => f.send(`${PATH}/customer?code=${encodeURIComponent(code)}`, { token });
  assert.equal((await register(null)).status, 401);
  assert.equal((await register(f.biller.token)).status, 403);
  assert.equal((await lookup(null)).status, 401);
  assert.equal((await lookup(f.biller.token)).status, 403);

  await f.db.query("UPDATE customers SET status = 'inactive' WHERE id = ?", [party.id]);
  await f.db.query("DELETE rp FROM role_permissions rp JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?", [f.outsider.id]);
  await f.db.query(`INSERT INTO role_permissions (role_id, permission_id)
    SELECT ur.role_id, p.id FROM user_roles ur JOIN permissions p ON p.name = 'ar.opening.mgmt' WHERE ur.user_id = ?`, [f.outsider.id]);
  const services = f.application.services;
  const jwt = services.require("jwt"), subject = String(f.outsider.id);
  const version = await services.require("tokenRevocation").currentVersion(subject);
  const token = await jwt.issue({ roles: f.outsider.claims.roles, permissions: ["ar.opening.mgmt"] },
    { subject, version, authTime: Math.floor(Date.now() / 1000) });
  assert.deepEqual(f.ok(await lookup(token, party.code.toLowerCase())), {
    customerId: party.id, customerCode: party.code, customerName: party.name, active: false
  });
  assert.deepEqual(failure(await lookup(token, "NO-SUCH-CUSTOMER")), [409, "AR_CUSTOMER_NOT_FOUND", undefined]);

  assert.deepEqual(failure(await register(token, { amount: "65.251" })), [400, "AR_INPUT_INVALID", "amount"]);
  assert.deepEqual(failure(await register(token, { amount: "0" })), [400, "AR_INPUT_INVALID", "amount"]);
  assert.deepEqual(failure(await register(token, { openingReference: " " })), [400, "AR_INPUT_INVALID", "openingReference"]);
  assert.deepEqual(failure(await register(token, { dueDate: f.day(-41) })), [400, "AR_INPUT_INVALID", "dueDate"]);

  const event = randomUUID(), opened = f.ok(await register(token, {}, event));
  assert.match(opened.number, /^INV-\d{4}-\d{6}$/u);
  assert.deepEqual([opened.status, opened.version, opened.totalAmount, opened.replayed], ["CONFIRMED", 1, "65.2500", false]);
  assert.deepEqual([opened.customerCode, opened.customerName], [party.code, party.name]);
  assert.deepEqual(f.ok(await register(token, {}, event)), opened);
  assert.deepEqual(failure(await register(token, { openingReference })), [409, "AR_OPENING_REFERENCE_EXISTS", "openingReference"]);
  assert.equal(await f.count("ar_invoices WHERE opening_reference = ?", [openingReference]), 1);

  const read = async (id) => f.ok(await f.send(`/api/v1/ar-invoices/${id}`, { token: f.viewer.token }));
  const list = async () => f.ok(await f.send(`/api/v1/ar-invoices?q=${encodeURIComponent(` ${openingReference} `)}`, { token: f.viewer.token }));
  const aging = async () => f.ok(await f.send(`/api/v1/ar-aging?customerId=${party.id}&currencyCode=HKD`, { token: f.viewer.token }));
  const first = await read(opened.id);
  assert.deepEqual([first.openingReference, first.invoiceDate, first.dueDate, first.outstandingAmount, first.allocatedAmount, first.lines],
    [openingReference, input.invoiceDate, input.dueDate, "65.2500", "0.0000", []]);
  assert.deepEqual((await list()).items.map(({ openingReference: reference }) => reference), [openingReference]);
  const byNumber = f.ok(await f.send(`/api/v1/ar-invoices?q=${encodeURIComponent(` ${opened.number} `)}`, { token: f.viewer.token }));
  assert.deepEqual(byNumber.items.map(({ id }) => id), [opened.id]);
  assert.deepEqual((await aging()).items.map(({ invoiceCount, days1To30 }) => [invoiceCount, days1To30]), [[1, "65.2500"]]);

  const voided = f.ok(await f.invoicePost(`/${opened.id}/void`, { version: 1, reason: "期初餘額更正" }));
  assert.equal(voided.status, "VOID");
  assert.equal((await read(opened.id)).openingReference, openingReference);
  const replacement = f.ok(await register(token));
  assert.notEqual(replacement.number, opened.number);

  const receipt = await f.receipt(party, "65.25");
  const applied = f.ok(await f.post(`/${receipt.id}/allocations`, { version: 2, allocations: [{ invoiceId: replacement.id, amount: "65.25" }] }));
  assert.equal(applied.availableAmount, "0.0000");
  assert.equal((await f.read(receipt.id)).allocations[0].invoiceOpeningReference, openingReference);
  assert.equal((await read(replacement.id)).outstandingAmount, "0.0000");
  assert.deepEqual((await aging()).items, []);
  const [audit] = await f.db.query("SELECT target_id FROM ar_audit_logs WHERE customer_id = ? AND action = 'invoice.opening_registered' ORDER BY id", [party.id]);
  assert.deepEqual(audit.map(({ target_id }) => Number(target_id)), [opened.id, replacement.id]);
});
