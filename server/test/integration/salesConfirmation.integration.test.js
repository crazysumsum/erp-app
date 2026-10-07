import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SalesOrderService } from "../../src/modules/sales/SalesOrderService.js";
import { InventoryReservationService } from "../../src/modules/inventory/InventoryReservationService.js";
import { formatDateForFile } from "../../src/services/time/timeFormat.js";
import { setup, stock } from "../sales/phase2/fixtures.js";
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

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
  for (const available of [10, 4, 0]) await t.test(`TC-021 confirmation ATP ${available}`, async child => {
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
integrationTest("TC-023 multi-line failure rolls back every commitment before retry commits all snapshots", async t => {
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
  await assert.rejects(() => f.service({ audit: { async record() { throw Error("Multi-line required audit fault"); } } }).completeConfirmation({ eventId: intent.eventId,claims: f.claims,leaseOwner: intent.leaseOwner }), error => error.cause?.message === "Multi-line required audit fault");
  const [[failedOrder]] = await f.db.query("SELECT status,version FROM sales_orders WHERE id=?", [f.request.id]);
  assert.deepEqual(failedOrder, { status: "CONFIRMING",version: updated.salesOrder.version + 1 });
  const [failedLines] = await f.db.query("SELECT reserved_outstanding_base_quantity,backordered_base_quantity FROM sales_order_lines WHERE sales_order_id=? ORDER BY line_no", [f.request.id]);
  assert.deepEqual(failedLines, lines.map(() => ({ reserved_outstanding_base_quantity: 0,backordered_base_quantity: 0 })));
  for (const table of ["inventory_reservations","inventory_stock_controls"])
    assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE warehouse_id=?`, [f.warehouseId]))[0][0].n, 0);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_order_line_reservations r JOIN sales_order_lines l ON l.id=r.sales_order_line_id WHERE l.sales_order_id=?", [f.request.id]))[0][0].n, 0);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_backorder_entries WHERE sales_order_id=?", [f.request.id]))[0][0].n, 0);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_audit_logs WHERE event_id=? AND action='sales_order.confirmed'", [intent.eventId]))[0][0].n, 0);
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
integrationTest("TC-022 polling reads committed IN_PROGRESS without waiting for the executing operation lock",async t=>{
  const f=await setup(t);await stock(f,10);const intent=await f.service().startConfirmation(f.request);
  let entered;const inside=new Promise(resolve=>{entered=resolve;});
  const real=new InventoryReservationService(f),service=f.service({inventory:{reserveAvailableForSalesBatchInTransaction(tx,command){entered();return real.reserveAvailableForSalesBatchInTransaction(tx,command);}}});
  await f.db.query("START TRANSACTION");await f.db.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE",[f.warehouseId]);
  const execution=service.completeConfirmation({eventId:intent.eventId,claims:f.claims,leaseOwner:intent.leaseOwner});
  let lookup,timer;
  try {
    await inside;
    lookup=f.service().lookup({claims:f.claims,eventId:intent.eventId});
    const result=await Promise.race([lookup,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),200);})]);
    assert.equal(result?.status,"IN_PROGRESS","A status read must not wait for Phase B's operation row lock");
  } finally {clearTimeout(timer);await f.db.query("ROLLBACK");await execution;await lookup;}
});
async function http(f) {
  const {url}=await f.app.start();
  const token=await f.app.services.require("jwt").issue({roles:f.claims.claimedRoles,permissions:f.claims.claimedPermissions},
    {subject:String(f.userId),version:await f.app.services.require("tokenRevocation").currentVersion(String(f.userId)),authTime:Math.floor(f.now/1000)});
  const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json","Idempotency-Key":f.request.input.eventId};
  return {get:event=>fetch(new URL(`/api/v1/sales-operations/by-event/${event}`,url),{headers}),
    confirm:body=>fetch(new URL(`/api/v1/sales-orders/${f.request.id}/confirm`,url),{method:"POST",headers,body:JSON.stringify(body??f.request.input)})};
}
integrationTest("TC-022 actual Confirm HTTP schema returns terminal detail and rejects type/identity injection",async t=>{
  const f=await setup(t);await stock(f,10);
  await f.db.execute("UPDATE item_skus SET tracking_policy='batch' WHERE id=?",[f.skuId]);
  const lot=await f.insert("inventory_lots",{sku_id:f.skuId,lot_number:"Synthetic",normalized_lot_number:"synthetic",first_receipt_date:formatDateForFile(new Date(f.now),"Asia/Hong_Kong"),sku_code_snapshot:"Synthetic",created_at:f.now});
  await f.db.execute("UPDATE inventory_stock_balances SET lot_id=? WHERE warehouse_id=?",[lot,f.warehouseId]);
  const api=await http(f);
  for(const body of [{...f.request.input,version:"1"},{...f.request.input,leaseOwner:randomUUID()}]){
    const response=await api.confirm(body);assert.equal(response.status,400);assert.equal((await response.json()).error.code,"SALES_INPUT_INVALID");
  }
  const response=await api.confirm();assert.equal(response.status,200);const result=(await response.json()).data;
  assert.equal(result.outcome,"CONFIRMED");assert.equal(result.salesOrder.status,"CONFIRMED");assert.equal(result.salesOrder.lines[0].trackingPolicy,"BATCH");
  assert.deepEqual(Object.keys(result).sort(),["outcome","salesOrder","warnings"]);
  const operation=await api.get(f.request.input.eventId);assert.equal(operation.status,200);assert.equal((await operation.json()).data.status,"SUCCEEDED");
});
integrationTest("TC-022 actual HTTP202 retains event/Retry-After and remains pollable before native Phase B commit",async t=>{
  const f=await setup(t,{waitMs:100});await stock(f,10);const api=await http(f);
  await f.db.query("START TRANSACTION");await f.db.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE",[f.warehouseId]);
  let accepted;
  try {
    const response=await api.confirm();assert.equal(response.status,202);assert.equal(response.headers.get("Retry-After"),"2");accepted=(await response.json()).data;
    assert.equal(accepted.eventId,f.request.input.eventId);assert.equal(accepted.statusUrl,`/api/v1/sales-operations/by-event/${f.request.input.eventId}`);
    assert.deepEqual(Object.keys(accepted).sort(),["eventId","operationId","outcome","retryAfterSeconds","statusUrl"]);
    const pending=await api.get(accepted.eventId);assert.equal(pending.status,200);assert.equal((await pending.json()).data.status,"IN_PROGRESS");
  } finally {await f.db.query("ROLLBACK");}
  await f.database.withTransaction(tx=>tx.query("SELECT status FROM sales_operation_requests WHERE event_id=? LOCK IN SHARE MODE",[f.request.input.eventId]));
  const terminal=await api.get(accepted.eventId);assert.equal(terminal.status,200);assert.equal((await terminal.json()).data.status,"SUCCEEDED");
  const replay=await api.confirm();assert.equal(replay.status,202);assert.equal(replay.headers.get("Retry-After"),"2");assert.equal((await replay.json()).data.eventId,accepted.eventId);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_reservations WHERE warehouse_id=?",[f.warehouseId]))[0][0].n,1);
  await f.db.execute("DELETE FROM role_permissions WHERE role_id=?",[f.roleId]);
  const revoked=await api.confirm();assert.equal(revoked.status,403);assert.equal((await revoked.json()).error.code,"PERMISSION_STALE");
});
