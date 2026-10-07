import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { migrationFixture } from "../sales/phase1/fixtures.js";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { SalesOrderService } from "../../src/modules/sales/SalesOrderService.js";
import { SalesOrderConfirmationService } from "../../src/modules/sales/SalesOrderConfirmationService.js";
import { InventoryReservationService } from "../../src/modules/inventory/InventoryReservationService.js";
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
  const service = options => new SalesOrderConfirmationService({ database,time,logger,...options });
  const request = { claims,id: created.salesOrder.id,input: { eventId: randomUUID(),version: 1 } };
  return { ...f,app,database,time,logger,claims,userId,roleId,service,request };
}

async function stock(f, quantity, skuId = f.skuId) {
  await f.db.execute("UPDATE item_skus SET inventory_tracked=1 WHERE id=?", [skuId]);
  const bin = await f.insert("inventory_bins", { warehouse_id: f.warehouseId,bin_code: String(skuId),normalized_code: String(skuId),created_at: f.now,updated_at: f.now });
  if (quantity) await f.db.execute(`INSERT INTO inventory_stock_balances (warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,created_at,updated_at)
    VALUES (?,?,?,'AVAILABLE',?,?,?)`, [f.warehouseId,bin,skuId,quantity,f.now,f.now]);
  f.beforeParents.push(async () => {
    await f.db.execute("DELETE FROM sales_orders WHERE customer_id=?", [f.customerId]);
    await f.db.execute("DELETE FROM inventory_reservations WHERE warehouse_id=?", [f.warehouseId]);
    await f.db.execute("DELETE FROM inventory_stock_balances WHERE warehouse_id=?", [f.warehouseId]);
    await f.db.execute("DELETE FROM inventory_stock_controls WHERE warehouse_id=?", [f.warehouseId]);
  });
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

integrationTest("TC-021 Phase B confirms full, partial and zero ATP with exact mapping/backorder and stable replay", async t => {
  for (const available of [10, 4, 0]) await t.test(`ATP ${available}`, async child => {
    const f = await setup(child);
    await stock(f, available);
    const intent = await f.service().startConfirmation(f.request);
    const request = { eventId: intent.eventId,claims: f.claims,leaseOwner: intent.leaseOwner };
    const result = await f.service().completeConfirmation(request);
    assert.equal(result.salesOrder.status, "CONFIRMED"); assert.equal(result.salesOrder.version, 3);
    assert.equal(Number(result.salesOrder.lines[0].reservedBaseQuantity), available);
    assert.equal(Number(result.salesOrder.lines[0].backorderedBaseQuantity), 10 - available);
    assert.equal(result.salesOrder.hasBackorder, available < 10);
    assert.deepEqual(result.warnings, available < 10 ? [{ code: "PARTIAL_BACKORDER" }] : []);
    assert.deepEqual((await f.service().completeConfirmation(request)).operation, result.operation);
    const completedIntent = await f.service().startConfirmation(f.request);
    assert.equal(completedIntent.leaseOwner, null);
    assert.deepEqual((await f.service().completeConfirmation({ ...request,leaseOwner: completedIntent.leaseOwner })).operation, result.operation);
    const [[mapping]] = await f.db.query(`SELECT COUNT(*) AS n,COALESCE(SUM(outstanding_base_quantity),0) AS quantity
      FROM sales_order_line_reservations WHERE sales_order_line_id=?`, [result.salesOrder.lines[0].id]);
    assert.equal(Number(mapping.n), available ? 1 : 0); assert.equal(Number(mapping.quantity), available);
    const [[queue]] = await f.db.query("SELECT COUNT(*) AS n,COALESCE(SUM(outstanding_base_quantity),0) AS quantity FROM sales_backorder_entries WHERE sales_order_id=?", [f.request.id]);
    assert.equal(Number(queue.n), available < 10 ? 1 : 0); assert.equal(Number(queue.quantity), 10 - available);
    assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_order_status_history WHERE sales_order_id=? AND action='confirmed'", [f.request.id]))[0][0].n, 1);
  });
});
integrationTest("TC-024 Phase B rejects newly inactive Customer and commits Draft/FAILED without Inventory effects", async t => {
  const f = await setup(t), intent = await f.service().startConfirmation(f.request);
  await f.db.execute("UPDATE customers SET status='inactive' WHERE id=?", [f.customerId]);
  await assert.rejects(() => f.service().completeConfirmation({ eventId: intent.eventId,claims: f.claims,leaseOwner: intent.leaseOwner }), { code: "CUSTOMER_NOT_SALEABLE" });
  const [[order]] = await f.db.query("SELECT status,version,confirmation_event_id FROM sales_orders WHERE id=?", [f.request.id]);
  assert.deepEqual(order, { status: "DRAFT",version: 3,confirmation_event_id: null });
  const [[operation]] = await f.db.query("SELECT status,error_code FROM sales_operation_requests WHERE event_id=?", [intent.eventId]);
  assert.deepEqual(operation, { status: "FAILED",error_code: "CUSTOMER_NOT_SALEABLE" });
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_operation_requests WHERE source_module='SALES' AND source_document_id=?", [String(f.request.id)]))[0][0].n, 0);
});
integrationTest("TC-021 Phase B handles mixed multi-line ATP and freezes current Customer/Item snapshots", async t => {
  const f = await setup(t), [[uom]] = await f.db.query("SELECT uom_id FROM item_sku_uoms WHERE id=?", [f.skuUomId]);
  const lines = [{ skuId: f.skuId,skuUomId: f.skuUomId,quantity: "10.000000",unitSellingPrice: "1.0000" }];
  for (const n of [1,2]) {
    const skuId = await f.insert("item_skus", { item_id: f.itemId,sku_code: `phase2-${randomUUID()}`,sku_name: `Synthetic ${n}`,sellable: 1,status: "active",created_at: f.now,updated_at: f.now });
    const skuUomId = await f.insert("item_sku_uoms", { sku_id: skuId,uom_id: uom.uom_id,to_base_factor: 1,is_base: 1,is_default_sale: 1,created_at: f.now,updated_at: f.now });
    lines.push({ skuId,skuUomId,quantity: "10.000000",unitSellingPrice: "1.0000" });
  }
  const updated = await new SalesOrderService(f).update({ claims: f.claims,id: f.request.id,input: { eventId: randomUUID(),version: 1,customerId: f.customerId,
    currencyCode: f.currency,fulfillmentWarehouseId: f.warehouseId,orderDate: formatDateForFile(new Date(f.now), "Asia/Hong_Kong"),lines } });
  for (const [i,line] of lines.entries()) await stock(f, [10,4,0][i], line.skuId);
  const intent = await f.service().startConfirmation({ ...f.request,input: { ...f.request.input,version: updated.salesOrder.version } });
  await f.db.execute("UPDATE customers SET legal_name='Current synthetic name' WHERE id=?", [f.customerId]);
  await f.db.execute("UPDATE item_skus SET sku_name='Current SKU name' WHERE id=?", [f.skuId]);
  const result = await f.service().completeConfirmation({ eventId: intent.eventId,claims: f.claims,leaseOwner: intent.leaseOwner });
  assert.equal(result.salesOrder.customerName, "Current synthetic name"); assert.equal(result.salesOrder.lines[0].skuName, "Current SKU name");
  assert.deepEqual(result.salesOrder.lines.map(line => Number(line.reservedBaseQuantity)), [10,4,0]);
  assert.deepEqual(result.salesOrder.lines.map(line => Number(line.backorderedBaseQuantity)), [0,6,10]);
  assert.deepEqual(result.warnings, [{ code: "PARTIAL_BACKORDER" },{ code: "MASTER_DATA_CHANGED" }]);
  const [[history]] = await f.db.query("SELECT reason FROM sales_order_status_history WHERE sales_order_id=? AND action='confirmed'", [f.request.id]);
  assert.match(history.reason, /^MASTER_DIFFERENCE [a-f0-9]{64}$/u);
  assert.equal(result.salesOrder.backorderLineCount, 2); assert.equal(result.salesOrder.totalAmount, "30.0000");
});
integrationTest("TC-024 credit ON_HOLD fails atomically while a configured limit is advisory", async t => {
  for (const status of ["on_hold","normal"]) await t.test(status, async child => {
    const f = await setup(child); await stock(f,10);
    await f.insert("customer_credit_profiles", { customer_id: f.customerId,credit_limit: "1.0000",credit_currency_code: f.currency,credit_status: status,last_change_reason: "Synthetic test setup",version: 1,created_at: f.now,updated_at: f.now }, "customer_id");
    const intent = await f.service().startConfirmation(f.request), request = { eventId: intent.eventId,claims: f.claims,leaseOwner: intent.leaseOwner };
    if (status === "on_hold") {
      await assert.rejects(() => f.service().completeConfirmation(request), { code: "CUSTOMER_CREDIT_ON_HOLD" });
      assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_reservations WHERE warehouse_id=?", [f.warehouseId]))[0][0].n, 0);
    } else {
      const result = await f.service().completeConfirmation(request);
      assert.equal(result.salesOrder.status, "CONFIRMED"); assert.deepEqual(result.warnings, [{ code: "CREDIT_LIMIT_ADVISORY" }]);
      const [[row]] = await f.db.query("SELECT credit_status_snapshot,credit_limit_snapshot,credit_policy_version_snapshot FROM sales_orders WHERE id=?", [f.request.id]);
      assert.deepEqual(row, { credit_status_snapshot: "NORMAL",credit_limit_snapshot: "1.0000",credit_policy_version_snapshot: 1 });
    }
  });
});
integrationTest("TC-021 technical audit failure and malformed real provider result roll back all Inventory/Sales effects", async t => {
  for (const mode of ["audit","contract"]) await t.test(mode, async child => {
    const f = await setup(child); await stock(f,10); const intent = await f.service().startConfirmation(f.request);
    const options = mode === "audit" ? { audit: { async record() { throw new Error("Phase B required audit failure"); } } } : {
      inventory: { async reserveAvailableForSalesBatchInTransaction(tx, command) {
        const result = await new InventoryReservationService(f).reserveAvailableForSalesBatchInTransaction(tx,command);
        result.lines[0].uncoveredBaseQuantity=1; return result;
      } } };
    await assert.rejects(() => f.service(options).completeConfirmation({ eventId: intent.eventId,claims: f.claims,leaseOwner: intent.leaseOwner }),
      error => mode === "contract" ? error.code === "INVENTORY_CONTRACT_MISMATCH" : error.cause?.message === "Phase B required audit failure");
    const [[order]] = await f.db.query("SELECT status,version FROM sales_orders WHERE id=?", [f.request.id]);
    assert.deepEqual(order, { status: "CONFIRMING",version: 2 });
    for (const table of ["inventory_reservations","inventory_stock_controls"])
      assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE warehouse_id=?`, [f.warehouseId]))[0][0].n, 0);
    assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_operation_requests WHERE source_module='SALES' AND source_document_id=?", [String(f.request.id)]))[0][0].n, 0);
    assert.equal((await f.db.query("SELECT status FROM sales_operation_requests WHERE event_id=?", [intent.eventId]))[0][0].status, "IN_PROGRESS");
    assert.equal((await f.service().completeConfirmation({ eventId: intent.eventId,claims: f.claims,leaseOwner: intent.leaseOwner })).salesOrder.status, "CONFIRMED");
  });
});
integrationTest("TC-024 invalid SKU/UOM/Warehouse revalidation safely returns Draft with no Inventory claims", async t => {
  for (const kind of ["sku","uom","warehouse"]) await t.test(kind, async child => {
    const f = await setup(child); await stock(f,10); const intent = await f.service().startConfirmation(f.request);
    if (kind === "sku") await f.db.execute("UPDATE item_skus SET status='inactive' WHERE id=?", [f.skuId]);
    if (kind === "uom") await f.db.execute("UPDATE item_uoms SET status='inactive' WHERE id=(SELECT uom_id FROM item_sku_uoms WHERE id=?)", [f.skuUomId]);
    if (kind === "warehouse") await f.db.execute("UPDATE inventory_warehouses SET status='INACTIVE' WHERE id=?", [f.warehouseId]);
    await assert.rejects(() => f.service().completeConfirmation({ eventId: intent.eventId,claims: f.claims,leaseOwner: intent.leaseOwner }),
      error => ["SKU_NOT_SALEABLE","SKU_UOM_INVALID","WAREHOUSE_INVALID"].includes(error.code));
    assert.equal((await f.db.query("SELECT status FROM sales_orders WHERE id=?", [f.request.id]))[0][0].status, "DRAFT");
    assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_operation_requests WHERE source_module='SALES' AND source_document_id=?", [String(f.request.id)]))[0][0].n, 0);
  });
});
integrationTest("TC-026 confirmation exposes uncertain Phase A COMMIT and reconciles actual commit versus rollback by original event", async t => {
  for (const outcome of ["committed","rolled_back"]) await t.test(outcome, async child => {
    const f = await setup(child); await stock(f,10);
    const acquire=f.database.acquireConnection;
    f.database.acquireConnection=async function(...args){
      const connection=await acquire.apply(this,args),commit=connection.commit.bind(connection),rollback=connection.rollback.bind(connection);
      connection.commit=async()=>{if(outcome==="committed")await commit();else await rollback();throw Object.assign(new Error("Synthetic Phase A acknowledgement loss"),{code:"ECONNRESET"});};
      return connection;
    };
    let accepted;
    try {accepted=await f.service().confirm(f.request);} finally {f.database.acquireConnection=acquire;}
    assert.equal(accepted.statusCode,202);assert.equal(accepted.data.eventId,f.request.input.eventId);assert.ok(accepted.data.operationId>0);
    if(outcome==="committed") {
      const operation=await f.service().lookup({claims:f.claims,eventId:f.request.input.eventId});
      assert.equal(operation.operationId,accepted.data.operationId);assert.equal(operation.status,"IN_PROGRESS");
    } else await assert.rejects(()=>f.service().lookup({claims:f.claims,eventId:f.request.input.eventId}),{code:"SALES_ORDER_NOT_FOUND"});
    const confirmed=await f.service().confirm(f.request);assert.equal(confirmed.statusCode,200);assert.equal(confirmed.data.outcome,"CONFIRMED");
    const operation=await f.service().lookup({claims:f.claims,eventId:f.request.input.eventId});assert.equal(operation.status,"SUCCEEDED");
    assert.deepEqual(Object.keys(operation).sort(),["errorCode","eventId","operationId","result","status"]);
    assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_reservations WHERE warehouse_id=?",[f.warehouseId]))[0][0].n,1);
  });
});
integrationTest("TC-022 operation lookup requires current original-user permissions and hides another actor's event",async t=>{
  const f=await setup(t);await f.service().startConfirmation(f.request);
  assert.equal((await f.service().lookup({claims:f.claims,eventId:f.request.input.eventId})).status,"IN_PROGRESS");
  const other=await f.insert("users",{username:`other-${randomUUID()}`,password_hash:"synthetic",display_name:"Other",created_at:f.now,updated_at:f.now});
  await f.db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)",[other,f.roleId]);
  f.beforeParents.push(()=>f.db.execute("DELETE FROM user_roles WHERE user_id=?",[other]));
  await assert.rejects(()=>f.service().lookup({claims:{...f.claims,actorId:other},eventId:f.request.input.eventId}),{code:"SALES_ORDER_NOT_FOUND"});
  await f.db.execute("DELETE FROM role_permissions WHERE role_id=?",[f.roleId]);
  await assert.rejects(()=>f.service().lookup({claims:f.claims,eventId:f.request.input.eventId}),{code:"PERMISSION_STALE"});
});
