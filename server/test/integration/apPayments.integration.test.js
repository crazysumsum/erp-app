import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const base = "/api/v1/ap-payments";
let shared;
let application;
const identities = [];

after(async () => {
  if (!application) return;
  const db = application.services.require("mysqldatabase");
  try {
    for (const { userId, roleId } of identities) {
      if (userId) {
        await db.query("DELETE FROM user_roles WHERE user_id = ?", [userId]);
        await db.query("DELETE FROM fr_token_versions WHERE subject = ?", [String(userId)]);
        await db.query("DELETE FROM users WHERE id = ?", [userId]);
      }
      await db.query("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
      await db.query("DELETE FROM roles WHERE id = ?", [roleId]);
    }
  } finally {
    await application.shutdown("ap_integration_complete");
  }
});

function fixture() {
  return shared ??= setup();
}

async function setup() {
  const source = defaultConfigurationSource();
  application = await createApplication({ configurationSource: {
    ...source, application: { ...source.application, port: 0 },
    requestLimiter: { ...source.requestLimiter, maxRequestsPerIpPerWindow: 100 }
  } });
  const db = application.services.require("mysqldatabase");
  const time = application.services.require("time");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const now = time.nowMs(), today = time.fileDate(time.at(now));
  const insert = async (table, columns) => Number((await db.query(`INSERT INTO ${table} SET ?`, [columns]))[0].insertId);

  const person = async (role, permissions) => {
    const name = `ap_${role}_${tag}`;
    const roleId = await insert("roles", { name, created_at: now });
    const identity = { roleId };
    identities.push(identity);
    for (const permission of permissions) {
      await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [roleId, permission]);
    }
    const userId = await insert("users", { username: name, password_hash: "synthetic", display_name: name, created_at: now, updated_at: now });
    identity.userId = userId;
    await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
    const version = await application.services.require("tokenRevocation").currentVersion(String(userId));
    const claims = { sub: String(userId), roles: [name], permissions };
    const token = await application.services.require("jwt").issue({ roles: claims.roles, permissions }, {
      subject: claims.sub, version, authTime: Math.floor(now / 1000)
    });
    return { claims, token };
  };
  const payer = await person("payer", ["ap.payment.mgmt", "ap.view"]);
  const viewer = await person("viewer", ["ap.view"]);
  const invoiceManager = await person("biller", ["ap.invoice.mgmt"]);
  const { url } = await application.start();

  const request = async (path, { token = payer.token, input, key = input?.eventId } = {}) => {
    const response = await fetch(url + path, {
      method: input ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(input ? { "Content-Type": "application/json", "Idempotency-Key": key } : {})
      },
      body: input ? JSON.stringify(input) : undefined
    });
    const body = await response.json();
    return { status: response.status, body };
  };
  const post = (path, fields, options) => request(base + path, { input: { eventId: randomUUID(), ...fields }, ...options });
  const day = (offset) => new Date(Date.parse(`${today}T00:00:00.000Z`) + offset * 86400000).toISOString().slice(0, 10);
  let nextSupplier = 0, nextInvoice = 0;
  const supplier = async (status = "active") => {
    const code = `AP-${tag}-${++nextSupplier}`;
    const id = await insert("suppliers", { supplier_code: code, supplier_code_key: code.toLowerCase(), supplier_name: code,
      supplier_name_key: code.toLowerCase(), status, default_currency_code: "HKD", created_at: now, updated_at: now });
    return { id, code };
  };
  const invoice = (party, total, { due = 0, status = "CONFIRMED", currency = "HKD" } = {}) => {
    const number = `AP-${tag}-${++nextInvoice}`;
    return insert("ap_invoices", {
      invoice_number: status === "DRAFT" ? null : number, status, supplier_id: party.id,
      supplier_code_snapshot: party.code, supplier_name_snapshot: party.code, currency_code: currency,
      currency_decimal_places: 2, supplier_invoice_number: number, invoice_date: day(Math.min(due, 0) - 1),
      due_date: day(due), total_amount: total, outstanding_amount: total, created_by_label: "fixture", created_at: now, updated_at: now
    });
  };
  const draft = (party, amount, fields = {}, options) => post("", {
    supplierId: party.id, currencyCode: "HKD", paymentDate: today, amount, paymentMethod: "BANK_TRANSFER", ...fields
  }, options);
  const read = (id, options) => request(`${base}/${id}`, options);
  const aging = (party) => request(`/api/v1/ap-aging?supplierId=${party.id}`);
  return { db, request, post, payer, viewer: viewer.token, invoiceManager: invoiceManager.token, today, day, supplier, invoice, draft, read, aging };
}

