import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { salesFulfillmentFixture } from "../sales/phase4/salesFulfillmentFixtures.js";
import { ItemLookupService } from "../../src/modules/item/ItemLookupService.js";

const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function jointFixture(t,baseQuantity=1){
  const [{InventoryFulfillmentService},{InventoryLookupService}]=await Promise.all([import("../../src/modules/inventory/InventoryFulfillmentService.js"),import("../../src/modules/inventory/InventoryLookupService.js")]);
  const f=await salesFulfillmentFixture(t,baseQuantity),time={...f.time,fileDate:()=>"2023-11-14"};
  // Complete the confirmed-order fixture's existing reserve provenance; allocation must not rewrite its Sales last-sync version.
  const [[reservation]]=await f.db.query("SELECT create_operation_id FROM inventory_reservations WHERE id=?",[f.reservationId]);
  await f.db.execute("UPDATE inventory_operation_requests SET source_module='SALES',source_document_type='SALES_ORDER',source_document_id=?,source_line_id=? WHERE id=?",[String(f.s.orderId),String(f.s.lineId),reservation.create_operation_id]);
  await f.db.execute("UPDATE item_skus SET inventory_tracked=1 WHERE id=?",[f.s.skuId]);
  const binId=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"JOINT",normalized_code:"joint",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});
  const balanceId=String(await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:binId,sku_id:f.s.skuId,stock_status:"AVAILABLE",on_hand_quantity:10,allocated_quantity:0,fifo_anchor_date:"2023-11-13",created_at:f.s.now,updated_at:f.s.now}));
  await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,reserved_quantity:baseQuantity,created_at:f.s.now,updated_at:f.s.now});
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

nativeTest("real Reverse accepts a fresh reverse-only principal and consumed Reservation with historical inactive Item/SKU",async t=>{
  const f=await jointFixture(t),confirmed=await confirm(f),member=confirmed.inventoryResult.lines[0].reservations[0],leg=member.allocations[0];
  const {claims,actor}=await reverseOnlyActor(f);
  assert.equal(claims.permissions.includes("fulfillment.operation"),false);
  await f.db.execute("UPDATE item_skus SET status='inactive' WHERE id=?",[f.s.skuId]);
  await f.db.execute("UPDATE items SET status='inactive' WHERE id=(SELECT item_id FROM item_skus WHERE id=?)",[f.s.skuId]);
  assert.equal((await f.db.query("SELECT status FROM inventory_reservations WHERE id=?",[f.reservationId]))[0][0].status,"CONSUMED");
  const eventId=randomUUID(),command={actor,source:{documentId:"1",eventId},correlationId:"",payload:{fulfillmentId:"1",shipmentId:"1",lines:[{fulfillmentLineId:"1",salesOrderLineId:String(f.s.lineId),baseQuantity:"1",reservations:[{claimId:"1",inventoryReservationId:String(f.reservationId),expectedVersion:member.version,baseQuantity:"1",originalInventoryOperationId:member.inventoryOperationId,allocations:[{shipmentIssueId:"1",originalMovementId:leg.movementId,inventoryAllocationId:leg.inventoryAllocationId,expectedBalanceVersion:leg.balanceVersion,baseQuantity:"1"}]}]}]}};
  const result=await f.run({claims},async tx=>{
    const proof=await f.inventory.claimFulfillmentBatchInTransaction(tx,{action:"REVERSE",command});
    const intent=f.command();Object.assign(intent,{actor:{...actor,userId:String(actor.userId)},purpose:"SHIPMENT_REVERSED",eventId,originalConfirmationEventId:confirmed.intent.eventId,expectedOrderVersion:2,inventoryRequestHash:proof.requestHash});intent.lines[0].expectedVersion=2;Object.assign(intent.lines[0].reservations[0],{expectedVersion:member.version,originalInventoryOperationId:member.inventoryOperationId});
    await f.sales.lockLinesForFulfillmentInTransaction(tx,intent);
    const inventoryResult=await f.inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction(tx,command,proof);
    return f.sales.applyFulfillmentResultInTransaction(tx,{intent,inventoryResult});
  });
  assert.equal(result.status,"CONFIRMED");assert.equal(result.version,3);
  assert.equal((await f.db.query("SELECT outstanding_quantity FROM inventory_reservations WHERE id=?",[f.reservationId]))[0][0].outstanding_quantity,1);
});

