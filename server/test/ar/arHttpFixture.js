/**
 * AR 整合測試共用的 HTTP fixture（真 application、真 JWT、真 MySQL），每個測試檔建立一次。
 * 4 名用戶（clerk：ar.view＋ar.receipt.mgmt；biller：ar.view＋ar.invoice.mgmt；viewer：ar.view；outsider：ar.invoice.mgmt）、
 * 1 個測試幣別（另用已有的 HKD）；客戶及發票由各案按需以 SQL 建立。完結時刪走用戶及角色、關 application；
 * 客戶、幣別及 AR 單據留在私人 DB（Audit 不可刪）。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applyLegacyFulfillmentMigrations } from "../fulfillment/applyLegacyFulfillmentMigrations.js";
import { after } from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { ShipmentConfirmationService } from "../../src/modules/fulfillment/ShipmentConfirmationService.js";
import { shipmentDraftFixture } from "../fulfillment/p1CancellationFixture.js";
import { secondShipment } from "./arShipmentFixture.js";

async function runCleanups(cleanups) {
  const errors = [];
  for (const cleanup of [...cleanups].reverse()) {
    try { await cleanup(); } catch (error) { errors.push(error); }
  }
  return errors;
}

let shared = null;

async function setup(database = {}, company) {
  const cleanups = [];
  const source = defaultConfigurationSource();
  // 這個檔案的請求數超過預設的每 IP 流量上限；同 supplierHttpHarness 一樣只放寬這一項。
  const application = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 },
    ...(company ? { company } : {}),
    database: { ...source.database, ...database },
    requestLimiter: { ...source.requestLimiter, maxRequestsPerIpPerWindow: 100_000 } } });
  cleanups.push(() => application.shutdown("ar_integration_complete"));
  try {
    const db = application.services.require("mysqldatabase"), jwt = application.services.require("jwt"), time = application.services.require("time");
    const tag = randomUUID().replaceAll("-", "").slice(0, 12), now = Date.now();
    const insert = async (table, row) => Number((await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
    const person = async (suffix, permissions) => {
      const name = `ar_${suffix}_${tag}`, role = await insert("roles", { name, created_at: now });
      cleanups.push(() => db.query("DELETE FROM roles WHERE id = ?", [role]), () => db.query("DELETE FROM role_permissions WHERE role_id = ?", [role]));
      for (const permission of permissions) await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [role, permission]);
      const id = await insert("users", { username: name, password_hash: "synthetic", display_name: `User ${suffix}`, created_at: now, updated_at: now });
      cleanups.push(() => db.query("DELETE FROM users WHERE id = ?", [id]), () => db.query("DELETE FROM fr_token_versions WHERE subject = ?", [String(id)]),
        () => db.query("DELETE FROM user_roles WHERE user_id = ?", [id]));
      await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [id, role]);
      const version = await application.services.require("tokenRevocation").currentVersion(String(id));
      const claims = { sub: String(id), roles: [name], permissions };
      return { id, username: name, claims, token: await jwt.issue({ roles: [name], permissions }, { subject: String(id), version, authTime: Math.floor(now / 1000) }) };
    };
    const clerk = await person("clerk", ["ar.view", "ar.receipt.mgmt"]), biller = await person("biller", ["ar.invoice.mgmt", "ar.view"]);
    const viewer = await person("viewer", ["ar.view"]), outsider = await person("outsider", ["ar.invoice.mgmt"]);

    // 第二個幣別：一個未被使用的代碼，小數位 2。
    let other;
    do {
      other = `X${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
    } while ((await db.query("SELECT code FROM currencies WHERE code = ?", [other]))[0].length);
    await insert("currencies", { code: other, name: "AR Probe", decimal_places: 2, status: "ACTIVE", version: 1, created_at: now, updated_at: now });

    let customers = 0;
    const customer = async () => {
      const code = `AR-${tag}-${++customers}`;
      return { id: await insert("customers", { customer_code: code, customer_code_key: code.toLowerCase(), legal_name: `AR Customer ${code}`, legal_name_key: code.toLowerCase(),
        default_currency_code: "HKD", status: "active", version: 1, created_at: now, updated_at: now }), code, name: `AR Customer ${code}` };
    };
    const today = time.fileDate(time.at(time.nowMs()));
    const day = (offset) => new Date(Date.parse(`${today}T00:00:00.000Z`) + offset * 86400000).toISOString().slice(0, 10);
    let invoices = 0;
    /** SQL fixture：一張已確認發票；dueOffset 是到期日相對今日的日數（負數即已逾期）。 */
    const invoice = async (party, total, { currency = "HKD", status = "CONFIRMED", dueOffset = 30, allocated = "0.0000" } = {}) => {
      const due = day(dueOffset), issued = day(Math.min(dueOffset, 0) - 1);
      return insert("ar_invoices", { invoice_number: status === "DRAFT" ? null : `T${tag}${String(++invoices).padStart(4, "0")}`, status, customer_id: party.id,
        customer_code_snapshot: party.code, customer_name_snapshot: party.name, currency_code: currency, currency_decimal_places: 2, invoice_date: issued, due_date: due,
        total_amount: total, allocated_amount: allocated, outstanding_amount: (Number(total) - Number(allocated)).toFixed(4), created_by_label: "fixture",
        created_at: now, updated_at: now });
    };

    const { url } = await application.start();
    const send = async (path, { token, body, method = body ? "POST" : "GET", key = body?.eventId } = {}) => {
      const response = await fetch(`${url}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { "Idempotency-Key": key } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    const post = (path, fields, token = clerk.token, eventId = randomUUID()) => send(`/api/v1/ar-receipts${path}`, { token, body: { eventId, ...fields } });
    const invoicePost = (path, fields, token = biller.token, eventId = randomUUID()) => send(`/api/v1/ar-invoices${path}`, { token, body: { eventId, ...fields } });
    const ok = (result) => { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.data; };
    const draft = async (party, amount, fields = {}) => ok(await post("", { customerId: party.id, currencyCode: "HKD", receiptDate: today, amount, paymentMethod: "BANK_TRANSFER", ...fields }));
    /** 一筆已確認的收款（version 2）。 */
    const receipt = async (party, amount, fields) => {
      const created = await draft(party, amount, fields);
      return ok(await post(`/${created.id}/confirm`, { version: 1 }));
    };
    const read = async (id, token = clerk.token) => ok(await send(`/api/v1/ar-receipts/${id}`, { token }));
    const invoiceRow = async (id) => (await db.query("SELECT status, total_amount, allocated_amount, outstanding_amount, version FROM ar_invoices WHERE id = ?", [id]))[0][0];
    const count = async (sql, values) => Number((await db.query(`SELECT COUNT(*) AS total FROM ${sql}`, values))[0][0].total);
    return { application, db, cleanups, url, send, post, invoicePost, ok, draft, receipt, read, invoice, invoiceRow, customer, count, clerk, biller, viewer, outsider, other, today, day };
  } catch (error) {
    const cleanupErrors = await runCleanups(cleanups);
    throw cleanupErrors.length ? new AggregateError([error, ...cleanupErrors], "AR fixture setup failed and its cleanup also failed") : error;
  }
}
/** 發票確認案例使用真實出貨，application 與 Fulfillment 共用隔離庫。 */
export async function arHttpShipmentFixture(t, { includeSecond = false, withBillingAddress = true, company } = {}) {
  const cleanups = [];
  t.after(async () => {
    const errors = await runCleanups(cleanups);
    if (errors.length) throw new AggregateError(errors, "AR shipment fixture cleanup failed");
  });
  const shipment = await shipmentDraftFixture({ after: (cleanup) => cleanups.push(cleanup) });
  if (withBillingAddress) {
    await shipment.s.insert("customer_address_purposes", { address_id: shipment.s.addressId, customer_id: shipment.s.customerId,
      purpose_code: "billing", is_default: 1, created_at: shipment.s.now, updated_at: shipment.s.now });
  }
  await applyLegacyFulfillmentMigrations(shipment.db, [92, 93, 95, 96, 98]);
  await shipment.db.query("UPDATE sales_order_lines SET unit_selling_price = 40, line_amount = 200 WHERE id = ?", [shipment.s.lineId]);
  const first = (await shipment.create(shipment.body())).outcome.id;
  const shipmentIds = [first];
  if (includeSecond) shipmentIds.push(await secondShipment(shipment));
  const confirmation = new ShipmentConfirmationService(shipment.options);
  for (const id of shipmentIds) {
    const completed = await shipment.execute(async () =>
      confirmation.completeConfirmation(await confirmation.startConfirmation(id, { eventId: randomUUID(), version: 1 })));
    assert.equal(completed.outcome, "SHIPPED");
  }
  const [[party]] = await shipment.db.query("SELECT id, customer_code AS code, legal_name AS name FROM customers WHERE id = ?", [shipment.s.customerId]);
  const [[{ currency_code: currencyCode }]] = await shipment.db.query("SELECT currency_code FROM sales_orders WHERE id = ?", [shipment.s.orderId]);
  const http = await setup({ ...shipment.f.connectionOptions, database: shipment.f.name }, company);
  cleanups.push(...http.cleanups);
  return { ...http, party, currencyCode, shipmentIds: shipmentIds.map(Number) };
}

export const arHttpFixture = () => (shared ??= setup());
after(async () => {
  if (!shared) return;
  let state;
  try { state = await shared; } catch { return; }
  const errors = await runCleanups(state.cleanups);
  if (errors.length) throw new AggregateError(errors, "AR fixture cleanup failed");
});

/** [HTTP status, 錯誤碼, 欄位]。 */
export const failure = (result) => [result.status, result.body.error?.code, result.body.error?.details?.field];