function ok(result) {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.data;
}

function error(result, status, code) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  if (code) assert.equal(result.body.error.code, code);
}

integrationTest("AP records payment against an archived supplier, replays commands, and retains void history", async () => {
  const f = await fixture();
  const party = await f.supplier("archived");
  const eventId = randomUUID();
  const created = ok(await f.draft(party, "217.50", { eventId, reference: "WIRE-1" }));
  assert.deepEqual([created.status, created.version, created.number, created.replayed], ["DRAFT", 1, null, false]);
  assert.deepEqual(ok(await f.draft(party, "217.50", { eventId, reference: "WIRE-1" })), created);
  const { apPaymentService } = await import("../../src/handlers/accounts-payable/apSchemas.js");
  const service = apPaymentService(application.services);
  const input = { eventId, supplierId: party.id, currencyCode: "HKD", paymentDate: f.today,
    amount: "217.50", paymentMethod: "BANK_TRANSFER", reference: "WIRE-1" };
  assert.deepEqual(await service.create({ claims: f.payer.claims, input }), { ...created, replayed: true });
  await assert.rejects(service.create({ claims: f.payer.claims, input: { ...input, amount: "217.51" } }), { code: "AP_EVENT_CONFLICT" });
  const confirmed = ok(await f.post(`/${created.id}/confirm`, { version: 1 }));
  assert.match(confirmed.number, /^PMT-\d{4}-\d{6}$/u);
  const invoice = await f.invoice(party, "217.5000");
  const allocated = ok(await f.post(`/${created.id}/allocations`, {
    version: 2, allocations: [{ invoiceId: invoice, amount: "217.50" }]
  }));
  error(await f.post(`/${created.id}/void`, { version: 3, reason: "duplicate transfer" }), 409, "AP_PAYMENT_HAS_ALLOCATIONS");
  ok(await f.post(`/${created.id}/allocations/${allocated.allocationIds[0]}/unapply`, { version: 3 }));
  ok(await f.post(`/${created.id}/void`, { version: 4, reason: "duplicate transfer" }));
  const detail = ok(await f.read(created.id));
  assert.deepEqual([detail.status, detail.number, detail.amount, detail.availableAmount, detail.allocations[0].status],
    ["VOID", confirmed.number, "217.5000", "0.0000", "UNAPPLIED"]);
  assert.equal(ok(await f.request(`${base}?supplierId=${party.id}&status=VOID&q=WIRE`)).total, 1);
});

