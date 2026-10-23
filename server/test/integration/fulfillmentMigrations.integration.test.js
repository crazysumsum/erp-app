import assert from "node:assert/strict";
import test from "node:test";
import {fixture,document} from "../fulfillment/aggregateFixture.js";
import { up as documentsUp } from "../../database/migrations/0093_create_fulfillment_documents.js";
import { up as allocationsUp } from "../../database/migrations/0095_create_fulfillment_allocations.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
nativeTest("P0 Fulfillment document and allocation schema reruns, resumes missing triggers and rejects drift",async t=>{
  const f=await fixture(t);await documentsUp(f.db);await allocationsUp(f.db);
  await f.db.query("DROP TRIGGER trg_ful_claim_insert");await documentsUp(f.db);
  const doc=await document(f);assert.ok(doc.id>0);
  await f.db.query("ALTER TABLE fulfillment_lines MODIFY version BIGINT UNSIGNED NOT NULL DEFAULT 1");await assert.rejects(documentsUp(f.db),/Incompatible/u);
});
nativeTest("P0 Claim source ownership, conservation and Serial snapshots are enforced by the real schema",async t=>{
  const f=await fixture(t),doc=await document(f);
  const claim={fulfillment_id:doc.id,fulfillment_line_id:doc.line,sales_order_line_reservation_id:f.mappingId,inventory_reservation_id:f.reservationId,original_claimed_quantity:1,active_claimed_quantity:1,status:"ACTIVE",inventory_version:1,created_at:f.s.now,updated_at:f.s.now};
  const id=await f.s.insert("fulfillment_line_reservation_claims",claim);assert.ok(id>0);
  await assert.rejects(f.db.query("UPDATE fulfillment_line_reservation_claims SET active_claimed_quantity=2 WHERE id=?",[id]));
  await assert.rejects(f.db.execute("UPDATE fulfillment_line_reservation_claims SET active_claimed_quantity=0,released_quantity=1 WHERE id=?",[id]));
  const other=await document(f,"FUL-202610-000002");
  await assert.rejects(f.s.insert("fulfillment_line_reservation_claims",{...claim,fulfillment_id:other.id}));
  await assert.rejects(f.db.execute("UPDATE fulfillment_lines SET tracking_policy_snapshot='serial',version=version+1 WHERE id=?",[doc.line]));
  await assert.rejects(f.db.execute("UPDATE fulfillments SET customer_id=customer_id+999,version=version+1 WHERE id=?",[doc.id]));
});
nativeTest("P0 line allocation is cumulative and history is append-only",async t=>{
  const f=await fixture(t),doc=await document(f);
  await f.db.execute("UPDATE fulfillment_lines SET allocated_base_quantity=3,version=version+1 WHERE id=?",[doc.line]);
  assert.equal(Number((await f.db.query("SELECT allocated_base_quantity FROM fulfillment_lines WHERE id=?",[doc.line]))[0][0].allocated_base_quantity),3);
  await assert.rejects(f.db.execute("UPDATE fulfillment_lines SET picked_base_quantity=2,version=version+1 WHERE id=?",[doc.line]));
  const history=await f.s.insert("fulfillment_status_history",{fulfillment_id:doc.id,sequence_no:1,to_status:"DRAFT",action:"CREATE",event_id:"00000000-0000-4000-8000-000000000001",version_after:1,actor_label:"Synthetic",occurred_at:f.s.now});
  await assert.rejects(f.db.execute("UPDATE fulfillment_status_history SET actor_label='Changed' WHERE id=?",[history]),/append-only/u);
  await assert.rejects(f.db.execute("DELETE FROM fulfillment_status_history WHERE id=?",[history]),/append-only/u);
});

