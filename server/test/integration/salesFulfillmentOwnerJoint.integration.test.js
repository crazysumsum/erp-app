import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { salesFulfillmentFixture } from "../sales/phase4/salesFulfillmentFixtures.js";
import { ItemLookupService } from "../../src/modules/item/ItemLookupService.js";

const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function jointFixture(t){
  const [{InventoryFulfillmentService},{InventoryLookupService}]=await Promise.all([import("../../src/modules/inventory/InventoryFulfillmentService.js"),import("../../src/modules/inventory/InventoryLookupService.js")]);
  const f=await salesFulfillmentFixture(t),time={...f.time,fileDate:()=>"2023-11-14"};
  // Complete the confirmed-order fixture's existing reserve provenance; allocation must not rewrite its Sales last-sync version.
  const [[reservation]]=await f.db.query("SELECT create_operation_id FROM inventory_reservations WHERE id=?",[f.reservationId]);
  await f.db.execute("UPDATE inventory_operation_requests SET source_module='SALES',source_document_type='SALES_ORDER',source_document_id=?,source_line_id=? WHERE id=?",[String(f.s.orderId),String(f.s.lineId),reservation.create_operation_id]);
  await f.db.execute("UPDATE item_skus SET inventory_tracked=1 WHERE id=?",[f.s.skuId]);
  const binId=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"JOINT",normalized_code:"joint",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});
  const balanceId=String(await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:binId,sku_id:f.s.skuId,stock_status:"AVAILABLE",on_hand_quantity:10,allocated_quantity:0,fifo_anchor_date:"2023-11-13",created_at:f.s.now,updated_at:f.s.now}));
  await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,reserved_quantity:1,created_at:f.s.now,updated_at:f.s.now});
  const inventory=new InventoryFulfillmentService({database:f.database,time,logger:{error(){}}}),sales=f.createService({inventoryFulfillment:inventory}),item=new ItemLookupService({database:f.database,time,logger:{error(){}}});
  const actor={...f.command().actor,userId:f.userId};
  const allocation={actor,source:{documentId:"1",eventId:randomUUID()},correlationId:"",payload:{fulfillmentId:"1",lines:[{fulfillmentLineId:"1",salesOrderLineId:String(f.s.lineId),baseQuantity:"1",reservations:[{claimId:"1",inventoryReservationId:String(f.reservationId),expectedVersion:1,baseQuantity:"1",overrideReason:"",allocations:[{inventoryBalanceId:balanceId,expectedBalanceVersion:1,baseQuantity:"1"}]}]}]}};
  let allocated;
  await f.run({claims:f.claims},async tx=>{
    const proof=await inventory.claimFulfillmentBatchInTransaction(tx,{action:"ALLOCATE",command:allocation});
    const claim=f.command();claim.purpose="CLAIM";for(const key of ["eventId","shipmentId","inventoryRequestHash"])delete claim[key];
    await sales.lockLinesForFulfillmentInTransaction(tx,claim);
    await item.getFulfillmentInventoryProfilesInTransaction(tx,[String(f.s.skuId)],{atMs:time.nowMs()});
    allocated=await inventory.allocateForFulfillmentBatchInTransaction(tx,allocation,proof);
  });
  const member=allocated.lines[0].reservations[0],leg=member.allocations[0];
  assert.equal(member.version,2);
  assert.equal((await f.db.query("SELECT inventory_version FROM sales_order_line_reservations WHERE id=?",[f.mappingId]))[0][0].inventory_version,1);
  const issue={actor,source:{documentId:"1",eventId:randomUUID()},correlationId:"",payload:{fulfillmentId:"1",shipmentId:"1",lines:[{fulfillmentLineId:"1",salesOrderLineId:String(f.s.lineId),baseQuantity:"1",reservations:[{claimId:"1",inventoryReservationId:String(f.reservationId),expectedVersion:member.version,baseQuantity:"1",allocations:[{inventoryAllocationId:leg.inventoryAllocationId,inventoryBalanceId:balanceId,expectedVersion:leg.allocationVersion,expectedBalanceVersion:leg.balanceVersion,baseQuantity:"1"}]}]}]}};
  const lookup=new InventoryLookupService({fulfillment:inventory,time});
  return {...f,time,inventory,sales,item,lookup,allocated,issue,balanceId};
}
async function confirm(f,sales=f.sales,{changeIntent,changeResult}={}){
  return f.run({claims:f.claims},async tx=>{
    const sql=[],query=tx.query.bind(tx),execute=tx.execute.bind(tx);
    tx.query=(statement,args)=>{sql.push(statement);return query(statement,args);};
    tx.execute=(statement,args)=>{sql.push(statement);return execute(statement,args);};
    const preparation=await f.inventory.claimFulfillmentBatchInTransaction(tx,{action:"ISSUE",command:f.issue});
    const intent=f.command();intent.eventId=f.issue.source.eventId;intent.inventoryRequestHash=preparation.requestHash;intent.lines[0].reservations[0].expectedVersion=f.issue.payload.lines[0].reservations[0].expectedVersion;
    changeIntent?.(intent);
    const locked=await sales.lockLinesForFulfillmentInTransaction(tx,intent);
    await f.item.getFulfillmentInventoryProfilesInTransaction(tx,[String(f.s.skuId)],{atMs:f.time.nowMs()});
    const inventoryResult=await f.inventory.postFulfillmentIssueBatchInTransaction(tx,f.issue,preparation);
    const result=await sales.applyFulfillmentResultInTransaction(tx,{intent,inventoryResult:changeResult?changeResult(structuredClone(inventoryResult)):inventoryResult});
    const root=sql.findIndex(statement=>/FROM sales_orders WHERE id=\? FOR UPDATE/u.test(statement));
    const claims=sql.map((statement,index)=>/INSERT INTO inventory_operation_requests/u.test(statement)?index:-1).filter(index=>index>=0);
    assert.ok((locked.replay||root>=0&&claims.every(index=>index<root))&&claims.length>0,"all Inventory operation preclaims precede the first Sales domain root; post must not claim");
    return {result,inventoryResult,intent,locked};
  });
}
async function stateOf(f){
  const tables=["sales_orders","sales_order_lines","sales_order_line_reservations","sales_operation_requests","sales_order_status_history","sales_audit_logs","inventory_operation_requests","inventory_stock_controls","inventory_stock_balances","inventory_reservations","inventory_allocations","inventory_movements","inventory_audit_logs"];
  const state={};for(const table of tables)state[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return state;
}
nativeTest("actual Sales/Item/Inventory allocation then Shipment uses current Inventory CAS while retaining Sales last-sync provenance",async t=>{
  const f=await jointFixture(t),confirmed=await confirm(f);
  assert.equal(confirmed.result.status,"COMPLETED");assert.equal(confirmed.result.version,2);
  const [[mapping]]=await f.db.query("SELECT * FROM sales_order_line_reservations WHERE id=?",[f.mappingId]);
  assert.equal(mapping.inventory_version,3);assert.equal(String(mapping.inventory_operation_id),String(f.root));assert.equal(mapping.source_event_id,f.reserveEvent);
  assert.equal(Number(mapping.consumed_base_quantity),1);assert.equal(Number(mapping.outstanding_base_quantity),0);
});

nativeTest("real Inventory posting and all Sales effects roll back on a late Sales audit failure",async t=>{
  const f=await jointFixture(t),before=await stateOf(f),failed=f.createService({inventoryFulfillment:f.inventory,audit:{async record(){throw new Error("synthetic late Sales audit failure");}}});
  await assert.rejects(()=>confirm(f,failed),error=>error.cause?.message==="synthetic late Sales audit failure");
  assert.deepEqual(await stateOf(f),before);
  assert.equal((await confirm(f)).result.status,"COMPLETED");
});
nativeTest("overstated Inventory CAS and changed owner receipt cannot produce any joint effect",async t=>{
  const f=await jointFixture(t),before=await stateOf(f),invalid=structuredClone(f.issue);
  invalid.payload.lines[0].reservations[0].expectedVersion=99;
  await assert.rejects(()=>confirm({...f,issue:invalid}),{code:"VERSION_CONFLICT"});assert.deepEqual(await stateOf(f),before);
  let changed=false;
  await assert.rejects(()=>confirm(f,f.sales,{changeResult:result=>{changed=true;result.lines[0].reservations[0].baseQuantity="2";return result;}}),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
  assert.equal(changed,true,"tampering refusal must occur after the real Inventory post");
  assert.deepEqual(await stateOf(f),before);
});

nativeTest("actual joint exact replay returns the original result after real reversal and preserves original reserve and consumed allocation",async t=>{
  const f=await jointFixture(t),confirmed=await confirm(f),issued=confirmed.inventoryResult.lines[0].reservations[0],leg=issued.allocations[0];
  const beforeReplay=await stateOf(f);assert.deepEqual((await confirm(f)).result,confirmed.result);assert.deepEqual(await stateOf(f),beforeReplay);
  const reverseEvent=randomUUID(),reverse={actor:f.issue.actor,source:{documentId:"1",eventId:reverseEvent},correlationId:"",payload:{fulfillmentId:"1",shipmentId:"1",lines:[{fulfillmentLineId:"1",salesOrderLineId:String(f.s.lineId),baseQuantity:"1",reservations:[{claimId:"1",inventoryReservationId:String(f.reservationId),expectedVersion:issued.version,baseQuantity:"1",originalInventoryOperationId:issued.inventoryOperationId,allocations:[{shipmentIssueId:"1",originalMovementId:leg.movementId,inventoryAllocationId:leg.inventoryAllocationId,expectedBalanceVersion:leg.balanceVersion,baseQuantity:"1"}]}]}]}};
  const reverseOnce=()=>f.run({claims:f.claims},async tx=>{
    const proof=await f.inventory.claimFulfillmentBatchInTransaction(tx,{action:"REVERSE",command:reverse});
    const intent=f.command();Object.assign(intent,{purpose:"SHIPMENT_REVERSED",eventId:reverseEvent,originalConfirmationEventId:confirmed.intent.eventId,expectedOrderVersion:2,inventoryRequestHash:proof.requestHash});
    intent.lines[0].expectedVersion=2;Object.assign(intent.lines[0].reservations[0],{expectedVersion:issued.version,originalInventoryOperationId:issued.inventoryOperationId});
    await f.sales.lockLinesForFulfillmentInTransaction(tx,intent);
    const inventoryResult=await f.inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction(tx,reverse,proof);
    return f.sales.applyFulfillmentResultInTransaction(tx,{intent,inventoryResult});
  });
  const reversed=await reverseOnce();assert.equal(reversed.status,"CONFIRMED");assert.equal(reversed.version,3);
  const [[allocation]]=await f.db.query("SELECT status,consumed_quantity,outstanding_quantity,version FROM inventory_allocations WHERE id=?",[leg.inventoryAllocationId]);
  assert.deepEqual([allocation.status,Number(allocation.consumed_quantity),Number(allocation.outstanding_quantity),allocation.version],["CONSUMED",1,0,2]);
  const afterReverse=await stateOf(f);assert.deepEqual(await reverseOnce(),reversed);assert.deepEqual((await confirm(f)).result,confirmed.result);assert.deepEqual(await stateOf(f),afterReverse);
  const [[mapping]]=await f.db.query("SELECT * FROM sales_order_line_reservations WHERE id=?",[f.mappingId]);
  assert.equal(mapping.inventory_version,4);assert.equal(String(mapping.inventory_operation_id),String(f.root));assert.equal(mapping.source_event_id,f.reserveEvent);
  const stale=structuredClone(f.issue);stale.source.eventId=randomUUID();stale.payload.lines[0].reservations[0].expectedVersion=3;
  let posts=0;const post=f.inventory.postFulfillmentIssueBatchInTransaction.bind(f.inventory);
  f.inventory.postFulfillmentIssueBatchInTransaction=(...args)=>{posts++;return post(...args);};
  await assert.rejects(()=>confirm({...f,issue:stale},f.sales,{changeIntent:intent=>{intent.expectedOrderVersion=3;intent.lines[0].expectedVersion=3;}}),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
  assert.equal(posts,0,"Inventory CAS below Sales last-sync must fail before posting");assert.deepEqual(await stateOf(f),afterReverse);
});

nativeTest("a version jump cannot conceal changed actual Inventory quantities",async t=>{
  const f=await jointFixture(t);
  // Deliberate corrupt Inventory state: a larger original quantity is not a benign allocation-only version gap.
  await f.db.execute("UPDATE inventory_reservations SET original_quantity=2,outstanding_quantity=2,version=version+1 WHERE id=?",[f.reservationId]);
  await f.db.execute("UPDATE inventory_stock_controls SET reserved_quantity=2 WHERE warehouse_id=? AND sku_id=?",[f.s.warehouseId,f.s.skuId]);
  f.issue.payload.lines[0].reservations[0].expectedVersion=3;
  const before=await stateOf(f);let posted=false;
  await assert.rejects(()=>confirm(f,f.sales,{changeResult:result=>{posted=true;return result;}}),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
  assert.equal(posted,true,"quantity refusal must follow the real Inventory post, not a stale precondition");assert.deepEqual(await stateOf(f),before);
});
async function quantityPreservingBatch(f,action,payload){
  return f.run({claims:f.claims},async tx=>{
    const command={actor:f.issue.actor,source:{documentId:"1",eventId:randomUUID()},correlationId:"",payload};
    const proof=await f.inventory.claimFulfillmentBatchInTransaction(tx,{action,command});
    const claim=f.command();claim.purpose="CLAIM";for(const key of ["eventId","shipmentId","inventoryRequestHash"])delete claim[key];
    // CLAIM checks the unchanged Sales last-sync projection; the separate Inventory command carries its current CAS version.
    await f.sales.lockLinesForFulfillmentInTransaction(tx,claim);
    await f.item.getFulfillmentInventoryProfilesInTransaction(tx,[String(f.s.skuId)],{atMs:f.time.nowMs()});
    const method={ALLOCATE:"allocateForFulfillmentBatchInTransaction",RELEASE:"releaseFulfillmentAllocationsInTransaction",REALLOCATE:"reallocateFulfillmentBatchInTransaction"}[action];
    return f.inventory[method](tx,command,proof);
  });
}
nativeTest("real reallocate, release and allocate again preserve quantities before a Shipment synchronizes Sales to the actual Inventory version",async t=>{
  const f=await jointFixture(t),old=f.allocated.lines[0].reservations[0],leg=old.allocations[0];
  const bin=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"MOVE",normalized_code:"move",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});
  const balance=String(await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:bin,sku_id:f.s.skuId,stock_status:"AVAILABLE",on_hand_quantity:10,allocated_quantity:0,fifo_anchor_date:"2023-11-15",created_at:f.s.now,updated_at:f.s.now}));
  const line=member=>({fulfillmentId:"1",lines:[{fulfillmentLineId:"1",salesOrderLineId:String(f.s.lineId),baseQuantity:"1",reservations:[member]}]});
  const moved=await quantityPreservingBatch(f,"REALLOCATE",line({claimId:"1",inventoryReservationId:String(f.reservationId),expectedVersion:2,baseQuantity:"1",overrideReason:"Move to another pick location",releases:[{inventoryAllocationId:leg.inventoryAllocationId,inventoryBalanceId:f.balanceId,expectedVersion:1,expectedBalanceVersion:2,baseQuantity:"1"}],allocations:[{inventoryBalanceId:balance,expectedBalanceVersion:1,baseQuantity:"1"}]}));
  const movedLeg=moved.lines[0].reservations[0].allocations[0];
  const released=await quantityPreservingBatch(f,"RELEASE",line({claimId:"1",inventoryReservationId:String(f.reservationId),expectedVersion:3,baseQuantity:"1",allocations:[{inventoryAllocationId:movedLeg.inventoryAllocationId,inventoryBalanceId:balance,expectedVersion:1,expectedBalanceVersion:2,baseQuantity:"1"}]}));
  assert.equal(released.lines[0].reservations[0].version,4);
  const allocated=await quantityPreservingBatch(f,"ALLOCATE",line({claimId:"1",inventoryReservationId:String(f.reservationId),expectedVersion:4,baseQuantity:"1",overrideReason:"",allocations:[{inventoryBalanceId:f.balanceId,expectedBalanceVersion:3,baseQuantity:"1"}]}));
  const member=allocated.lines[0].reservations[0],allocatedLeg=member.allocations[0];
  assert.equal(member.version,5);assert.equal((await f.db.query("SELECT inventory_version FROM sales_order_line_reservations WHERE id=?",[f.mappingId]))[0][0].inventory_version,1);
  f.issue.payload.lines[0].reservations[0]={claimId:"1",inventoryReservationId:String(f.reservationId),expectedVersion:member.version,baseQuantity:"1",allocations:[{inventoryAllocationId:allocatedLeg.inventoryAllocationId,inventoryBalanceId:f.balanceId,expectedVersion:allocatedLeg.allocationVersion,expectedBalanceVersion:allocatedLeg.balanceVersion,baseQuantity:"1"}]};
  const before=await stateOf(f),stale=structuredClone(f.issue);stale.payload.lines[0].reservations[0].expectedVersion=2;
  await assert.rejects(()=>confirm({...f,issue:stale}),{code:"VERSION_CONFLICT"});assert.deepEqual(await stateOf(f),before);
  assert.equal((await confirm(f)).result.status,"COMPLETED");
  assert.equal((await f.db.query("SELECT inventory_version FROM sales_order_line_reservations WHERE id=?",[f.mappingId]))[0][0].inventory_version,6);
});

