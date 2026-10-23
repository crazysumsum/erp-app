import assert from "node:assert/strict";
import test from "node:test";
import {lifecycleFixture} from "../fulfillment/lifecycleFixture.js";
import {document} from "../fulfillment/aggregateFixture.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function historyFixture(t){const f=await lifecycleFixture(t),doc=await document(f);await f.db.execute("UPDATE fulfillments SET status='CANCELLED',version=version+1 WHERE id=?",[doc.id]);await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,reserved_quantity:1,created_at:f.s.now,updated_at:f.s.now});return {...f,doc};}
nativeTest("P0 canonical withdrawal of zero-Fulfilled SO with cancelled Fulfillment/released Claim is blocked before release by approved HD014",async t=>{
  const f=await historyFixture(t);await f.s.insert("fulfillment_line_reservation_claims",{fulfillment_id:f.doc.id,fulfillment_line_id:f.doc.line,sales_order_line_reservation_id:f.mappingId,inventory_reservation_id:f.reservationId,original_claimed_quantity:1,active_claimed_quantity:0,released_quantity:1,status:"CANCELLED",inventory_version:1,created_at:f.s.now,updated_at:f.s.now});
  await assertWithdrawalBlocked(f);
});
nativeTest("P0 canonical withdrawal without Claim is rejected before creating an uneditable Draft under approved HD014",async t=>{
  const f=await historyFixture(t);await f.db.execute("UPDATE currencies SET status='ACTIVE' WHERE code=?",[f.before.order.currency_code]);await f.db.execute("UPDATE item_skus SET sellable=1 WHERE id=?",[f.s.skuId]);
  await assertWithdrawalBlocked(f);
});


async function assertWithdrawalBlocked(f){
  const facts=async()=>{const result={};for(const table of ["sales_orders","sales_order_lines","sales_order_line_reservations","sales_operation_requests","sales_order_status_history","sales_audit_logs","inventory_operation_requests","inventory_reservations","inventory_stock_controls","inventory_audit_logs","fulfillments","fulfillment_lines","fulfillment_line_reservation_claims"])result[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return result;};
  const before=await facts(),inventory=f.service.inventory,release=inventory.releaseSalesBatchInTransaction.bind(inventory);let releases=0;inventory.releaseSalesBatchInTransaction=(...args)=>{releases++;return release(...args);};await assert.rejects(f.run(()=>f.service.withdrawConfirmation(f.input())),error=>{assert.equal(error.code,"FULFILLMENT_HISTORY_BLOCKS_WITHDRAWAL");assert.equal(error.statusCode,409);assert.match(error.publicMessage,/履約歷史/u);return true;});assert.equal(releases,0,"history refusal precedes the actual Inventory release method");assert.deepEqual(await facts(),before);
}
nativeTest("P0 no-history withdrawal still supports real Draft edit and a fresh Inventory-backed reconfirmation",async t=>{
  const {SalesOrderService}=await import("../../src/modules/sales/SalesOrderService.js"),{SalesOrderConfirmationService}=await import("../../src/modules/sales/SalesOrderConfirmationService.js"),{randomUUID}=await import("node:crypto"),f=await lifecycleFixture(t);
  await f.db.execute("UPDATE currencies SET status='ACTIVE' WHERE code=?",[f.before.order.currency_code]);await f.db.execute("UPDATE item_skus SET sellable=1,inventory_tracked=1 WHERE id=?",[f.s.skuId]);
  const bin=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"SYN",normalized_code:"syn",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:bin,sku_id:f.s.skuId,stock_status:"AVAILABLE",on_hand_quantity:1,fifo_anchor_date:"2023-11-14",created_at:f.s.now,updated_at:f.s.now});await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,reserved_quantity:1,created_at:f.s.now,updated_at:f.s.now});
  const withdrawalRequest=f.input(),withdrawn=await f.run(()=>f.service.withdrawConfirmation(withdrawalRequest));const options={database:f.database,time:f.time,logger:{error(){}}},sales=new SalesOrderService(options);const saved=await f.run(()=>sales.update({claims:f.claims,id:f.s.orderId,input:{eventId:randomUUID(),version:2,customerId:f.s.customerId,currencyCode:f.before.order.currency_code,fulfillmentWarehouseId:f.s.warehouseId,orderDate:"2023-11-14",lines:[{skuId:f.s.skuId,skuUomId:f.s.skuUomId,quantity:"1.000000",unitSellingPrice:"1.0000"}]}}));assert.equal(saved.salesOrder.version,3);
  const confirmation=new SalesOrderConfirmationService(options),intent=await f.run(()=>confirmation.startConfirmation({claims:f.claims,id:f.s.orderId,input:{eventId:randomUUID(),version:3}})),result=await f.run(()=>confirmation.completeConfirmation({eventId:intent.eventId,leaseOwner:intent.leaseOwner,claims:f.claims}));assert.equal(result.salesOrder.status,"CONFIRMED");assert.equal(result.salesOrder.lines[0].reservedBaseQuantity,"1");
  // A later persisted root must not change the outcome of the original completed withdrawal event.
  await document({...f,s:{...f.s,lineId:result.salesOrder.lines[0].id}});const before=(await f.db.query("SELECT * FROM inventory_reservations ORDER BY id"))[0],replay=await f.run(()=>f.service.withdrawConfirmation(withdrawalRequest));assert.deepEqual(replay.operation,withdrawn.operation);assert.deepEqual((await f.db.query("SELECT * FROM inventory_reservations ORDER BY id"))[0],before);
});
nativeTest("P0 historical terminal Claim leaves CANCEL eligibility unchanged and keeps the mapping history",async t=>{
  const f=await historyFixture(t);await f.s.insert("fulfillment_line_reservation_claims",{fulfillment_id:f.doc.id,fulfillment_line_id:f.doc.line,sales_order_line_reservation_id:f.mappingId,inventory_reservation_id:f.reservationId,original_claimed_quantity:1,active_claimed_quantity:0,released_quantity:1,status:"CANCELLED",inventory_version:1,created_at:f.s.now,updated_at:f.s.now});assert.equal((await f.run(()=>f.service.cancel(f.input()))).salesOrder.status,"CANCELLED");assert.equal((await f.db.query("SELECT COUNT(*) n FROM fulfillment_line_reservation_claims"))[0][0].n,1);assert.equal((await f.db.query("SELECT released_base_quantity FROM sales_order_line_reservations WHERE id=?",[f.mappingId]))[0][0].released_base_quantity,1);
});
nativeTest("P0 archive-only Fulfillment history blocks WITHDRAW before release and is not falsely labelled active",async t=>{
  const f=await historyFixture(t),batch=await f.s.insert("sales_archive_batches",{batch_number:"SYNTHETIC-HD014",period_key:"202610",cutoff_at:f.s.now,status:"RUNNING",started_at:f.s.now,updated_at:f.s.now}),[[root]]=await f.db.query("SELECT * FROM fulfillments WHERE id=?",[f.doc.id]);
  // Synthetic mirror seed tests owned history detection; this does not implement P3 copy/retention.
  await f.s.insert("fulfillments_archive",{...root,archive_batch_id:batch,archived_at:f.s.now,row_hash:"a".repeat(64)});await f.db.execute("DELETE FROM fulfillments WHERE id=?",[f.doc.id]);await assertWithdrawalBlocked(f);
  await f.run(()=>f.database.withTransaction(async tx=>{const result=await f.provider.assertSalesLifecycleAllowedInTransaction(tx,{...f.command(),action:"WITHDRAW"});assert.equal(result.status,"CLOSED");assert.deepEqual(result.reasonCodes,["FULFILLMENT_HISTORY_BLOCKS_WITHDRAWAL"]);},{isolationLevel:"READ COMMITTED"}));
});

