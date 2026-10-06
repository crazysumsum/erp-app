import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { migrationFixture, createTestCurrency } from "../sales/phase1/fixtures.js";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { formatDateForFile } from "../../src/services/time/timeFormat.js";
import { SalesAuditService } from "../../src/modules/sales/SalesAuditService.js";
import { SalesQuotationService } from "../../src/modules/sales/SalesQuotationService.js";
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

async function setup(t) {
  const f = await migrationFixture(t, []);
  const source = defaultConfigurationSource();
  const app = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 } } });
  t.after(() => app.shutdown("sales_phase1_commands_complete"));
  const database = app.services.require("mysqldatabase"), time = app.services.require("time"), logger = app.services.require("logging").logger;
  const username = `sales-p1-${randomUUID().slice(0, 8)}`, roleName = `${username}-role`;
  const roleId = await f.insert("roles", { name: roleName, created_at: f.now });
  const userId = await f.insert("users", { username, password_hash: "test-only", display_name: "Sales native probe", created_at: f.now, updated_at: f.now });
  await f.db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [userId, roleId]);
  for (const permission of ["sales.view", "sales.mgmt"]) await f.db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [roleId, permission]);
  f.beforeParents.push(async () => {
    await f.db.execute("DELETE FROM sales_quotation_conversions WHERE quotation_id IN (SELECT id FROM sales_quotations WHERE customer_id=?)", [f.customerId]);
    await f.db.execute("DELETE FROM sales_orders WHERE customer_id=?", [f.customerId]);
    await f.db.execute("DELETE FROM sales_audit_logs WHERE actor_user_id=?", [userId]);
    await f.db.execute("DELETE FROM sales_operation_requests WHERE actor_user_id=?", [userId]);
    await f.db.execute("DELETE FROM sales_quotations WHERE customer_id=?", [f.customerId]);
    await f.db.execute("DELETE FROM fr_token_versions WHERE subject=?", [String(userId)]);
    await f.db.execute("DELETE FROM user_roles WHERE user_id=?", [userId]);
    await f.db.execute("DELETE FROM role_permissions WHERE role_id=?", [roleId]);
  });
  await f.db.execute("UPDATE currencies SET status='ACTIVE' WHERE code=?", [f.currency]);
  await f.db.execute("UPDATE item_skus SET sellable=1, suggested_price_amount='3.3333' WHERE id=?", [f.skuId]);
  const claims = { actorId: userId, claimedRoles: [roleName], claimedPermissions: ["sales.mgmt", "sales.view"] };
  const quotation = new SalesQuotationService({ database, time, logger });
  const input = () => ({ eventId: randomUUID(), customerId: f.customerId, currencyCode: f.currency, quotationDate: formatDateForFile(new Date(f.now), "Asia/Hong_Kong"), validUntil: formatDateForFile(new Date(f.now + 30 * 86400000), "Asia/Hong_Kong"),
    notes: "Synthetic", lines: [{ skuId: f.skuId, skuUomId: f.skuUomId, quantity: "2.000000", unitSellingPrice: "3.3333" }] });
  return { ...f, app, database, time, logger, claims, quotation, input, userId, roleId };
}

integrationTest("TC-011 Quotation Draft creates merged exact amounts and snapshots without Inventory effects", async t => {
  const f = await setup(t), input = f.input(); input.lines.push({ ...input.lines[0] });
  const created = await f.quotation.create({ claims: f.claims, input });
  assert.equal(created.quotation.status, "DRAFT");
  assert.equal(created.quotation.totalAmount, "13.3332");
  assert.equal(created.quotation.lines.length, 1);
  assert.equal(created.quotation.lines[0].quantity, "4.000000");
  assert.equal(created.quotation.lines[0].baseQuantity, 4);
  assert.equal(created.quotation.customerId, f.customerId);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_reservations WHERE sku_id=?", [f.skuId]))[0][0].n, 0);
  const replay = await f.quotation.create({ claims: f.claims, input });
  assert.deepEqual(replay.operation, created.operation);
  assert.equal(replay.quotation.id, created.quotation.id);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_audit_logs WHERE actor_user_id=?", [f.userId]))[0][0].n, 1);
});
integrationTest("TC-011 Quotation simultaneous event replay reads the committed document under REPEATABLE READ", async t => {
  const f = await setup(t), input = f.input();
  const results = await Promise.all([f.quotation.create({ claims: f.claims, input }), f.quotation.create({ claims: f.claims, input })]);
  assert.deepEqual(results[0].operation, results[1].operation);
  assert.equal(results[0].quotation.id, results[1].quotation.id);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_quotations WHERE customer_id=?", [f.customerId]))[0][0].n, 1);
});