nativeTest("strict Sales CLAIM last-sync and real Inventory locked current-state projection remain distinct",async t=>{
  const f=await jointFixture(t),before=await stateOf(f);
  await f.run({claims:f.claims},async tx=>{
    const claim=f.command();claim.purpose="CLAIM";for(const key of ["eventId","shipmentId","inventoryRequestHash"])delete claim[key];
    const locked=await f.sales.lockLinesForFulfillmentInTransaction(tx,claim);
    assert.equal(locked.order.lines[0].reservationMappings[0].inventoryVersion,1);
    const current=await f.lookup.lockFulfillmentReservationStatesInTransaction(tx,{warehouseId:String(f.s.warehouseId),salesOrderId:String(f.s.orderId),members:[{inventoryReservationId:String(f.reservationId),salesOrderLineId:String(f.s.lineId),skuId:String(f.s.skuId)}]});
    assert.equal(current.length,1);assert.equal(current[0].version,2);assert.equal(current[0].originalQuantity,"1");assert.equal(current[0].outstandingQuantity,"1");assert.equal(current[0].consumedQuantity,"0");assert.equal(current[0].releasedQuantity,"0");assert.equal(current[0].status,"ACTIVE");assert.equal(current[0].originalSourceEventId,f.reserveEvent);
    assert.ok(Object.isFrozen(current)&&Object.isFrozen(current[0]));
  });
  assert.deepEqual(await stateOf(f),before);
  await assert.rejects(()=>f.run({claims:f.claims},async tx=>{
    const claim=f.command();claim.purpose="CLAIM";for(const key of ["eventId","shipmentId","inventoryRequestHash"])delete claim[key];claim.lines[0].reservations[0].expectedVersion=2;
    await f.sales.lockLinesForFulfillmentInTransaction(tx,claim);
  }),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});assert.deepEqual(await stateOf(f),before);
});
