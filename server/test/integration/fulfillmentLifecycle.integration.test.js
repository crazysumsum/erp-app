import assert from "node:assert/strict";
import test from "node:test";
import {document} from "../fulfillment/aggregateFixture.js";
import {SalesFulfillmentGuardService} from "../../src/modules/sales/SalesFulfillmentGuardService.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
import {lifecycleFixture} from "../fulfillment/lifecycleFixture.js";
nativeTest("P0 real Sales→Fulfillment→Inventory CLOSED cancels and releases exactly once without Fulfillment permissions",async t=>{
  const f=await lifecycleFixture(t);await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,reserved_quantity:1,created_at:f.s.now,updated_at:f.s.now});
  const request=f.input(),result=await f.run(()=>f.service.cancel(request));assert.equal(result.salesOrder.status,"CANCELLED");assert.equal((await f.db.query("SELECT outstanding_quantity,released_quantity FROM inventory_reservations WHERE id=?",[f.reservationId]))[0][0].released_quantity,1);assert.deepEqual((await f.run(()=>f.service.cancel(request))).operation,result.operation);
});
nativeTest("P0 current active Claim on a terminal parent blocks real Sales release and rolls back its operation",async t=>{
  const f=await lifecycleFixture(t),doc=await document(f);await f.db.execute("UPDATE fulfillments SET status='CANCELLED',version=version+1 WHERE id=?",[doc.id]);await f.s.insert("fulfillment_line_reservation_claims",{fulfillment_id:doc.id,fulfillment_line_id:doc.line,sales_order_line_reservation_id:f.mappingId,inventory_reservation_id:f.reservationId,original_claimed_quantity:1,active_claimed_quantity:1,status:"ACTIVE",inventory_version:1,created_at:f.s.now,updated_at:f.s.now});
  const req=f.input();await assert.rejects(f.run(()=>f.service.cancel(req)),{code:"OPEN_FULFILLMENT_EXISTS"});assert.equal((await f.db.query("SELECT status FROM sales_orders WHERE id=?",[f.s.orderId]))[0][0].status,"CONFIRMED");assert.equal((await f.db.query("SELECT outstanding_quantity FROM inventory_reservations WHERE id=?",[f.reservationId]))[0][0].outstanding_quantity,1);assert.equal((await f.db.query("SELECT COUNT(*) n FROM sales_operation_requests WHERE event_id=?",[req.input.eventId]))[0][0].n,0);
});
nativeTest("P0 readiness rejects stale/foreign context, malformed purpose, current Sales CAS and missing schema",async t=>{
  const f=await lifecycleFixture(t);assert.deepEqual(await f.provider.assertSalesLifecycleAllowedInTransaction(f.db,f.command()),{status:"UNKNOWN"});
  await f.run(()=>f.database.withTransaction(async tx=>{for(const change of [{action:"EXPORT"},{orderId:String(f.s.orderId)},{expectedVersion:2},{actorId:f.userId}])assert.deepEqual(await f.provider.assertSalesLifecycleAllowedInTransaction(tx,{...f.command(),...change}),{status:"UNKNOWN"});assert.deepEqual(await f.provider.assertSalesLifecycleAllowedInTransaction(tx,f.command()),{status:"CLOSED"});},{isolationLevel:"READ COMMITTED"}));
  await f.db.query("DROP TABLE shipment_reversal_details");await f.db.query("DROP TABLE shipment_reversals");const req=f.input();await assert.rejects(f.run(()=>f.service.cancel(req)),{code:"SALES_DEPENDENCY_UNAVAILABLE"});
  const absent=new SalesFulfillmentGuardService({services:{names:()=>[],resolve:async()=>null}});await f.run(()=>f.database.withTransaction(tx=>assert.rejects(absent.assertAllowed(tx,f.command()),{code:"SALES_DEPENDENCY_UNAVAILABLE"})));
});
nativeTest("P0 real Sales release and another Order's first Fulfillment INSERT sharing a Warehouse must both commit",async t=>{
  const f=await lifecycleFixture(t),doc=await document(f);await f.db.execute("UPDATE fulfillments SET status='CANCELLED',version=version+1 WHERE id=?",[doc.id]);
  await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,reserved_quantity:1,created_at:f.s.now,updated_at:f.s.now});
  const otherOrder={...f.before.order,sales_order_number:"SO-202610-000002"};delete otherOrder.id;const orderId=await f.s.insert("sales_orders",otherOrder),[[saved]]=await f.db.query("SELECT * FROM fulfillments WHERE id=?",[doc.id]);
  const newRoot={...saved,fulfillment_number:"FUL-202610-000002",sales_order_id:orderId,status:"DRAFT",version:1};delete newRoot.id;
  const inventory=f.service.inventory;let writer,connectionReady;const ready=new Promise(resolve=>{connectionReady=resolve;});let inserted=false;
  f.service.inventory={async releaseSalesBatchInTransaction(...args){
    writer=f.run(()=>f.database.withTransaction(async tx=>{await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[orderId]);const [[c]]=await tx.query("SELECT CONNECTION_ID() id");connectionReady(c.id);await tx.query("INSERT INTO fulfillments SET ?",[newRoot]);inserted=true;},{isolationLevel:"READ COMMITTED"}));
    const connection=await Promise.race([ready,writer]),deadline=performance.now()+5000;let blocked=false;
    while(performance.now()<deadline){if(inserted)break;const [[row]]=await f.db.query("SELECT COUNT(*) n FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads th ON th.THREAD_ID=w.REQUESTING_THREAD_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='fulfillments' AND th.PROCESSLIST_ID=?",[f.f.name,connection]);if(Number(row.n)>0){blocked=true;break;}await new Promise(setImmediate);}
    assert.ok(inserted||blocked,"the real second root INSERT must either finish or reach the observed root gap");return inventory.releaseSalesBatchInTransaction(...args);
  }};
  let result,writerError;try{result=await f.run(()=>f.service.cancel(f.input()));}finally{await writer?.catch(error=>{writerError=error;});}assert.ifError(writerError);assert.equal(result.salesOrder.status,"CANCELLED");assert.equal(inserted,true);assert.equal((await f.db.query("SELECT COUNT(*) n FROM fulfillments WHERE sales_order_id=?",[orderId]))[0][0].n,1);
});
for(const [method,status] of [["withdrawConfirmation","DRAFT"],["closeRemaining","CLOSED"]])nativeTest(`P0 real ${method} uses approved active RC and atomically releases current commitments`,async t=>{
  const f=await lifecycleFixture(t);await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,reserved_quantity:1,created_at:f.s.now,updated_at:f.s.now});
  if(method==="closeRemaining"){
    // A synthetic already-fulfilled unit provides this lifecycle's starting projection, not an Issue/P2 proof.
    await f.db.execute("UPDATE sales_order_lines SET ordered_quantity=2,ordered_base_quantity=2,fulfilled_base_quantity=1,line_amount=2 WHERE id=?",[f.s.lineId]);await f.db.execute("UPDATE sales_orders SET status='PARTIALLY_FULFILLED',total_amount=2 WHERE id=?",[f.s.orderId]);
  }
  const {getActiveTransactionIsolation}=await import("../../src/services/mysqldatabase/MySqlDatabaseService.js"),provider=f.provider;let seen=0;
  f.service.guard=new SalesFulfillmentGuardService({services:{...f.services,resolve:async()=>({assertSalesLifecycleAllowedInTransaction(tx,command){assert.equal(getActiveTransactionIsolation(tx),"READ COMMITTED");seen++;return provider.assertSalesLifecycleAllowedInTransaction(tx,command);}})}});
  const req=f.input(),result=await f.run(()=>f.service[method](req));assert.equal(result.salesOrder.status,status);assert.equal(seen,1);assert.equal((await f.db.query("SELECT outstanding_quantity,released_quantity FROM inventory_reservations WHERE id=?",[f.reservationId]))[0][0].released_quantity,1);assert.deepEqual((await f.run(()=>f.service[method](req))).operation,result.operation);
});
nativeTest("P0 late real Inventory effects then Audit failure roll back every lifecycle owner",async t=>{
  const f=await lifecycleFixture(t);await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,reserved_quantity:1,created_at:f.s.now,updated_at:f.s.now});
  const tables=["sales_orders","sales_order_lines","sales_order_line_reservations","sales_operation_requests","sales_order_status_history","sales_audit_logs","inventory_operation_requests","inventory_stock_controls","inventory_reservations","inventory_audit_logs"],facts=async()=>{const result={};for(const table of tables)result[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return result;},before=await facts(),audit=f.service.order.audit;
  f.service.order.audit={async record(...args){await audit.record(...args);throw new Error("synthetic late lifecycle audit fault");}};
  await assert.rejects(f.run(()=>f.service.cancel(f.input())));assert.deepEqual(await facts(),before);
});
nativeTest("P0 terminal Shipment missing a declared line is UNKNOWN rather than CLOSED",async t=>{
  // Synthetic persisted aggregate tests completeness only; it is not a Shipment/Issue coordinator proof.
  const f=await lifecycleFixture(t),doc=await document(f);await f.db.execute("UPDATE fulfillment_lines SET allocated_base_quantity=1,picked_base_quantity=1,version=version+1 WHERE id=?",[doc.line]);for(const status of ["PICKING","PICKED"])await f.db.execute("UPDATE fulfillments SET status=?,version=version+1 WHERE id=?",[status,doc.id]);
  const shipment=await f.s.insert("shipments",{shipment_number:"SHP-202610-000001",fulfillment_id:doc.id,sales_order_id:f.s.orderId,customer_id:f.s.customerId,warehouse_id:f.s.warehouseId,shipping_address_id:f.s.addressId,shipping_address_version:1,line_count:1,last_business_updated_at:f.s.now,created_at:f.s.now,updated_at:f.s.now});await f.db.execute("UPDATE shipments SET status='CANCELLED',version=version+1 WHERE id=?",[shipment]);await f.db.execute("UPDATE fulfillments SET status='CANCELLED',version=version+1 WHERE id=?",[doc.id]);
  const readiness=()=>f.run(()=>f.database.withTransaction(tx=>f.provider.assertSalesLifecycleAllowedInTransaction(tx,f.command()),{isolationLevel:"READ COMMITTED"}));assert.deepEqual(await readiness(),{status:"UNKNOWN"});
  await f.s.insert("shipment_lines",{shipment_id:shipment,fulfillment_id:doc.id,fulfillment_line_id:doc.line,line_no:1,sales_order_line_id:f.s.lineId,sku_id:f.s.skuId,base_uom_id:f.s.uomId,sku_code_snapshot:"SYN",sku_name_snapshot:"Synthetic",base_uom_code_snapshot:"EA",shipped_base_quantity:1,created_at:f.s.now,updated_at:f.s.now});assert.deepEqual(await readiness(),{status:"CLOSED"});
});
nativeTest("P0 missing only reversal-detail provenance schema cannot become CLOSED for an empty order",async t=>{
  const f=await lifecycleFixture(t);await f.db.query("DROP TABLE shipment_reversal_details");const req=f.input();await assert.rejects(f.run(()=>f.service.cancel(req)),{code:"SALES_DEPENDENCY_UNAVAILABLE"});assert.equal((await f.db.query("SELECT outstanding_quantity FROM inventory_reservations WHERE id=?",[f.reservationId]))[0][0].outstanding_quantity,1);assert.equal((await f.db.query("SELECT COUNT(*) n FROM sales_operation_requests WHERE event_id=?",[req.input.eventId]))[0][0].n,0);
});
nativeTest("P0 real RR caller metadata is refused by the lifecycle readiness guard",async t=>{
  const f=await lifecycleFixture(t);await f.run(()=>f.database.withTransaction(async tx=>{assert.deepEqual(await f.provider.assertSalesLifecycleAllowedInTransaction(tx,f.command()),{status:"UNKNOWN"});},{isolationLevel:"REPEATABLE READ"}));
});
nativeTest("P0 real history-append and before-commit boundary failures leave zero lifecycle partial effects",async t=>{
 for(const boundary of ["history","before_commit"])await t.test(boundary,async child=>{
  const f=await lifecycleFixture(child);await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,reserved_quantity:1,created_at:f.s.now,updated_at:f.s.now});const tables=["sales_orders","sales_order_lines","sales_order_line_reservations","sales_operation_requests","sales_order_status_history","sales_audit_logs","inventory_operation_requests","inventory_stock_controls","inventory_reservations","inventory_audit_logs"],facts=async()=>{const result={};for(const table of tables)result[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return result;},before=await facts(),transaction=f.database.withTransaction.bind(f.database);let hit=false;
  f.database.withTransaction=(work,options)=>transaction(async tx=>{const execute=tx.execute.bind(tx);tx.execute=async(sql,args)=>{const result=await execute(sql,args);if(boundary==="history"&&sql.startsWith("INSERT INTO sales_order_status_history")){hit=true;throw new Error("synthetic post-history fault");}return result;};const result=await work(tx);if(boundary==="before_commit"){hit=true;throw new Error("synthetic precommit fault");}return result;},options);
  await assert.rejects(f.run(()=>f.service.cancel(f.input())));assert.equal(hit,true);assert.deepEqual(await facts(),before);
 });
});
nativeTest("P0 lost caller acknowledgement after true commit is UNKNOWN and exact-event replay creates no new release",async t=>{
 const f=await lifecycleFixture(t);await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,reserved_quantity:1,created_at:f.s.now,updated_at:f.s.now});const transaction=f.database.withTransaction.bind(f.database),req=f.input();f.database.withTransaction=async(...args)=>{await transaction(...args);throw Object.assign(new Error("synthetic acknowledgement loss after actual native commit"),{code:"DATABASE_TRANSACTION_INDETERMINATE"});};await assert.rejects(f.run(()=>f.service.cancel(req)),{code:"TRANSACTION_OUTCOME_UNKNOWN"});f.database.withTransaction=transaction;const before=(await f.db.query("SELECT * FROM inventory_reservations ORDER BY id"))[0],replay=await f.run(()=>f.service.cancel(req));assert.equal(replay.operation.status,"CANCELLED");assert.deepEqual((await f.db.query("SELECT * FROM inventory_reservations ORDER BY id"))[0],before);assert.equal((await f.db.query("SELECT COUNT(*) n FROM sales_order_status_history WHERE event_id=?",[req.input.eventId]))[0][0].n,1);
});