integrationTest("TC-018 Quotation submit revalidates actual Customer, Currency, SKU and UOM after lookup", async t => {
  const f = await setup(t);
  for (const [table, key, value, invalid, restored, code] of [
    ["customers", "id", f.customerId, "blocked", "active", "CUSTOMER_NOT_SALEABLE"],
    ["currencies", "code", f.currency, "INACTIVE", "ACTIVE", "SALES_INPUT_INVALID"],
    ["item_skus", "id", f.skuId, "inactive", "active", "SKU_NOT_SALEABLE"],
    ["item_uoms", "id", (await f.db.query("SELECT uom_id FROM item_sku_uoms WHERE id=?", [f.skuUomId]))[0][0].uom_id, "inactive", "active", "SKU_UOM_INVALID"]]) {
    await f.db.execute(`UPDATE ${table} SET status=? WHERE ${key}=?`, [invalid, value]);
    await assert.rejects(() => f.quotation.create({ claims: f.claims, input: f.input() }), { code });
    await f.db.execute(`UPDATE ${table} SET status=? WHERE ${key}=?`, [restored, value]);
  }
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_quotations WHERE customer_id=?", [f.customerId]))[0][0].n, 0);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE actor_user_id=?", [f.userId]))[0][0].n, 0);
});

integrationTest("TC-017 Quotation optimistic race admits one edit and returns only currentVersion to the stale editor", async t => {
  const f = await setup(t), created = await f.quotation.create({ claims: f.claims, input: f.input() });
  const edit = label => f.quotation.update({ claims: f.claims, id: created.quotation.id, input: { ...f.input(), version: 1, notes: label } });
  const results = await Promise.allSettled([edit("Editor A"), edit("Editor B")]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const conflict = results.find(result => result.status === "rejected").reason;
  assert.equal(conflict.code, "VERSION_CONFLICT");
  assert.deepEqual(conflict.publicDetails, { currentVersion: 2 });
  assert.equal((await f.db.query("SELECT version FROM sales_quotations WHERE id=?", [created.quotation.id]))[0][0].version, 2);
});

integrationTest("TC-012 Quotation update rejects foreign IDs on merged-away duplicate lines without effects", async t => {
  const f = await setup(t);
  const original = await f.quotation.create({ claims: f.claims, input: f.input() });
  const foreign = await f.quotation.create({ claims: f.claims, input: f.input() });
  for (const ownId of [original.quotation.lines[0].id, undefined]) {
    const input = { ...f.input(), version: 1 };
    input.lines = [{ ...input.lines[0], ...(ownId === undefined ? {} : { id: ownId }) },
      { ...input.lines[0], id: foreign.quotation.lines[0].id }];
    await assert.rejects(() => f.quotation.update({ claims: f.claims, id: original.quotation.id, input }), { code: "SALES_INPUT_INVALID" });
  }
  const [[row]] = await f.db.query("SELECT version,total_amount FROM sales_quotations WHERE id=?", [original.quotation.id]);
  assert.equal(row.version, 1); assert.equal(row.total_amount, original.quotation.totalAmount);
  const [[line]] = await f.db.query("SELECT id,quantity FROM sales_quotation_lines WHERE quotation_id=?", [original.quotation.id]);
  assert.equal(Number(line.id), original.quotation.lines[0].id); assert.equal(line.quantity, "2.000000");
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_audit_logs WHERE actor_user_id=?", [f.userId]))[0][0].n, 2);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE actor_user_id=?", [f.userId]))[0][0].n, 2);
});

integrationTest("TC-012 Quotation atomic rollback, Draft-only guard and fresh authorization protect replay", async t => {
  const f = await setup(t), request = f.input();
  const quotation = new SalesQuotationService({ database: f.database, time: f.time, logger: f.logger,
    audit: { async record() { throw new Error("required audit failure probe"); } } });
  await assert.rejects(() => quotation.create({ claims: f.claims, input: request }), error => error.cause?.message === "required audit failure probe");
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_quotations WHERE customer_id=?", [f.customerId]))[0][0].n, 0);
  const created = await f.quotation.create({ claims: f.claims, input: request });
  await f.db.execute("UPDATE item_skus SET status='inactive' WHERE id=?", [f.skuId]);
  assert.equal((await f.quotation.create({ claims: f.claims, input: request })).quotation.id, created.quotation.id);
  await f.db.execute("UPDATE sales_quotations SET status='ISSUED' WHERE id=?", [created.quotation.id]);
  await assert.rejects(() => f.quotation.update({ claims: f.claims, id: created.quotation.id, input: { ...f.input(), version: 1 } }), { code: "QUOTATION_STATE_CONFLICT" });
  await f.db.execute("DELETE FROM role_permissions WHERE role_id=?", [f.roleId]);
  await assert.rejects(() => f.quotation.create({ claims: f.claims, input: request }), { code: "PERMISSION_STALE" });
});