nativeTest("P0 terminal Fulfillment history does not change CLOSE_REMAINING eligibility",async t=>{
 const f=await historyFixture(t); // Synthetic prior fulfilled unit, as in the existing Sales lifecycle fixture.
 await f.db.execute("UPDATE sales_order_lines SET ordered_quantity=2,ordered_base_quantity=2,fulfilled_base_quantity=1,line_amount=2 WHERE id=?",[f.s.lineId]);await f.db.execute("UPDATE sales_orders SET status='PARTIALLY_FULFILLED',total_amount=2 WHERE id=?",[f.s.orderId]);assert.equal((await f.run(()=>f.service.closeRemaining(f.input()))).salesOrder.status,"CLOSED");assert.equal((await f.db.query("SELECT status FROM fulfillments WHERE id=?",[f.doc.id]))[0][0].status,"CANCELLED");assert.equal((await f.db.query("SELECT outstanding_quantity FROM inventory_reservations WHERE id=?",[f.reservationId]))[0][0].outstanding_quantity,0);
});
nativeTest("P0 malformed dependency reason or wrong-purpose history reason is UNKNOWN before any actual release",async t=>{
 const {SalesFulfillmentGuardService}=await import("../../src/modules/sales/SalesFulfillmentGuardService.js"),f=await lifecycleFixture(t),real=f.provider,inventory=f.service.inventory,release=inventory.releaseSalesBatchInTransaction.bind(inventory);let releases=0;inventory.releaseSalesBatchInTransaction=(...args)=>{releases++;return release(...args);};
 for(const [method,reasonCodes,status] of [["withdrawConfirmation","FULFILLMENT_HISTORY_BLOCKS_WITHDRAWAL"],["withdrawConfirmation",["FULFILLMENT_HISTORY_BLOCKS_WITHDRAWAL","UNRECOGNIZED"]],["withdrawConfirmation",["UNRECOGNIZED"]],["cancel",["FULFILLMENT_HISTORY_BLOCKS_WITHDRAWAL"]],["withdrawConfirmation",["FULFILLMENT_HISTORY_BLOCKS_WITHDRAWAL"],"UNKNOWN"]]){
  f.service.guard=new SalesFulfillmentGuardService({services:{names:()=>["fulfillmentOpenMatter"],resolve:async()=>({async assertSalesLifecycleAllowedInTransaction(...args){const result=await real.assertSalesLifecycleAllowedInTransaction(...args);return {...result,...(status?{status}:{}),reasonCodes};}})}});const req=f.input();await assert.rejects(f.run(()=>f.service[method](req)),{code:"SALES_DEPENDENCY_UNAVAILABLE"});assert.equal(releases,0);assert.equal((await f.db.query("SELECT COUNT(*) n FROM sales_operation_requests WHERE event_id=?",[req.input.eventId]))[0][0].n,0);assert.equal((await f.db.query("SELECT outstanding_quantity FROM inventory_reservations WHERE id=?",[f.reservationId]))[0][0].outstanding_quantity,1);
 }
});