integrationTest("AP allocation is atomic across invoices and later spends prepayments by supplier and currency", async () => {
  const f = await fixture();
  const party = await f.supplier();
  const other = await f.supplier();
  const a = await f.invoice(party, "225.0000", { due: -30 });
  const b = await f.invoice(party, "100.0000", { due: -31 });
  const wrongSupplier = await f.invoice(other, "100.0000");
  const code = "XAP";
  await f.db.query("INSERT IGNORE INTO currencies (code, name, decimal_places, status, created_at, updated_at) VALUES (?, 'AP synthetic FX', 2, 'ACTIVE', 1, 1)", [code]);
  const wrongCurrency = await f.invoice(party, "100.0000", { currency: code });
  const { id } = ok(await f.draft(party, "325.00"));
  ok(await f.post(`/${id}/confirm`, { version: 1 }));
  const apply = (version, allocations) => f.post(`/${id}/allocations`, { version, allocations });
  error(await apply(2, [{ invoiceId: a, amount: "225.00" }, { invoiceId: wrongSupplier, amount: "10.00" }]), 409, "AP_PARTY_MISMATCH");
  error(await apply(2, [{ invoiceId: wrongCurrency, amount: "10.00" }]), 409, "AP_PARTY_MISMATCH");
  assert.equal(ok(await f.read(id)).allocations.length, 0);
  const hkdAging = () => f.request(`/api/v1/ap-aging?supplierId=${party.id}&currencyCode=HKD`);
  assert.deepEqual(ok(await hkdAging()).items.map((row) => [row.days1To30, row.days31To60]),
    [["225.0000", "100.0000"]]);
  assert.deepEqual(new Set(ok(await f.aging(party)).totals.map((row) => row.currencyCode)), new Set(["HKD", code]));
  const partly = ok(await apply(2, [{ invoiceId: b, amount: "75.00" }, { invoiceId: a, amount: "225.00" }]));
  assert.equal(partly.availableAmount, "25.0000");
  assert.equal(ok(await hkdAging()).items[0].total, "25.0000");
  const last = ok(await apply(3, [{ invoiceId: b, amount: "25.00" }]));
  assert.equal(last.availableAmount, "0.0000");
  assert.deepEqual(ok(await hkdAging()).items, []);
  error(await apply(3, [{ invoiceId: b, amount: "1.00" }]), 409, "VERSION_CONFLICT");
});

integrationTest("two payments competing for the same open invoice cannot allocate it twice", async () => {
  const f = await fixture();
  const party = await f.supplier();
  const invoiceId = await f.invoice(party, "20.0000");
  const first = ok(await f.draft(party, "20.00"));
  const second = ok(await f.draft(party, "20.00"));
  for (const { id } of [first, second]) ok(await f.post(`/${id}/confirm`, { version: 1 }));
  const results = await Promise.all([first, second].map(({ id }) => f.post(`/${id}/allocations`, {
    version: 2, allocations: [{ invoiceId, amount: "20.00" }]
  })));
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
  error(results.find(({ status }) => status === 409), 409, "AP_ALLOCATION_EXCEEDS_OUTSTANDING");
  assert.deepEqual(ok(await f.aging(party)).items, []);
  const [[{ allocations }]] = await f.db.query("SELECT COUNT(*) AS allocations FROM ap_payment_allocations WHERE invoice_id = ?", [invoiceId]);
  assert.equal(Number(allocations), 1);
});

integrationTest("AP payment permissions, currency precision and aging totals above a single document limit", async () => {
  const f = await fixture();
  const party = await f.supplier();
  error(await f.draft(party, "10.00", {}, { token: f.viewer }), 403);
  error(await f.draft(party, "10.00", {}, { token: f.invoiceManager }), 403);
  error(await f.request(base, { token: f.invoiceManager }), 403);
  error(await f.draft(party, "10.001"), 400, "AP_INPUT_INVALID");
  error(await f.draft(party, "10", { paymentDate: f.day(1) }), 409, "AP_DATE_IN_FUTURE");
  const draft = ok(await f.draft(party, "30.00"));
  ok(await f.post(`/${draft.id}/cancel`, { version: 1 }));
  assert.deepEqual(ok(await f.read(draft.id, { token: f.viewer })).allowedActions, []);
  await f.invoice(party, "999999999999999.9900", { due: -61 });
  await f.invoice(party, "999999999999999.9900", { due: -91 });
  const report = ok(await f.aging(party));
  assert.deepEqual(report.items.map((row) => [row.days61To90, row.over90, row.total]),
    [["999999999999999.9900", "999999999999999.9900", "1999999999999999.9800"]]);
  assert.equal(report.totals[0].total, "1999999999999999.9800");
});