async function claimFixture(t){
  const [{FulfillmentLockService},{InventoryFulfillmentService},{InventoryLookupService}]=await Promise.all([import("../../src/modules/fulfillment/FulfillmentLockService.js"),import("../../src/modules/inventory/InventoryFulfillmentService.js"),import("../../src/modules/inventory/InventoryLookupService.js")]);
  const f=await fixture(t),first=await document(f),second=await document(f,"FUL-202610-000002"),time={...f.time,fileDate:()=>"2023-11-14"};
  await f.db.execute("UPDATE item_skus SET inventory_tracked=1 WHERE id=?",[f.s.skuId]);
  await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,reserved_quantity:1,created_at:f.s.now,updated_at:f.s.now});
  const inventory=new InventoryFulfillmentService({database:f.database,time,logger:{error(){}}}),lookup=new InventoryLookupService({fulfillment:inventory,time}),sales=f.createService({inventoryFulfillment:inventory}),locks=new FulfillmentLockService({database:f.database,sales,inventoryLookup:lookup,itemLookup:inventory.itemLookup,time});
  const request=doc=>{const salesIntent=f.command();salesIntent.purpose="CLAIM";for(const k of ["eventId","shipmentId","inventoryRequestHash"])delete salesIntent[k];return {salesIntent,fulfillmentId:String(doc.id),expectedVersion:1,lines:[{fulfillmentLineId:String(doc.line),salesOrderLineId:String(f.s.lineId),baseQuantity:"1",reservations:[{inventoryReservationId:String(f.reservationId),baseQuantity:"1"}]}]};};
  const insert=async(tx,result)=>{const member=result.claims[0];await tx.execute(`INSERT INTO fulfillment_line_reservation_claims(fulfillment_id,fulfillment_line_id,sales_order_line_reservation_id,inventory_reservation_id,original_claimed_quantity,active_claimed_quantity,status,inventory_version,created_at,updated_at) VALUES (?,?,?,?,?,?,'ACTIVE',?,?,?)`,[member.fulfillmentId,member.fulfillmentLineId,member.salesReservationMappingId,member.inventoryReservationId,member.baseQuantity,member.baseQuantity,member.inventoryVersion,f.s.now,f.s.now]);};
  return {...f,time,inventory,sales,first,second,locks,request,insert};
}
nativeTest("P0 real Claim capacity helper serializes two connections under Sales roots and cannot overclaim native outstanding",async t=>{
  const f=await claimFixture(t);let release,entered,waiterEntered;const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;}),waiterReady=new Promise(r=>{waiterEntered=r;});let waiter;
  const winner=f.run({claims:f.claims},async tx=>{const result=await f.locks.lockClaimCapacityInTransaction(tx,f.request(f.first));entered();await gate;await f.insert(tx,result);return result;});
  try{
    await Promise.race([ready,winner]);
    waiter=f.run({claims:f.claims},async tx=>{const [[row]]=await tx.query("SELECT CONNECTION_ID() AS id");waiterEntered(row.id);const result=await f.locks.lockClaimCapacityInTransaction(tx,f.request(f.second));await f.insert(tx,result);return result;});
    const connectionId=await Promise.race([waiterReady,waiter]),deadline=Date.now()+5000;let blocked=false;
    while(Date.now()<deadline){const [[row]]=await f.db.query(`SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads th ON th.THREAD_ID=w.REQUESTING_THREAD_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='sales_orders' AND th.PROCESSLIST_ID=?`,[f.f.name,connectionId]);if(Number(row.n)>0){blocked=true;break;}await new Promise(setImmediate);}
    assert.equal(blocked,true,"the losing real transaction waits on this fixture's Sales root");release();
    const results=await Promise.allSettled([winner,waiter]);assert.equal(results[0].status,"fulfilled");assert.equal(results[1].reason.code,"RESERVATION_CLAIM_CONFLICT");
    assert.equal(Number((await f.db.query("SELECT SUM(active_claimed_quantity) AS n FROM fulfillment_line_reservation_claims"))[0][0].n),1);
  }finally{release();await Promise.allSettled([winner,...(waiter?[waiter]:[])]);}
});
nativeTest("P0 Claim scope rejects aliases, mismatched selected quantities, stale parents and later failure without partial claims",async t=>{
  const f=await claimFixture(t),request=f.request(f.first);
  await assert.rejects(f.locks.lockClaimCapacityInTransaction(f.db,request),TypeError);
  for(const change of [q=>{q.expectedVersion=2;},q=>{q.lines[0].reservations[0].inventoryReservationId="999";},q=>{q.lines[0].baseQuantity="2";q.lines[0].reservations[0].baseQuantity="2";},q=>{q.lines[0].fulfillmentLineId=String(f.second.line);}]){
    const bad=structuredClone(request);change(bad);await assert.rejects(f.run({claims:f.claims},tx=>f.locks.lockClaimCapacityInTransaction(tx,bad)));
  }
  await assert.rejects(f.run({claims:f.claims},async tx=>{const result=await f.locks.lockClaimCapacityInTransaction(tx,request);await f.insert(tx,result);throw new Error("late caller failure");}),e=>e.cause?.message==="late caller failure");
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_line_reservation_claims"))[0][0].n,0);
  await f.run({claims:f.claims},async tx=>{const pending=f.locks.lockClaimCapacityInTransaction(tx,request);request.lines[0].reservations[0].baseQuantity="999";const result=await pending;assert.equal(result.claims[0].baseQuantity,"1");await f.insert(tx,result);});
});

