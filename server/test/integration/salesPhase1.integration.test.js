import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { migrationFixture } from "../sales/phase1/fixtures.js";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
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
  f.cleanup.push(async () => {
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
  const input = () => ({ eventId: randomUUID(), customerId: f.customerId, currencyCode: f.currency, quotationDate: "2026-10-01", validUntil: "2026-10-31",
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
  await f.db.execute("UPDATE users SET status='inactive' WHERE id=?", [f.userId]);
  assert.equal((await request("/api/v1/sales-quotations/create", input, key)).status, 403);
  await f.db.execute("UPDATE users SET status='active' WHERE id=?", [f.userId]);
  await f.db.execute("DELETE FROM role_permissions WHERE role_id=?", [f.roleId]);
  assert.equal((await request("/api/v1/sales-quotations/create", input, key)).status, 403);
});