integrationTest("TC-011/012 Quotation HTTP contracts preserve decimal types and reject stale authorization on framework replay", async t => {
  const f = await setup(t);
  const version = await f.app.services.require("tokenRevocation").currentVersion(String(f.userId));
  const token = await f.app.services.require("jwt").issue({ roles: f.claims.claimedRoles, permissions: f.claims.claimedPermissions },
    { subject: String(f.userId), version, authTime: Math.floor(f.now / 1000) });
  const { url } = await f.app.start();
  async function request(path, body, key = randomUUID()) {
    const response = await fetch(`${url}${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json", "Idempotency-Key": key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await request("/api/v1/user/me")).status, 200);
  const input = f.input(), key = randomUUID();
  const created = await request("/api/v1/sales-quotations/create", input, key);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.data.quotation.totalAmount, "6.6666");
  for (const invalid of [{ ...f.input(), status: "ISSUED" }, { ...f.input(), lines: [{ ...input.lines[0], unitSellingPrice: 3.3333 }] }]) {
    const result = await request("/api/v1/sales-quotations/create", invalid);
    assert.equal(result.status, 400, JSON.stringify(result.data));
    assert.equal(result.data.error.code, "SALES_INPUT_INVALID");
  }
  const replay = await request("/api/v1/sales-quotations/create", input, key);
  assert.deepEqual(replay.data.data.operation, created.data.data.operation);
  const editInput = { ...f.input(), version: 1, lines: [{ ...input.lines[0], id: created.data.data.quotation.lines[0].id, quantity: "3.000000" }] };
  const updated = await request(`/api/v1/sales-quotations/${created.data.data.quotation.id}/update`, editInput);
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.data.quotation.totalAmount, "9.9999");
  const stale = await request(`/api/v1/sales-quotations/${created.data.data.quotation.id}/update`, { ...editInput, eventId: randomUUID() });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.data.error.details, { currentVersion: 2 });
  const issueInput = { eventId: randomUUID(), version: 2 };
  const issued = await request(`/api/v1/sales-quotations/${created.data.data.quotation.id}/issue`, issueInput);
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
  const order = orderInput(f), conversionKey = randomUUID(), conversionEvent = order.eventId;delete order.eventId;
  const conversionInput = { eventId: conversionEvent, version: 3, order };
  const conversionPath = `/api/v1/sales-quotations/${created.data.data.quotation.id}/convert`;
  const converted = await request(conversionPath, conversionInput, conversionKey);
  assert.equal(converted.status, 201, JSON.stringify(converted.data));
  assert.equal(converted.data.data.salesOrder.status, "DRAFT");
  assert.deepEqual((await request(conversionPath, conversionInput, conversionKey)).data.data.salesOrder, converted.data.data.salesOrder);
  const detail = await request(`/api/v1/sales-quotations/${created.data.data.quotation.id}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.deepEqual(detail.data.data.allowedActions, ["print"]);
  assert.equal(detail.data.data.conversion.salesOrderId, converted.data.data.salesOrder.id);
  assert.equal(detail.data.data.conversion.salesOrderNumber, converted.data.data.salesOrder.number);
  assert.deepEqual(detail.data.data.conversion.differenceSummary, converted.data.data.differenceSummary);
  const listed = await request(`/api/v1/sales-quotations?customerId=${f.customerId}&page=1&pageSize=1&descending=false&status=CONVERTED`);
  assert.equal(listed.status, 200, JSON.stringify(listed.data));
  assert.equal(listed.data.data.total, 1);assert.equal(listed.data.data.items[0].id, detail.data.data.id);
  for (const query of ["pageSize=101", "sortBy=number%3BDROP", "unexpected=1", "validUntilFrom=2026-02-30"])
    assert.equal((await request(`/api/v1/sales-quotations?${query}`)).status, 400);
  await f.db.execute("UPDATE users SET status='inactive' WHERE id=?", [f.userId]);
  assert.equal((await request(conversionPath, conversionInput, conversionKey)).status, 403);
  assert.equal((await request("/api/v1/sales-quotations/create", input, key)).status, 403);
  await f.db.execute("UPDATE users SET status='active' WHERE id=?", [f.userId]);
  await f.db.execute("DELETE FROM role_permissions WHERE role_id=?", [f.roleId]);
  assert.equal((await request("/api/v1/sales-quotations/create", input, key)).status, 403);
});

function orderInput(f, quotationInput = f.input()) {
  return { eventId: randomUUID(), customerId: f.customerId, currencyCode: f.currency, fulfillmentWarehouseId: f.warehouseId,
    orderDate: quotationInput.quotationDate, lines: quotationInput.lines.map(({ id: _id, ...line }) => line) };
}
integrationTest("TC-014 Quotation issue revalidates masters/date and lifecycle replays audit once", async t => {
  const f = await setup(t), created = await f.quotation.create({ claims: f.claims, input: f.input() });
  await f.db.execute("UPDATE item_skus SET status='inactive' WHERE id=?", [f.skuId]);
  const issue = { eventId: randomUUID(), version: 1 };
  await assert.rejects(() => f.quotation.issue({ claims: f.claims, id: created.quotation.id, input: issue }), { code: "SKU_NOT_SALEABLE" });
  await f.db.execute("UPDATE item_skus SET status='active' WHERE id=?", [f.skuId]);
  const issued = await f.quotation.issue({ claims: f.claims, id: created.quotation.id, input: issue });
  assert.equal(issued.quotation.status, "ISSUED"); assert.equal(issued.quotation.version, 2);
  assert.deepEqual((await f.quotation.issue({ claims: f.claims, id: created.quotation.id, input: issue })).operation, issued.operation);
  await assert.rejects(() => f.quotation.cancel({ claims: f.claims, id: created.quotation.id, input: { eventId: randomUUID(), version: 2, reason: "bad" } }), { code: "SALES_INPUT_INVALID" });
  const cancel = { eventId: randomUUID(), version: 2, reason: "Customer withdrew" };
  assert.equal((await f.quotation.cancel({ claims: f.claims, id: created.quotation.id, input: cancel })).quotation.status, "CANCELLED");
  await f.quotation.cancel({ claims: f.claims, id: created.quotation.id, input: cancel });
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_audit_logs WHERE actor_user_id=?", [f.userId]))[0][0].n, 3);
  const expiredInput = { ...f.input(), quotationDate: "2000-01-01", validUntil: "2000-01-02" };
  const expired = await f.quotation.create({ claims: f.claims, input: expiredInput });
  await assert.rejects(() => f.quotation.issue({ claims: f.claims, id: expired.quotation.id, input: { eventId: randomUUID(), version: 1 } }), { code: "QUOTATION_STATE_CONFLICT" });
});
integrationTest("TC-015 Quotation conversion creates one complete Draft with immutable differences and no reservation", async t => {
  const f = await setup(t);
  async function sku(label) {
    const id = await f.insert("item_skus", { item_id: f.itemId, sku_code: `${f.customerId}-${label}`, sku_name: label, status: "active", sellable: 1, created_at: f.now, updated_at: f.now });
    const uomId = await f.insert("item_sku_uoms", { sku_id: id, uom_id: (await f.db.query("SELECT uom_id FROM item_sku_uoms WHERE id=?", [f.skuUomId]))[0][0].uom_id, to_base_factor: 1, is_base: 1, is_default_sale: 1, created_at: f.now, updated_at: f.now });
    return { skuId: id, skuUomId: uomId, quantity: "1.000000", unitSellingPrice: "2.0000" };
  }
  const removed = await sku("removed"), added = await sku("added"), input = f.input();input.lines.push(removed);
  const created = await f.quotation.create({ claims: f.claims, input });
  const issued = await f.quotation.issue({ claims: f.claims, id: created.quotation.id, input: { eventId: randomUUID(), version: 1 } });
  const order = orderInput(f, input); order.lines = [{ ...input.lines[0], quantity: "3.000000", unitSellingPrice: "4.0000" }, added];
  const request = { eventId: order.eventId, version: issued.quotation.version, order }; delete order.eventId;
  const converted = await f.quotation.convert({ claims: f.claims, id: created.quotation.id, input: request });
  assert.equal(converted.quotation.status, "CONVERTED"); assert.equal(converted.salesOrder.status, "DRAFT");
  for (const field of ["added", "removed", "quantityChanged", "priceChanged"]) assert.equal(converted.differenceSummary[field].length, 1);
  const [[row]] = await f.db.query("SELECT source_type,source_quotation_id,total_amount,line_count FROM sales_orders WHERE id=?", [converted.salesOrder.id]);
  assert.equal(row.source_type, "QUOTATION"); assert.equal(Number(row.source_quotation_id), created.quotation.id); assert.equal(row.total_amount, "14.0000");assert.equal(row.line_count, 2);
  const [lines] = await f.db.query("SELECT ordered_quantity,reserved_outstanding_base_quantity,fulfilled_base_quantity FROM sales_order_lines WHERE sales_order_id=?", [converted.salesOrder.id]);
  assert.equal(lines.length, 2);assert.ok(lines.every(line => Number(line.reserved_outstanding_base_quantity) === 0 && Number(line.fulfilled_base_quantity) === 0));
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_reservations WHERE sku_id=?", [f.skuId]))[0][0].n, 0);
  const replay = await f.quotation.convert({ claims: f.claims, id: created.quotation.id, input: request });assert.deepEqual(replay.salesOrder, converted.salesOrder);
  await assert.rejects(() => f.quotation.convert({ claims: f.claims, id: created.quotation.id, input: { ...request, order: { ...order, notes: "changed intent" } } }), { code: "SALES_EVENT_CONFLICT" });
});
integrationTest("TC-015 Different conversion events race to the same target without consuming another SO number", async t => {
  const f = await setup(t);
  const created = await f.quotation.create({ claims: f.claims, input: f.input() });
  await f.quotation.issue({ claims: f.claims, id: created.quotation.id, input: { eventId: randomUUID(), version: 1 } });
  const request = () => { const order = orderInput(f); const eventId = order.eventId;delete order.eventId;return { eventId, version: 2, order }; };
  const period = formatDateForFile(new Date(f.now), "Asia/Hong_Kong").slice(0,7).replace("-", "");
  const before = (await f.db.query("SELECT next_value FROM sales_document_sequences WHERE document_type='SALES_ORDER' AND period_key=?", [period]))[0][0]?.next_value ?? 1;
  const results = await Promise.all([request(), request()].map(input => f.quotation.convert({ claims: f.claims, id: created.quotation.id, input })));
  assert.deepEqual(results[0].salesOrder, results[1].salesOrder);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_orders WHERE customer_id=?", [f.customerId]))[0][0].n, 1);
  assert.equal((await f.db.query("SELECT next_value FROM sales_document_sequences WHERE document_type='SALES_ORDER' AND period_key=?", [period]))[0][0].next_value, before + 1);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_audit_logs WHERE actor_user_id=? AND action='sales_quotation.converted'", [f.userId]))[0][0].n, 1);
});
integrationTest("TC-015 Conversion required audit failure rolls back both links/order/sequence before same-event recovery", async t => {
  const f = await setup(t);
  const created = await f.quotation.create({ claims: f.claims, input: f.input() });
  await f.quotation.issue({ claims: f.claims, id: created.quotation.id, input: { eventId: randomUUID(), version: 1 } });
  const order = orderInput(f), eventId = order.eventId;delete order.eventId;const input = { eventId, version: 2, order };
  const broken = new SalesQuotationService({ database: f.database, time: f.time, logger: f.logger, audit: { async record(tx, request) { if (request.action === "sales_quotation.converted") throw new Error("conversion audit failure"); await new SalesAuditService().record(tx, request); } } });
  await assert.rejects(() => broken.convert({ claims: f.claims, id: created.quotation.id, input }), error => error.cause?.message === "conversion audit failure");
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_orders WHERE customer_id=?", [f.customerId]))[0][0].n, 0);
  assert.equal((await f.db.query("SELECT status FROM sales_quotations WHERE id=?", [created.quotation.id]))[0][0].status, "ISSUED");
  await f.db.execute("UPDATE inventory_warehouses SET status='INACTIVE' WHERE id=?", [f.warehouseId]);
  await assert.rejects(() => f.quotation.convert({ claims: f.claims, id: created.quotation.id, input }), { code: "WAREHOUSE_INVALID" });
  await f.db.execute("UPDATE inventory_warehouses SET status='ACTIVE' WHERE id=?", [f.warehouseId]);
  assert.equal((await f.quotation.convert({ claims: f.claims, id: created.quotation.id, input })).salesOrder.status, "DRAFT");
});

integrationTest("TC-014/015 Effective expiry blocks conversion before the expiry job persists its projection", async t => {
  const f = await setup(t), input = { ...f.input(), quotationDate: "2000-01-01", validUntil: "2000-01-02" };
  const created = await f.quotation.create({ claims: f.claims, input });
  await f.db.execute("UPDATE sales_quotations SET status='ISSUED',version=2 WHERE id=?", [created.quotation.id]);
  const order = orderInput(f), eventId = order.eventId;delete order.eventId;
  await assert.rejects(() => f.quotation.convert({ claims: f.claims, id: created.quotation.id, input: { eventId, version: 2, order } }), { code: "QUOTATION_STATE_CONFLICT" });
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_orders WHERE customer_id=?", [f.customerId]))[0][0].n, 0);
});
integrationTest("TC-014/015 Cancellation and conversion race admits one lifecycle effect", async t => {
  const f = await setup(t), created = await f.quotation.create({ claims: f.claims, input: f.input() });
  await f.quotation.issue({ claims: f.claims, id: created.quotation.id, input: { eventId: randomUUID(), version: 1 } });
  const order = orderInput(f), eventId = order.eventId;delete order.eventId;
  const results = await Promise.allSettled([
    f.quotation.convert({ claims: f.claims, id: created.quotation.id, input: { eventId, version: 2, order } }),
    f.quotation.cancel({ claims: f.claims, id: created.quotation.id, input: { eventId: randomUUID(), version: 2, reason: "Customer withdrew" } })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "VERSION_CONFLICT");
  const status = (await f.db.query("SELECT status,version FROM sales_quotations WHERE id=?", [created.quotation.id]))[0][0];
  assert.equal(status.version, 3);assert.ok(["CANCELLED", "CONVERTED"].includes(status.status));
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_quotation_conversions WHERE quotation_id=?", [created.quotation.id]))[0][0].n, status.status === "CONVERTED" ? 1 : 0);
});

integrationTest("TC-015 Conversion price provenance requires matching currency without FX", async t => {
  const f = await setup(t), created = await f.quotation.create({ claims: f.claims, input: f.input() });
  await f.quotation.issue({ claims: f.claims, id: created.quotation.id, input: { eventId: randomUUID(), version: 1 } });
  const currency = await createTestCurrency(f.db, f.cleanup, f.now);await f.db.execute("UPDATE currencies SET status='ACTIVE' WHERE code=?", [currency]);
  const order = orderInput(f), eventId = order.eventId;delete order.eventId;order.currencyCode = currency;
  const result = await f.quotation.convert({ claims: f.claims, id: created.quotation.id, input: { eventId, version: 2, order } });
  const [[row]] = await f.db.query("SELECT price_source,unit_selling_price,line_amount FROM sales_order_lines WHERE sales_order_id=?", [result.salesOrder.id]);
  assert.equal(row.price_source, "MANUAL");assert.equal(row.unit_selling_price, "3.3333");assert.equal(row.line_amount, "6.6666");
});
integrationTest("TC-015 Existing conversion replays in an exhausted period without number/link/audit effects", async t => {
  const f = await setup(t), created = await f.quotation.create({ claims: f.claims, input: f.input() });
  await f.quotation.issue({ claims: f.claims, id: created.quotation.id, input: { eventId: randomUUID(), version: 1 } });
  const request = () => { const order = orderInput(f), eventId = order.eventId;delete order.eventId;return { eventId, version: 2, order }; };
  const converted = await f.quotation.convert({ claims: f.claims, id: created.quotation.id, input: request() });
  const period = formatDateForFile(new Date(f.now), "Asia/Hong_Kong").slice(0,7).replace("-", "");
  const before = (await f.db.query("SELECT next_value FROM sales_document_sequences WHERE document_type='SALES_ORDER' AND period_key=?", [period]))[0][0].next_value;
  await f.db.execute("UPDATE sales_document_sequences SET next_value=1000000 WHERE document_type='SALES_ORDER' AND period_key=?", [period]);
  try {
    const replay = await f.quotation.convert({ claims: f.claims, id: created.quotation.id, input: request() });
    assert.deepEqual(replay.salesOrder, converted.salesOrder);
    assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_orders WHERE customer_id=?", [f.customerId]))[0][0].n, 1);
    assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_quotation_conversions WHERE quotation_id=?", [created.quotation.id]))[0][0].n, 1);
    assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_audit_logs WHERE actor_user_id=?", [f.userId]))[0][0].n, 4);
    assert.equal((await f.db.query("SELECT next_value FROM sales_document_sequences WHERE document_type='SALES_ORDER' AND period_key=?", [period]))[0][0].next_value, 1000000);
    const newQuote = await f.quotation.create({ claims: f.claims, input: f.input() });
    await f.quotation.issue({ claims: f.claims, id: newQuote.quotation.id, input: { eventId: randomUUID(), version: 1 } });
    await assert.rejects(() => f.quotation.convert({ claims: f.claims, id: newQuote.quotation.id, input: request() }), { code: "SALES_SEQUENCE_EXHAUSTED" });
  } finally { await f.db.execute("UPDATE sales_document_sequences SET next_value=? WHERE document_type='SALES_ORDER' AND period_key=?", [before, period]); }
});
integrationTest("TC-011/018 Quotation query pagination/effective status and fresh view permissions are consistent", async t => {
  const f = await setup(t), created = await f.quotation.create({ claims: f.claims, input: f.input() });
  const expired = await f.quotation.create({ claims: f.claims, input: { ...f.input(), quotationDate: "2000-01-01", validUntil: "2000-01-02" } });
  await f.db.execute("UPDATE sales_quotations SET status='ISSUED' WHERE id=?", [expired.quotation.id]);
  const result = await f.quotation.list({ claims: f.claims, input: { customerId: f.customerId, page: 1, pageSize: 1, sortBy: "number", descending: false } });
  assert.equal(result.items.length, 1); assert.equal(result.total, 2);
  const filtered = await f.quotation.list({ claims: f.claims, input: { customerId: f.customerId, status: ["EXPIRED"] } });
  assert.equal(filtered.total, 1);assert.equal(filtered.items[0].status, "EXPIRED");assert.equal(filtered.items[0].id, expired.quotation.id);
  const detail = await f.quotation.get({ claims: f.claims, id: created.quotation.id });
  assert.deepEqual(detail.allowedActions, ["edit", "issue", "cancel"]);assert.equal(detail.conversion, null);assert.equal(detail.lines[0].unitSellingPrice, "3.3333");
  for (const input of [{ sortBy: "id; DROP TABLE sales_quotations" }, { page: 0 }, { pageSize: 101 }, { status: ["UNKNOWN"] }, { quotationDateFrom: "2026-02-30" }])
    await assert.rejects(() => f.quotation.list({ claims: f.claims, input }), error => ["SALES_INPUT_INVALID", "SALES_DATE_INVALID"].includes(error.code));
  await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='sales.mgmt'", [f.roleId]);
  const viewer = { ...f.claims, claimedPermissions: ["sales.view"] };
  assert.deepEqual((await f.quotation.get({ claims: viewer, id: created.quotation.id })).allowedActions, []);
  assert.deepEqual((await f.quotation.get({ claims: viewer, id: expired.quotation.id })).allowedActions, ["print"]);
  assert.equal((await f.quotation.list({ claims: viewer, input: { customerId: f.customerId } })).total, 2);
  assert.equal((await f.quotation.list({ claims: viewer, input: { customerId: f.customerId, q: "%" } })).total, 0);
  const secondPage = await f.quotation.list({ claims: viewer, input: { customerId: f.customerId, page: 2, pageSize: 1, sortBy: "number", descending: false } });
  assert.notEqual(secondPage.items[0].id, result.items[0].id);
  assert.equal((await f.quotation.list({ claims: viewer, input: { customerId: f.customerId, validUntilTo: "2000-01-02" } })).total, 1);
  await assert.rejects(() => f.quotation.create({ claims: viewer, input: f.input() }), { code: "FORBIDDEN" });
  await f.db.execute("DELETE FROM role_permissions WHERE role_id=?", [f.roleId]);
  await assert.rejects(() => f.quotation.get({ claims: viewer, id: created.quotation.id }), { code: "PERMISSION_STALE" });
});
integrationTest("TC-018 Sales entry lookups enforce fresh write/view permissions and current saleable projections", async t => {
  const { SalesLookupService } = await import("../../src/modules/sales/SalesLookupService.js");
  const f = await setup(t), lookup = new SalesLookupService({ database: f.database, time: f.time, logger: f.logger });
  const [[customer]] = await f.db.query("SELECT customer_code FROM customers WHERE id=?", [f.customerId]);
  const request = (kind, input) => lookup.list({ claims: f.claims, kind, input });
  const customers = await request("customers", { q: customer.customer_code, page: 1, pageSize: 10 });
  assert.equal(customers.total, 1);assert.equal(customers.items[0].customerId, f.customerId);
  assert.equal(customers.items[0].credit.configured, false);assert.equal(customers.items[0].defaultCurrencyCode, f.currency);
  assert.equal(Object.hasOwn(customers.items[0], "generalPhone"), false);
  const [[sku]] = await f.db.query("SELECT sku_code FROM item_skus WHERE id=?", [f.skuId]);
  const skus = await request("skus", { q: sku.sku_code, currencyCode: "HKD" });
  assert.equal(skus.total, 1);assert.equal(skus.items[0].skuId, f.skuId);assert.equal(skus.items[0].uoms[0].skuUomId, f.skuUomId);
  assert.equal(skus.items[0].suggestedPrice.amount, "3.3333");assert.equal(skus.items[0].priceCurrencyMatches, true);
  assert.equal((await request("skus", { q: sku.sku_code, currencyCode: "USD" })).items[0].priceCurrencyMatches, false);
  const barcode = `sales-native-${randomUUID()}`;
  await f.insert("item_sku_barcodes", { sku_id: f.skuId, sku_uom_id: f.skuUomId, barcode, normalized_barcode: barcode, barcode_type: "internal", created_at: f.now, updated_at: f.now });
  assert.equal((await request("skus", { barcode })).items[0].skuId, f.skuId);
  assert.equal((await request("skus", { barcode: `${barcode}-missing` })).total, 0);
  await f.db.execute("UPDATE item_uoms SET status='inactive' WHERE id=(SELECT uom_id FROM item_sku_uoms WHERE id=?)", [f.skuUomId]);
  assert.equal((await request("skus", { q: sku.sku_code })).total, 0);
  await f.db.execute("UPDATE item_uoms SET status='active' WHERE id=(SELECT uom_id FROM item_sku_uoms WHERE id=?)", [f.skuUomId]);
  const [[warehouse]] = await f.db.query("SELECT warehouse_code FROM inventory_warehouses WHERE id=?", [f.warehouseId]);
  const warehouses = await request("warehouses", { q: warehouse.warehouse_code });
  assert.equal(warehouses.total, 1);assert.equal(warehouses.items[0].id, f.warehouseId);
  await f.db.execute("UPDATE inventory_warehouses SET status='INACTIVE' WHERE id=?", [f.warehouseId]);
  assert.equal((await request("warehouses", { q: warehouse.warehouse_code })).total, 0);
  await f.db.execute("UPDATE item_skus SET status='inactive' WHERE id=?", [f.skuId]);
  assert.equal((await request("skus", { q: sku.sku_code })).total, 0);
  await f.db.execute("UPDATE customers SET status='blocked' WHERE id=?", [f.customerId]);
  assert.equal((await request("customers", { q: customer.customer_code })).total, 0);
  for (const input of [{ page: 0 }, { pageSize: 101 }, { q: "x".repeat(191) }, { q: "\n" }, { unexpected: 1 }])
    await assert.rejects(() => request("customers", input), { code: "SALES_INPUT_INVALID" });
  await assert.rejects(() => request("channels", {}), { code: "FORBIDDEN" });
  await f.db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name='sales.import'", [f.roleId]);
  const importing = { ...f.claims, claimedPermissions: ["sales.view", "sales.mgmt", "sales.import"] };
  assert.deepEqual(await lookup.list({ claims: importing, kind: "channels", input: {} }), { items: [], total: 0, page: 1, pageSize: 20 });
  await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='sales.view'", [f.roleId]);
  const withoutView = { ...f.claims, claimedPermissions: ["sales.mgmt", "sales.import"] };
  for (const kind of ["customers", "channels"]) await assert.rejects(() => lookup.list({ claims: withoutView, kind, input: {} }), { code: "FORBIDDEN" });
  await f.db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name='sales.view'", [f.roleId]);
  await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='sales.import'", [f.roleId]);
  await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='sales.mgmt'", [f.roleId]);
  await assert.rejects(() => lookup.list({ claims: { ...f.claims, claimedPermissions: ["sales.view"] }, kind: "customers", input: {} }), { code: "FORBIDDEN" });
});
integrationTest("TC-018 Actual HTTP Sales lookup contracts retain permission and strict query validation", async t => {
  const f = await setup(t), { url } = await f.app.start();
  const token = await f.app.services.require("jwt").issue({ roles: f.claims.claimedRoles, permissions: f.claims.claimedPermissions },
    { subject: String(f.userId), version: await f.app.services.require("tokenRevocation").currentVersion(String(f.userId)), authTime: Math.floor(f.now / 1000) });
  for (const kind of ["customers", "skus", "warehouses"]) {
    const response = await fetch(`${url}/api/v1/sales-lookups/${kind}?pageSize=10`, { headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json();assert.equal(response.status, 200, JSON.stringify(result));assert.equal(result.data.pageSize, 10);
  }
  assert.equal((await fetch(`${url}/api/v1/sales-lookups/channels`, { headers: { Authorization: `Bearer ${token}` } })).status, 403);
  assert.equal((await fetch(`${url}/api/v1/sales-lookups/customers?pageSize=101`, { headers: { Authorization: `Bearer ${token}` } })).status, 400);
  assert.equal((await fetch(`${url}/api/v1/sales-lookups/customers`)).status, 401);
});