nativeTest("P0 impossible picked/short aggregate quantities are rejected without imposing allocated<=planned",async t=>{
  const f=await fixture(t),doc=await document(f);
  await assert.rejects(f.db.execute("UPDATE fulfillment_lines SET picked_base_quantity=1,version=version+1 WHERE id=?",[doc.line]));
  await f.db.execute("UPDATE fulfillment_lines SET allocated_base_quantity=1,version=version+1 WHERE id=?",[doc.line]);
  await assert.rejects(f.db.execute("UPDATE fulfillment_lines SET picked_base_quantity=1,short_base_quantity=1,version=version+1 WHERE id=?",[doc.line]));
});
nativeTest("P0 Claim validates locked Item Base UOM after the Sales display snapshot",async t=>{
  const f=await claimFixture(t),base=await f.s.insert("item_uoms",{code:"OTHER",name:"Other",status:"active",created_at:f.s.now,updated_at:f.s.now});
  const original=f.sales.lockLinesForFulfillmentInTransaction.bind(f.sales);let changed=false;
  f.sales.lockLinesForFulfillmentInTransaction=async(...args)=>{const result=await original(...args);await f.db.execute("UPDATE item_sku_uoms SET uom_id=? WHERE id=?",[base,f.s.skuUomId]);changed=true;return result;};
  await assert.rejects(f.run({claims:f.claims},tx=>f.locks.lockClaimCapacityInTransaction(tx,f.request(f.first))),{code:"RESERVATION_CLAIM_CONFLICT"});assert.equal(changed,true);
});
nativeTest("P0 CHECK arithmetic regroup drift fails closed",async t=>{
  const f=await fixture(t);
  const [[row]]=await f.db.query("SELECT check_clause AS clause FROM information_schema.check_constraints WHERE constraint_schema=DATABASE() AND constraint_name='chk_ful_allocation_quantity'");
  const changed=row.clause.replace("((`picked_base_quantity` + `released_base_quantity`) <= `allocated_base_quantity`)","(`picked_base_quantity` + (`released_base_quantity` <= `allocated_base_quantity`))");assert.notEqual(changed,row.clause);
  await f.db.query("ALTER TABLE fulfillment_allocations DROP CHECK chk_ful_allocation_quantity, ADD CONSTRAINT chk_ful_allocation_quantity CHECK ("+changed+")");
  await assert.rejects(allocationsUp(f.db),/Incompatible/u);
});
async function allocationFixture(t){
  const f=await claimFixture(t),bin=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"PICK",normalized_code:"pick",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now}),balance=await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:bin,sku_id:f.s.skuId,stock_status:"AVAILABLE",on_hand_quantity:10,fifo_anchor_date:"2023-11-13",created_at:f.s.now,updated_at:f.s.now});
  await f.run({claims:f.claims},async tx=>f.insert(tx,await f.locks.lockClaimCapacityInTransaction(tx,f.request(f.first))));
  const [[claim]]=await f.db.query("SELECT id FROM fulfillment_line_reservation_claims WHERE fulfillment_id=?",[f.first.id]);
  const intent=f.command();intent.purpose="CLAIM";for(const key of ["eventId","shipmentId","inventoryRequestHash"])delete intent[key];
  const command={actor:{...f.command().actor,userId:f.userId},source:{documentId:String(f.first.id),eventId:crypto.randomUUID()},correlationId:"",payload:{fulfillmentId:String(f.first.id),lines:[{fulfillmentLineId:String(f.first.line),salesOrderLineId:String(f.s.lineId),baseQuantity:"1",reservations:[{claimId:String(claim.id),inventoryReservationId:String(f.reservationId),expectedVersion:1,baseQuantity:"1",overrideReason:"",allocations:[{inventoryBalanceId:String(balance),expectedBalanceVersion:1,baseQuantity:"1"}]}]}]}};
  const allocated=await f.run({claims:f.claims},async tx=>{const proof=await f.inventory.claimFulfillmentBatchInTransaction(tx,{action:"ALLOCATE",command});await f.sales.lockLinesForFulfillmentInTransaction(tx,intent);return f.inventory.allocateForFulfillmentBatchInTransaction(tx,command,proof);});
  const member=allocated.lines[0].reservations[0],leg=member.allocations[0],bucket=leg.bucketSnapshot;
  const row={fulfillment_id:f.first.id,fulfillment_line_id:f.first.line,claim_id:claim.id,inventory_reservation_id:f.reservationId,inventory_allocation_id:leg.inventoryAllocationId,inventory_balance_id:balance,warehouse_id:f.s.warehouseId,bin_id:bin,lot_id:null,bin_code_snapshot:bucket.binCode,stock_status_snapshot:bucket.stockStatus,selection_strategy:leg.selectionStrategy,recommended_rank_snapshot:leg.recommendedRank,allocated_base_quantity:1,status:"ACTIVE",inventory_version:leg.allocationVersion,balance_version:leg.balanceVersion,created_at:f.s.now,updated_at:f.s.now};
  return {...f,row};
}
nativeTest("P0 real Inventory allocation cannot be projected under another Fulfillment/Claim and remains unique",async t=>{
  const f=await allocationFixture(t),otherClaim=await f.s.insert("fulfillment_line_reservation_claims",{fulfillment_id:f.second.id,fulfillment_line_id:f.second.line,sales_order_line_reservation_id:f.mappingId,inventory_reservation_id:f.reservationId,original_claimed_quantity:1,active_claimed_quantity:1,status:"ACTIVE",inventory_version:2,created_at:f.s.now,updated_at:f.s.now});
  await assert.rejects(f.s.insert("fulfillment_allocations",{...f.row,fulfillment_id:f.second.id,fulfillment_line_id:f.second.line,claim_id:otherClaim}));
  assert.ok(await f.s.insert("fulfillment_allocations",f.row));await assert.rejects(f.s.insert("fulfillment_allocations",f.row));
});
nativeTest("P0 Allocation state/counters are coherent and provider snapshots are immutable",async t=>{
  const f=await allocationFixture(t),id=await f.s.insert("fulfillment_allocations",f.row);
  for(const changes of ["released_base_quantity=1","status='CONSUMED'","status='PARTIALLY_RELEASED'","selection_strategy='FEFO'","inventory_version=0","balance_version=0"]){await assert.rejects(f.db.execute("UPDATE fulfillment_allocations SET "+changes+" WHERE id=?",[id]));}
  await f.db.execute("UPDATE fulfillment_allocations SET picked_base_quantity=1 WHERE id=?",[id]);
  await f.db.execute("UPDATE fulfillment_allocations SET status='CONSUMED' WHERE id=?",[id]);
  await assert.rejects(f.db.execute("UPDATE fulfillment_allocations SET released_base_quantity=1 WHERE id=?",[id]));
});
