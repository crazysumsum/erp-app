import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { migrationFixture } from "../sales/phase1/fixtures.js";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { SalesOrderService } from "../../src/modules/sales/SalesOrderService.js";
import { SalesOrderConfirmationService } from "../../src/modules/sales/SalesOrderConfirmationService.js";
import { formatDateForFile } from "../../src/services/time/timeFormat.js";
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

async function setup(t) {
  const f = await migrationFixture(t, []), source = defaultConfigurationSource();
  const app = await createApplication({ configurationSource: { ...source, scheduler: { ...source.scheduler, jobs: { ...source.scheduler.jobs,
    "sales.confirmationRecovery": { enabled: false }, "sales.backorderAllocate": { enabled: false } } } } });
  t.after(() => app.shutdown("sales_phase2_confirmation_complete"));
  const database = app.services.require("mysqldatabase"), time = app.services.require("time"), logger = app.services.require("logging").logger;
  const label = `sales-p2-${randomUUID().slice(0, 8)}`;
  const roleId = await f.insert("roles", { name: label, created_at: f.now });
  const userId = await f.insert("users", { username: label, password_hash: "synthetic", display_name: "Synthetic", created_at: f.now, updated_at: f.now });
  await f.db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [userId,roleId]);
  for (const permission of ["sales.view","sales.mgmt"]) await f.db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [roleId,permission]);
  f.beforeParents.push(async () => {
    await f.db.execute("DELETE FROM sales_orders WHERE customer_id=?", [f.customerId]);
    await f.db.execute("DELETE FROM sales_audit_logs WHERE actor_user_id=?", [userId]);
    await f.db.execute("DELETE FROM sales_operation_requests WHERE actor_user_id=?", [userId]);
    await f.db.execute("DELETE FROM user_roles WHERE user_id=?", [userId]);
    await f.db.execute("DELETE FROM role_permissions WHERE role_id=?", [roleId]);
  });
  await f.db.execute("UPDATE currencies SET status='ACTIVE' WHERE code=?", [f.currency]);
  await f.db.execute("UPDATE item_skus SET sellable=1 WHERE id=?", [f.skuId]);
  const claims = { actorId: userId, claimedRoles: [label], claimedPermissions: ["sales.mgmt","sales.view"] };
  const created = await new SalesOrderService({ database,time,logger }).create({ claims,input: { eventId: randomUUID(), customerId: f.customerId,
    currencyCode: f.currency, fulfillmentWarehouseId: f.warehouseId, orderDate: formatDateForFile(new Date(f.now), "Asia/Hong_Kong"),
    lines: [{ skuId: f.skuId,skuUomId: f.skuUomId,quantity: "10.000000",unitSellingPrice: "1.0000" }] } });
  const service = options => new SalesOrderConfirmationService({ database,time,...options });
  const request = { claims,id: created.salesOrder.id,input: { eventId: randomUUID(),version: 1 } };
  return { ...f,app,database,time,logger,claims,userId,roleId,service,request };
}

integrationTest("TC-022 Phase A commits one durable original-user intent/DB-clock lease/history/audit without Inventory effects", async t => {
  const f = await setup(t), first = await f.service().startConfirmation(f.request);
  assert.equal(first.status, "IN_PROGRESS");
  assert.deepEqual(await f.service().startConfirmation(f.request), first);
  const [[row]] = await f.db.query(`SELECT o.status,o.version,o.confirmation_event_id,p.recovery_payload,p.actor_user_id,
    p.lease_until>CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS valid_lease
    FROM sales_orders o JOIN sales_operation_requests p ON p.event_id=o.confirmation_event_id WHERE o.id=?`, [f.request.id]);
  assert.equal(row.status, "CONFIRMING"); assert.equal(row.version, 2); assert.equal(row.confirmation_event_id, f.request.input.eventId);
  assert.deepEqual(row.recovery_payload, { version: 1 }); assert.equal(Number(row.actor_user_id), f.userId); assert.equal(row.valid_lease, 1);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_order_status_history WHERE sales_order_id=? AND action='confirm_started'", [f.request.id]))[0][0].n, 1);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_audit_logs WHERE event_id=? AND action='sales_order.confirm_started'", [f.request.input.eventId]))[0][0].n, 1);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_reservations WHERE sku_id=?", [f.skuId]))[0][0].n, 0);
});
integrationTest("TC-022 Phase A chooses one intent under concurrent distinct events and blocks second confirmation", async t => {
  const f = await setup(t), other = { ...f.request,input: { ...f.request.input,eventId: randomUUID() } };
  const results = await Promise.allSettled([f.service().startConfirmation(f.request),f.service().startConfirmation(other)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.code, "SALES_CONFIRMATION_IN_PROGRESS");
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE command_type='CONFIRM_ORDER' AND target_id=?", [f.request.id]))[0][0].n, 1);
});
integrationTest("TC-022 Phase A stale version rolls back the claim and replay rechecks real revoked permissions", async t => {
  const f = await setup(t);
  await assert.rejects(() => f.service().startConfirmation({ ...f.request,input: { ...f.request.input,version: 2 } }), { code: "VERSION_CONFLICT" });
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE event_id=?", [f.request.input.eventId]))[0][0].n, 0);
  await f.service().startConfirmation(f.request);
  await f.db.execute("DELETE FROM role_permissions WHERE role_id=?", [f.roleId]);
  await assert.rejects(() => f.service().startConfirmation(f.request), { code: "PERMISSION_STALE" });
  assert.equal((await f.db.query("SELECT version FROM sales_orders WHERE id=?", [f.request.id]))[0][0].version, 2);
});
integrationTest("TC-022 Phase A required audit failure rolls back operation, CONFIRMING and history atomically", async t => {
  const f = await setup(t);
  await assert.rejects(() => f.service({ audit: { async record() { throw new Error("Required audit probe"); } } }).startConfirmation(f.request),
    error => error.cause?.message === "Required audit probe");
  const [[row]] = await f.db.query("SELECT status,version,confirmation_event_id FROM sales_orders WHERE id=?", [f.request.id]);
  assert.deepEqual(row, { status: "DRAFT",version: 1,confirmation_event_id: null });
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE event_id=?", [f.request.input.eventId]))[0][0].n, 0);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_order_status_history WHERE sales_order_id=? AND action='confirm_started'", [f.request.id]))[0][0].n, 0);
});