async function reverseOnlyActor(f){
  const roleName=f.label+"_reverse",userId=await f.s.insert("users",{username:roleName,password_hash:"synthetic-only",display_name:"Reverse only",created_at:f.s.now,updated_at:f.s.now}),roleId=await f.s.insert("roles",{name:roleName,created_at:f.s.now});
  await f.db.execute("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)",[userId,roleId]);
  await f.db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name IN ('fulfillment.view','fulfillment.reverse')",[roleId]);
  const claims={sub:String(userId),roles:[roleName],permissions:["fulfillment.reverse","fulfillment.view"]},actor={userId,serviceName:"",claimedRoles:claims.roles,claimedPermissions:claims.permissions};
  return {claims,actor};
}
async function f2ReversalFixture(t,inactive=true){
  const f=await jointFixture(t,2),confirmed=await confirm(f),original=confirmed.inventoryResult.lines[0].reservations[0],leg=original.allocations[0];
  assert.equal(confirmed.result.status,"PARTIALLY_FULFILLED");
  const allocation={actor:f.issue.actor,source:{documentId:"2",eventId:randomUUID()},correlationId:"",payload:{fulfillmentId:"2",lines:[{fulfillmentLineId:"2",salesOrderLineId:String(f.s.lineId),baseQuantity:"1",reservations:[{claimId:"2",inventoryReservationId:String(f.reservationId),expectedVersion:original.version,baseQuantity:"1",overrideReason:"",allocations:[{inventoryBalanceId:f.balanceId,expectedBalanceVersion:leg.balanceVersion,baseQuantity:"1"}]}]}]}};
  const f2=await f.run({claims:f.claims},async tx=>{
    const proof=await f.inventory.claimFulfillmentBatchInTransaction(tx,{action:"ALLOCATE",command:allocation});
    const claim=f.command();Object.assign(claim,{purpose:"CLAIM",expectedOrderVersion:2});for(const key of ["eventId","shipmentId","inventoryRequestHash"])delete claim[key];claim.lines[0].expectedVersion=2;claim.lines[0].reservations[0].expectedVersion=original.version;
    await f.sales.lockLinesForFulfillmentInTransaction(tx,claim);
    await f.item.getFulfillmentInventoryProfilesInTransaction(tx,[String(f.s.skuId)],{atMs:f.time.nowMs()});
    return f.inventory.allocateForFulfillmentBatchInTransaction(tx,allocation,proof);
  });
  const current=f2.lines[0].reservations[0],f2leg=current.allocations[0];assert.equal(current.version,4);
  assert.equal((await f.db.query("SELECT inventory_version FROM sales_order_line_reservations WHERE id=?",[f.mappingId]))[0][0].inventory_version,3);
  const reverse=await reverseOnlyActor(f);
  if(inactive){await f.db.execute("UPDATE item_skus SET status='inactive' WHERE id=?",[f.s.skuId]);await f.db.execute("UPDATE items SET status='inactive' WHERE id=(SELECT item_id FROM item_skus WHERE id=?)",[f.s.skuId]);}
  return {...f,confirmed,original,leg,current,f2leg,reverse};
}
async function readReversalPreparation(f){
  return f.run({claims:f.reverse.claims},async tx=>{
    const statements=[],query=tx.query.bind(tx),execute=tx.execute.bind(tx);
    tx.query=(sql,args)=>{statements.push(sql);return query(sql,args);};tx.execute=(sql,args)=>{statements.push(sql);return execute(sql,args);};
    try{
      const result=await f.lookup.getFulfillmentReversalPreparationInTransaction(tx,{shipmentId:"1",originalInventoryOperationIds:[f.original.inventoryOperationId]});
      assert.ok(statements.length>0&&statements.every(sql=>/^\s*SELECT\b/iu.test(sql)&&! /\bFOR\s+(UPDATE|SHARE)\b/iu.test(sql)),"advisory preparation must neither claim/write nor take operation/domain locks");
      return result;
    }finally{tx.query=query;tx.execute=execute;}
  });
}
function reversePayload(f,advisory){
  const ownIssueMirror=new Map([[f.leg.movementId,{shipmentIssueId:"1",inventoryAllocationId:f.leg.inventoryAllocationId}]]);
  return {fulfillmentId:advisory.fulfillmentId,shipmentId:advisory.shipmentId,lines:advisory.lines.map(line=>({fulfillmentLineId:line.fulfillmentLineId,salesOrderLineId:line.salesOrderLineId,baseQuantity:line.baseQuantity,reservations:line.reservations.map(member=>({claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,baseQuantity:member.baseQuantity,expectedVersion:member.expectedVersion,originalInventoryOperationId:member.originalInventoryOperationId,allocations:member.allocations.map(leg=>{
    const issue=ownIssueMirror.get(leg.originalMovementId);assert.ok(issue);assert.equal(issue.inventoryAllocationId,leg.inventoryAllocationId);
    return {shipmentIssueId:issue.shipmentIssueId,originalMovementId:leg.originalMovementId,inventoryAllocationId:leg.inventoryAllocationId,baseQuantity:leg.baseQuantity,expectedBalanceVersion:leg.expectedBalanceVersion};
  })}))}))};
}
async function restoreFromPayload(f,payload,eventId,untrustedPreparation){
  const command={actor:f.reverse.actor,source:{documentId:"1",eventId},correlationId:"",payload};
  return f.run({claims:f.reverse.claims},async tx=>{
    if(untrustedPreparation)await assert.rejects(()=>f.inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction(tx,command,untrustedPreparation),{code:"INVENTORY_SOURCE_CONFLICT"});
    const proof=await f.inventory.claimFulfillmentBatchInTransaction(tx,{action:"REVERSE",command});
    const intent=f.command();Object.assign(intent,{actor:{...f.reverse.actor,userId:String(f.reverse.actor.userId)},purpose:"SHIPMENT_REVERSED",eventId,originalConfirmationEventId:f.confirmed.intent.eventId,expectedOrderVersion:2,inventoryRequestHash:proof.requestHash});intent.lines[0].expectedVersion=2;Object.assign(intent.lines[0].reservations[0],{expectedVersion:payload.lines[0].reservations[0].expectedVersion,originalInventoryOperationId:f.original.inventoryOperationId});
    await f.sales.lockLinesForFulfillmentInTransaction(tx,intent);
    const inventoryResult=await f.inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction(tx,command,proof);return f.sales.applyFulfillmentResultInTransaction(tx,{intent,inventoryResult});
  });
}
nativeTest("real F2 neutral CAS and reverse-only historical advisory prepare the original F1 restore without granting proof authority",async t=>{
  const f=await f2ReversalFixture(t),before=await stateOf(f),advisory=await readReversalPreparation(f),member=advisory.lines[0].reservations[0];
  assert.equal(advisory.originalOperationId,f.confirmed.inventoryResult.operationId);assert.equal(member.originalInventoryOperationId,f.original.inventoryOperationId);assert.equal(member.expectedVersion,4);assert.equal(member.currentState.consumedQuantity,"1");assert.equal(member.currentState.outstandingQuantity,"1");assert.equal(member.currentState.originalQuantity,"2");assert.equal(member.currentState.status,"PARTIALLY_CONSUMED");assert.deepEqual(await stateOf(f),before);
  for(const input of [{shipmentId:"999",originalInventoryOperationIds:[f.original.inventoryOperationId]},{shipmentId:"1",originalInventoryOperationIds:[]},{shipmentId:"1",originalInventoryOperationIds:[f.original.inventoryOperationId,f.original.inventoryOperationId]},{shipmentId:"1",originalInventoryOperationIds:[f.confirmed.inventoryResult.operationId]}]){
    await assert.rejects(()=>f.run({claims:f.reverse.claims},tx=>f.lookup.getFulfillmentReversalPreparationInTransaction(tx,input)),error=>/^(INVENTORY_|REVERSAL_)/u.test(error.code??""));
  }
  assert.deepEqual(await stateOf(f),before);
  const result=await restoreFromPayload(f,reversePayload(f,advisory),randomUUID(),advisory);
  assert.equal(result.status,"CONFIRMED");assert.equal(result.lines[0].reservedOutstandingBaseQuantity,"2");
  const [[mapping]]=await f.db.query("SELECT * FROM sales_order_line_reservations WHERE id=?",[f.mappingId]);assert.equal(mapping.inventory_version,5);assert.equal(String(mapping.inventory_operation_id),String(f.root));assert.equal(mapping.source_event_id,f.reserveEvent);
  const [[held]]=await f.db.query("SELECT status,outstanding_quantity,version FROM inventory_allocations WHERE id=?",[f.f2leg.inventoryAllocationId]);assert.deepEqual([held.status,Number(held.outstanding_quantity),held.version],["ACTIVE",1,1]);
  const [[balance]]=await f.db.query("SELECT on_hand_quantity,allocated_quantity FROM inventory_stock_balances WHERE id=?",[f.balanceId]);assert.deepEqual([Number(balance.on_hand_quantity),Number(balance.allocated_quantity)],[10,1]);
});
nativeTest("a real F2 release after advisory read makes Reverse reject stale CAS atomically; reprepare and persisted-command replay remain valid",async t=>{
  const f=await f2ReversalFixture(t,false),stale=await readReversalPreparation(f),release={actor:f.issue.actor,source:{documentId:"2",eventId:randomUUID()},correlationId:"",payload:{fulfillmentId:"2",lines:[{fulfillmentLineId:"2",salesOrderLineId:String(f.s.lineId),baseQuantity:"1",reservations:[{claimId:"2",inventoryReservationId:String(f.reservationId),expectedVersion:4,baseQuantity:"1",allocations:[{inventoryAllocationId:f.f2leg.inventoryAllocationId,inventoryBalanceId:f.balanceId,expectedVersion:1,expectedBalanceVersion:f.f2leg.balanceVersion,baseQuantity:"1"}]}]}]}};
  await f.run({claims:f.claims},async tx=>{
    const proof=await f.inventory.claimFulfillmentBatchInTransaction(tx,{action:"RELEASE",command:release});
    const claim=f.command();Object.assign(claim,{purpose:"CLAIM",expectedOrderVersion:2});for(const key of ["eventId","shipmentId","inventoryRequestHash"])delete claim[key];claim.lines[0].expectedVersion=2;claim.lines[0].reservations[0].expectedVersion=3;
    await f.sales.lockLinesForFulfillmentInTransaction(tx,claim);await f.item.getFulfillmentInventoryProfilesInTransaction(tx,[String(f.s.skuId)],{atMs:f.time.nowMs()});await f.inventory.releaseFulfillmentAllocationsInTransaction(tx,release,proof);
  });
  const before=await stateOf(f);await assert.rejects(()=>restoreFromPayload(f,reversePayload(f,stale),randomUUID()),{code:"VERSION_CONFLICT"});assert.deepEqual(await stateOf(f),before);
  const fresh=await readReversalPreparation(f);assert.equal(fresh.lines[0].reservations[0].expectedVersion,5);
  const payload=reversePayload(f,fresh),eventId=randomUUID(),result=await restoreFromPayload(f,payload,eventId);assert.equal(result.status,"CONFIRMED");
  assert.equal((await f.db.query("SELECT inventory_version FROM sales_order_line_reservations WHERE id=?",[f.mappingId]))[0][0].inventory_version,6);
  const after=await stateOf(f);await assert.rejects(()=>readReversalPreparation(f),{code:"REVERSAL_NOT_ALLOWED"});assert.deepEqual(await restoreFromPayload(f,payload,eventId),result);assert.deepEqual(await stateOf(f),after);
});
