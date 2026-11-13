import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { p1Fixture,addSourceLine } from "./p1Fixture.js";
import { shipmentDraftFixture } from "./p1CancellationFixture.js";
import { FulfillmentAllocationService } from "../../src/modules/fulfillment/FulfillmentAllocationService.js";
import { FulfillmentPickingService } from "../../src/modules/fulfillment/FulfillmentPickingService.js";
import { ShipmentService } from "../../src/modules/fulfillment/ShipmentService.js";
import { ShipmentConfirmationService } from "../../src/modules/fulfillment/ShipmentConfirmationService.js";
import { ShipmentReversalService } from "../../src/modules/fulfillment/ShipmentReversalService.js";
import { salesFulfillmentIntentHash } from "../../src/modules/sales/SalesFulfillmentService.js";
import { salesPayloadHash } from "../../src/modules/sales/salesCanonicalHash.js";
import { getActiveTransactionIsolation } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import { getTransactionOutcome } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import { FulfillmentDownstreamMatterService } from "../../src/modules/fulfillment/FulfillmentDownstreamMatterService.js";
import { up as issueUp } from "../../database/migrations/0097_create_shipment_issues_and_reversals.js";
import { up as archiveUp,FULFILLMENT_ARCHIVE_TABLES } from "../../database/migrations/0099_create_fulfillment_archives.js";

export const reversalTables=["sales_orders","sales_order_lines","sales_order_line_reservations","sales_operation_requests","sales_order_status_history","sales_audit_logs","inventory_reservations","inventory_stock_controls","inventory_stock_balances","inventory_allocations","inventory_movements","inventory_operation_requests","inventory_audit_logs","fulfillments","fulfillment_lines","fulfillment_line_reservation_claims","fulfillment_allocations","fulfillment_status_history","fulfillment_audit_logs","fulfillment_operation_requests","shipments","shipment_lines","shipment_issue_details","shipment_status_history","shipment_reversals","shipment_reversal_details"];
export const inventoryTables=["inventory_reservations","inventory_stock_controls","inventory_stock_balances","inventory_allocations","inventory_movements","inventory_operation_requests","inventory_audit_logs"];
export const fixtureRegistry=Object.freeze({version:"NO_DOWNSTREAM_MODULES_V1",returns:"NO_PROVIDER_REQUIRED",invoicing:"NO_PROVIDER_REQUIRED"});
export async function facts(f,tables=reversalTables){const result={};for(const table of tables)result[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return result;}
export async function sequence(f){return (await f.db.query("SELECT * FROM fulfillment_document_sequences ORDER BY id"))[0];}
export async function supportFacts(f){
 const tables=["users","roles","permissions","user_roles","role_permissions","fr_schema_migrations","currencies","supplier_settings","customer_settings","customers","customer_addresses","customer_address_purposes","inventory_warehouses","item_uoms","items","item_categories","item_brands","item_skus","item_sku_uoms","inventory_bins","inventory_lots","sales_archive_batches","sales_archive_order_manifests",...FULFILLMENT_ARCHIVE_TABLES.map(spec=>spec.table)],result={};
 for(const table of tables)result[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY 1,2`))[0];return result;
}
export const nativeActor=(f,work)=>f.context.storage.run({databaseTransaction:null,signal:null,auth:{claims:{sub:String(f.actor.userId),roles:f.actor.claimedRoles,permissions:f.actor.claimedPermissions}}},work);

export async function reversalFixture(t,{twoLines=false,archives=false,noDownstream=false,preflightConfiguration=false}={}){
 const f=twoLines?await p1Fixture(t,5,{preflightConfiguration}):await shipmentDraftFixture(t,{preflightConfiguration});
 const second=twoLines?await addSourceLine(f,5):null;
 await issueUp(f.db);
 if(archives){await archiveUp(f.db);for(const spec of FULFILLMENT_ARCHIVE_TABLES){const [[row]]=await f.db.query(`SELECT COUNT(*) AS total FROM ${spec.table}`);assert.equal(Number(row.total),0,spec.table);}}
 const options=twoLines?{database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}}:f.options;
 let draft;
 if(twoLines){
  const root=await f.execute(()=>f.fulfillments.create({eventId:randomUUID(),salesOrderId:f.s.orderId,salesOrderVersion:2,lines:[{salesOrderLineId:f.s.lineId,plannedBaseQuantity:"5"},{salesOrderLineId:second.lineId,plannedBaseQuantity:"5"}]}));
  const sources=[{skuId:f.s.skuId,reservationId:f.reservationId,salesOrderLineId:f.s.lineId,amounts:[2,3],picked:[2,1]},{skuId:second.skuId,reservationId:second.reservationId,salesOrderLineId:second.lineId,amounts:[5],picked:[0]}];
  let ordinal=0;
  for(const source of sources){source.balances=[];for(const amount of source.amounts){ordinal++;const bin=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"REV-"+ordinal,normalized_code:"rev-"+ordinal,status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});source.balances.push(await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:bin,sku_id:source.skuId,stock_status:"AVAILABLE",on_hand_quantity:amount,allocated_quantity:0,fifo_anchor_date:"2023-11-"+(10+ordinal),created_at:f.s.now,updated_at:f.s.now}));}}
  const allocator=new FulfillmentAllocationService(options),picking=new FulfillmentPickingService(options);
  const allocated=await f.execute(()=>allocator.allocate(root.outcome.id,{eventId:randomUUID(),version:1,lines:sources.map(source=>({fulfillmentLineId:Number(root.fulfillment.lines.find(line=>line.salesOrderLineId===String(source.salesOrderLineId)).id),overrideReason:"",allocations:source.balances.map((balance,index)=>({inventoryReservationId:Number(source.reservationId),inventoryBalanceId:Number(balance),balanceVersion:1,baseQuantity:String(source.amounts[index])}))}))}));
  await f.execute(()=>picking.confirmPick(root.outcome.id,{eventId:randomUUID(),version:2,lines:sources.map(source=>{
   const line=allocated.fulfillment.lines.find(row=>row.salesOrderLineId===String(source.salesOrderLineId));
   return {fulfillmentLineId:Number(line.id),shortPickReason:"Synthetic goods missing from the original bin",allocations:source.balances.map((balance,index)=>{const allocation=allocated.fulfillment.allocations.items.find(row=>row.fulfillmentLineId===line.id&&row.inventoryBalanceId===String(balance));return {fulfillmentAllocationId:Number(allocation.id),inventoryAllocationVersion:allocation.inventoryVersion,pickedBaseQuantity:String(source.picked[index])};})};
  })}));
  await f.s.insert("customer_address_purposes",{address_id:f.s.addressId,customer_id:f.s.customerId,purpose_code:"shipping",is_default:1,created_at:f.s.now,updated_at:f.s.now});
  draft=await f.execute(()=>new ShipmentService(options).createDraft(root.outcome.id,{eventId:randomUUID(),shippingAddressId:f.s.addressId,shippingAddressVersion:1,totalWeight:"1.25",weightUom:"KG"}));
 }else draft=await f.create(f.body());
 const confirmation=new ShipmentConfirmationService(options),originalEventId=randomUUID();
 const confirming=await f.execute(()=>confirmation.startConfirmation(draft.outcome.id,{eventId:originalEventId,version:1}));
 const shipped=await f.execute(()=>confirmation.completeConfirmation(confirming));assert.equal(shipped.outcome,"SHIPPED");
 const [[shipment]]=await f.db.query("SELECT * FROM shipments WHERE id=?",[draft.outcome.id]);assert.equal(shipment.status,"SHIPPED");assert.equal(Number(shipment.version),3);
 const reversal=new ShipmentReversalService({...options,...(noDownstream?{downstreamRegistry:fixtureRegistry}:{})});
 assert.ok(confirmation.sales.inventoryFulfillment===confirmation.inventoryLookup.fulfillment,"Actual same-instance Inventory receipt verifier");
 assert.ok(reversal.sales.inventoryFulfillment===reversal.inventoryLookup.fulfillment,"Actual REVERSE same-instance Inventory receipt verifier");
 const command={eventId:randomUUID(),version:3,reason:"Synthetic wrong dispatch remains under company control",goodsUnderCompanyControl:true,goodsReturnedToOriginalBins:true};
 return {...f,options,confirmation,reversal,shipment,shipmentId:String(shipment.id),originalEventId,command,startCalls:0,completionCalls:0};
}
export async function startReversal(f){f.startCalls++;const started=await f.execute(()=>f.reversal.startReversal(f.shipmentId,f.command));if(!f.started)f.started=started;return started;}
export function completeReversal(f,started=f.started,options={}){f.completionCalls++;return f.execute(()=>f.reversal.completeReversalPhaseB(started,options));}
export function observeCommittedInputs(f){
 const inventory=f.reversal.inventoryLookup.fulfillment,sales=f.reversal.sales,post=inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction,lock=sales.lockLinesForFulfillmentInTransaction,apply=sales.applyFulfillmentResultInTransaction;
 const observed=f.posting={posts:0,locks:0,applies:0};
 inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction=async function(tx,command,proof){observed.posts++;assert.equal(observed.posts,1);assert.ok(tx===f.database.context.get()?.databaseTransaction);observed.command=command;observed.proof=proof;const result=await post.call(this,tx,command,proof);observed.inventoryResult=result;return result;};
 sales.lockLinesForFulfillmentInTransaction=async function(tx,intent){observed.locks++;assert.equal(observed.locks,1);assert.ok(tx===f.database.context.get()?.databaseTransaction);observed.intent=intent;observed.salesHash=salesFulfillmentIntentHash(intent);return lock.call(this,tx,intent);};
 sales.applyFulfillmentResultInTransaction=async function(tx,command){observed.applies++;assert.equal(observed.applies,1);assert.ok(command.inventoryResult===observed.inventoryResult);const result=await apply.call(this,tx,command);observed.salesResult=result;return result;};
 return {restore(){inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction=post;sales.lockLinesForFulfillmentInTransaction=lock;sales.applyFulfillmentResultInTransaction=apply;}};
}

export async function removeReversePermission(f,userId){
 const [rows]=await f.db.query("SELECT rp.role_id,rp.permission_id FROM role_permissions rp JOIN user_roles ur ON ur.role_id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=? AND p.name='fulfillment.reverse'",[userId]);assert.equal(rows.length,1);
 const row=rows[0],[changed]=await f.db.execute("DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",[row.role_id,row.permission_id]);assert.equal(changed.affectedRows,1);
 return async()=>{const [restored]=await f.db.execute("INSERT INTO role_permissions(role_id,permission_id) VALUES (?,?)",[row.role_id,row.permission_id]);assert.equal(restored.affectedRows,1);};
}
// Observe only the actual business executor, not a proxy or a replacement context.
export function observeReverseClaim(f,observe){
 const inventory=f.reversal.inventoryLookup.fulfillment,original=inventory.claimFulfillmentBatchInTransaction;
 let calls=0;
 inventory.claimFulfillmentBatchInTransaction=async function(tx,input){
  assert.ok(this===inventory&&tx===f.database.context.get()?.databaseTransaction,"Real owner and actual context executor");assert.equal(getActiveTransactionIsolation(tx),"READ COMMITTED");
  assert.equal(input.action,"REVERSE");assert.equal(input.command.source.eventId,f.command.eventId);assert.equal(input.command.source.documentId,f.shipmentId);calls++;
  await observe(tx,input);return original.call(this,tx,input);
 };
 return {get calls(){return calls;},restore(){inventory.claimFulfillmentBatchInTransaction=original;}};
}
export async function renewedRow(tx,f){const [[row]]=await tx.query("SELECT id,event_id,lease_owner,attempt_count,payload_hash,status,lease_expires_at,updated_at FROM fulfillment_operation_requests WHERE id=? AND event_id=?",[f.started.operationId,f.command.eventId]);assert.ok(row);assert.equal(row.status,"IN_PROGRESS");return row;}
export async function assertRolledBack(f,before,renewal){
 assert.ok(renewal,"Actual published renewal observed before business preclaim");
 const expected=structuredClone(before),old=expected.fulfillment_operation_requests.find(row=>String(row.id)===f.started.operationId);
 for(const field of ["event_id","lease_owner","attempt_count","payload_hash","status"])assert.equal(renewal[field],old[field],field);
 old.lease_expires_at=renewal.lease_expires_at;old.updated_at=renewal.updated_at;
 assert.deepEqual(await facts(f),expected,"All 26 tables roll back, except the exact original ER published lease fields");
}

export function assertCommittedReversal(before,after,f){
 const added=table=>after[table].filter(row=>!before[table].some(old=>String(old.id)===String(row.id)));
 const json=value=>typeof value==="string"?JSON.parse(value):value,id=value=>String(value),observed=f.posting;assert.ok(observed);assert.deepEqual([observed.posts,observed.locks,observed.applies],[1,1,1]);
 const issues=before.shipment_issue_details,details=added("shipment_reversal_details"),movements=added("inventory_movements");assert.equal(details.length,issues.length);assert.equal(movements.length,issues.length);
 assert.deepEqual(after.fulfillment_allocations,before.fulfillment_allocations,"Historical CONSUMED and fully RELEASED allocation rows remain unchanged");assert.deepEqual(after.inventory_allocations,before.inventory_allocations,"Inventory Allocation status/version remain unchanged");
 for(const issue of issues){const detail=details.find(row=>String(row.shipment_issue_detail_id)===String(issue.id)),movement=movements.find(row=>String(row.reversal_of_movement_id)===String(issue.inventory_movement_id)),linked=after.shipment_issue_details.find(row=>String(row.id)===String(issue.id));assert.ok(detail&&movement&&linked);assert.equal(String(detail.inventory_reversal_movement_id),String(movement.id));assert.equal(String(detail.inventory_reversal_operation_id),String(movement.operation_request_id));assert.equal(String(linked.reversal_movement_id),String(movement.id));assert.equal(String(movement.quantity),String(issue.issued_base_quantity));assert.equal(movement.movement_type,"REVERSAL");assert.equal(movement.direction,"IN");for(const field of ["warehouse_id","bin_id","lot_id","stock_status_snapshot"]){const target=field==="stock_status_snapshot"?"stock_status":field;assert.equal(movement[target],issue[field],field);}const expected={...issue,reversal_movement_id:movement.id};assert.deepEqual(linked,expected);}
 for(const issue of issues){
  const detail=details.find(row=>id(row.shipment_issue_detail_id)===id(issue.id)),movement=movements.find(row=>id(row.reversal_of_movement_id)===id(issue.inventory_movement_id)),child=before.shipment_lines.find(row=>id(row.id)===id(issue.shipment_line_id)),allocation=before.fulfillment_allocations.find(row=>id(row.id)===id(issue.fulfillment_allocation_id)),reservation=before.inventory_reservations.find(row=>id(row.id)===id(issue.inventory_reservation_id)),balance=before.inventory_stock_balances.find(row=>id(row.id)===id(issue.inventory_balance_id));assert.ok(child&&allocation&&reservation&&balance);
  assert.equal(id(detail.reversal_id),f.started.reversal.id);assert.equal(id(detail.shipment_id),f.shipmentId);assert.equal(id(detail.reversed_base_quantity),id(issue.issued_base_quantity));
  for(const field of ["inventory_reservation_id","warehouse_id","bin_id","lot_id","stock_status_snapshot"])assert.deepEqual(detail[field],issue[field],field);
  assert.equal(id(child.shipment_id),f.shipmentId);assert.equal(id(child.fulfillment_line_id),id(allocation.fulfillment_line_id));assert.equal(id(allocation.inventory_reservation_id),id(issue.inventory_reservation_id));assert.equal(id(allocation.inventory_allocation_id),id(issue.inventory_allocation_id));
  assert.equal(id(movement.sku_id),id(child.sku_id));assert.equal(id(movement.reservation_id),id(issue.inventory_reservation_id));assert.equal(id(movement.allocation_id),id(issue.inventory_allocation_id));assert.equal(id(movement.posted_by),id(f.userId));assert.equal(id(movement.balance_before),id(balance.on_hand_quantity));assert.equal(BigInt(movement.balance_after),BigInt(balance.on_hand_quantity)+BigInt(issue.issued_base_quantity));assert.equal(Number(movement.balance_version_after),Number(balance.version)+1);
  const memberQuantity=issues.filter(row=>id(row.inventory_reservation_id)===id(reservation.id)).reduce((sum,row)=>sum+BigInt(row.issued_base_quantity),0n),state={originalQuantity:id(reservation.original_quantity),consumedQuantity:id(reservation.consumed_quantity),releasedQuantity:id(reservation.released_quantity),outstandingQuantity:id(reservation.outstanding_quantity),status:reservation.status,version:Number(reservation.version)};
  assert.deepEqual(json(detail.reservation_before_summary),state);assert.deepEqual(json(detail.reservation_after_summary),{...state,consumedQuantity:(BigInt(state.consumedQuantity)-memberQuantity).toString(),outstandingQuantity:(BigInt(state.outstandingQuantity)+memberQuantity).toString(),status:"ACTIVE",version:state.version+1});
 }
 for(const reservation of before.inventory_reservations){const q=issues.filter(row=>String(row.inventory_reservation_id)===String(reservation.id)).reduce((sum,row)=>sum+BigInt(row.issued_base_quantity),0n),actual=after.inventory_reservations.find(row=>String(row.id)===String(reservation.id));if(q===0n){assert.deepEqual(actual,reservation);continue;}assert.equal(BigInt(actual.consumed_quantity),BigInt(reservation.consumed_quantity)-q);assert.equal(BigInt(actual.outstanding_quantity),BigInt(reservation.outstanding_quantity)+q);assert.equal(Number(actual.version),Number(reservation.version)+1);assert.equal(actual.status,"ACTIVE");for(const field of ["original_quantity","released_quantity","create_operation_id","warehouse_id","sku_id"])assert.equal(actual[field],reservation[field],field);}
 for(const balance of before.inventory_stock_balances){const own=issues.filter(row=>String(row.inventory_balance_id)===String(balance.id)),q=own.reduce((sum,row)=>sum+BigInt(row.issued_base_quantity),0n),actual=after.inventory_stock_balances.find(row=>String(row.id)===String(balance.id));assert.equal(BigInt(actual.on_hand_quantity),BigInt(balance.on_hand_quantity)+q);assert.equal(actual.allocated_quantity,balance.allocated_quantity);assert.equal(Number(actual.version),Number(balance.version)+own.length);}
 for(const control of before.inventory_stock_controls){const lineIds=before.fulfillment_lines.filter(row=>String(row.sku_id)===String(control.sku_id)).map(row=>String(row.id)),members=before.fulfillment_line_reservation_claims.filter(row=>lineIds.includes(String(row.fulfillment_line_id))&&BigInt(row.consumed_quantity)>0n),q=members.reduce((sum,row)=>sum+BigInt(row.consumed_quantity),0n),actual=after.inventory_stock_controls.find(row=>String(row.id)===String(control.id));assert.equal(BigInt(actual.reserved_quantity),BigInt(control.reserved_quantity)+q);assert.equal(Number(actual.version),Number(control.version)+members.length);if(q===0n)assert.deepEqual(actual,control);}
 for(const claim of before.fulfillment_line_reservation_claims){const actual=after.fulfillment_line_reservation_claims.find(row=>String(row.id)===String(claim.id));if(BigInt(claim.consumed_quantity)===0n){assert.deepEqual(actual,claim);continue;}assert.equal(actual.consumed_quantity,claim.consumed_quantity);assert.equal(actual.released_quantity,claim.released_quantity);assert.equal(String(actual.reversed_quantity),String(claim.consumed_quantity));assert.equal(String(actual.active_claimed_quantity),"0");assert.equal(actual.status,"REVERSED");assert.equal(Number(actual.inventory_version),Number(claim.inventory_version)+1);}
 for(const line of before.fulfillment_lines){const actual=after.fulfillment_lines.find(row=>String(row.id)===String(line.id)),child=after.shipment_lines.find(row=>String(row.fulfillment_line_id)===String(line.id));assert.equal(String(actual.reversed_base_quantity),String(line.shipped_base_quantity));assert.equal(String(child.reversed_base_quantity),String(line.shipped_base_quantity));assert.equal(Number(actual.version),Number(line.version)+(BigInt(line.shipped_base_quantity)>0n?1:0));}
 for(const mapping of before.sales_order_line_reservations){const q=issues.filter(row=>String(row.inventory_reservation_id)===String(mapping.inventory_reservation_id)).reduce((sum,row)=>sum+BigInt(row.issued_base_quantity),0n),actual=after.sales_order_line_reservations.find(row=>String(row.id)===String(mapping.id));assert.equal(BigInt(actual.consumed_base_quantity),BigInt(mapping.consumed_base_quantity)-q);assert.equal(BigInt(actual.outstanding_base_quantity),BigInt(mapping.outstanding_base_quantity)+q);assert.equal(Number(actual.inventory_version),Number(mapping.inventory_version)+(q>0n?1:0));if(q===0n)assert.deepEqual(actual,mapping);for(const field of ["inventory_operation_id","source_event_id","original_base_quantity","released_base_quantity"])assert.equal(actual[field],mapping[field],field);}
 assert.equal(after.sales_orders[0].status,"CONFIRMED");assert.equal(Number(after.sales_orders[0].version),Number(before.sales_orders[0].version)+1);
 for(const table of ["fulfillments","shipments","shipment_reversals"]){assert.equal(after[table][0].status,"REVERSED",table);assert.equal(Number(after[table][0].version),Number(before[table][0].version)+1);}
 const op=after.fulfillment_operation_requests.find(row=>row.event_id===f.command.eventId);assert.equal(op.status,"SUCCEEDED");assert.equal(op.lease_owner,"");assert.equal(op.lease_expires_at,null);assert.equal(op.public_error_code,"");assert.equal(op.public_error_details,null);assert.notEqual(op.completed_at,null);assert.deepEqual(typeof op.result_json==="string"?JSON.parse(op.result_json):op.result_json,{id:f.shipmentId,number:before.shipments[0].shipment_number,status:"REVERSED",version:f.command.version+2});assert.equal(added("fulfillment_audit_logs").length,3);assert.equal(added("fulfillment_status_history").length,1);assert.equal(added("shipment_status_history").length,1);
 const sales=after.sales_operation_requests.find(row=>row.event_id===f.command.eventId);assert.equal(sales.status,"SUCCEEDED");assert.equal(sales.command_type,"SHIPMENT_REVERSED");assert.equal(added("sales_order_status_history").length,1);assert.equal(added("sales_audit_logs").length,1);
 assert.equal(op.operation_type,"REVERSE");assert.equal(op.target_type,"SHIPMENT");assert.equal(id(op.target_id),f.shipmentId);assert.equal(id(op.initiated_by),id(f.userId));assert.equal(op.correlation_id,f.started.correlationId);assert.equal(op.payload_hash,before.fulfillment_operation_requests.find(row=>row.event_id===f.command.eventId).payload_hash);
 assert.equal(sales.target_type,"FULFILLMENT_SOURCE");assert.equal(id(sales.target_id),f.shipmentId);assert.equal(id(sales.actor_user_id),id(f.userId));assert.equal(sales.request_hash,observed.salesHash);assert.equal(sales.result_type,"FULFILLMENT_SOURCE");assert.equal(id(sales.result_id),id(before.sales_orders[0].id));assert.deepEqual(json(sales.result_summary),observed.salesResult);
 const recovery=json(sales.recovery_payload);assert.deepEqual(recovery.intent,observed.intent);assert.equal(recovery.intent.inventoryRequestHash,observed.proof.requestHash);assert.equal(recovery.applyHash,salesPayloadHash(observed.inventoryResult));assert.equal(recovery.resultHash,salesPayloadHash(observed.salesResult));assert.equal(recovery.membersHash,salesPayloadHash(recovery.inventoryMembers));assert.notEqual(sales.completed_at,null);
 const journals=added("inventory_operation_requests"),root=journals.find(row=>id(row.id)===observed.proof.operationId);assert.ok(root);assert.equal(root.command_type,"FULFILLMENT_BATCH_REVERSE");assert.equal(root.source_document_type,"SHIPMENT");assert.equal(root.source_line_id,"");assert.equal(root.request_hash,observed.proof.requestHash);assert.equal(root.result_type,"FULFILLMENT_BATCH_REVERSE");assert.equal(id(root.result_id),f.shipmentId);assert.equal(observed.inventoryResult.operationId,id(root.id));
 const rootSummary=json(root.result_summary);assert.equal(rootSummary.fulfillmentId,id(before.fulfillments[0].id));assert.equal(rootSummary.memberCount,observed.inventoryResult.lines.flatMap(line=>line.reservations).length);assert.equal(rootSummary.lineSnapshot,JSON.stringify(observed.command.payload.lines.map(line=>[line.fulfillmentLineId,line.salesOrderLineId,line.baseQuantity])));
 const expectedMembers=[];
 for(const line of observed.inventoryResult.lines)for(const member of line.reservations){
  const journal=journals.find(row=>id(row.id)===member.inventoryOperationId);assert.ok(journal);assert.equal(journal.command_type,"FULFILLMENT_REVERSE_ISSUE");assert.equal(journal.source_document_type,"SHIPMENT");assert.equal(journal.source_line_id,member.claimId);assert.equal(journal.result_type,"FULFILLMENT_REVERSE_MEMBER");assert.equal(id(journal.result_id),member.claimId);
  const summary=json(journal.result_summary);for(const field of ["claimId","inventoryReservationId","expectedVersion","version","baseQuantity","originalInventoryOperationId"])assert.deepEqual(summary[field],member[field],field);assert.equal(summary.rootOperationId,id(root.id));assert.equal(summary.rootRequestHash,observed.proof.requestHash);assert.equal(summary.fulfillmentLineId,line.fulfillmentLineId);assert.equal(summary.salesOrderLineId,line.salesOrderLineId);assert.equal(summary.legCount,member.allocations.length);
  expectedMembers.push({claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,baseQuantity:member.baseQuantity,inventoryOperationId:member.inventoryOperationId});
  for(const [index,leg]of member.allocations.entries()){
   const journal=journals.find(row=>row.source_document_type==="SHIPMENT_LEG"&&row.source_line_id===`${member.claimId}:${index+1}`);assert.ok(journal);assert.equal(journal.command_type,"FULFILLMENT_BATCH_LEG");assert.equal(journal.result_type,"FULFILLMENT_LEG");assert.equal(id(journal.result_id),leg.inventoryAllocationId);
   const summary=json(journal.result_summary);for(const field of ["inventoryAllocationId","inventoryBalanceId","movementId","baseQuantity","allocationVersion","balanceVersion","shipmentIssueId","originalMovementId"])assert.deepEqual(summary[field],leg[field],field);assert.equal(summary.rootOperationId,id(root.id));assert.equal(summary.rootRequestHash,observed.proof.requestHash);assert.equal(summary.memberOperationId,member.inventoryOperationId);assert.equal(summary.legOrdinal,index+1);assert.equal(summary.legKind,"REVERSE");
   const movement=movements.find(row=>id(row.id)===leg.movementId);assert.ok(movement);assert.equal(id(movement.operation_request_id),member.inventoryOperationId);assert.equal(id(movement.reversal_of_movement_id),leg.originalMovementId);
  }
 }
 assert.deepEqual(recovery.inventoryMembers,expectedMembers);
 for(const line of before.sales_order_lines){const q=before.fulfillment_lines.filter(row=>String(row.sales_order_line_id)===String(line.id)).reduce((sum,row)=>sum+BigInt(row.shipped_base_quantity),0n),actual=after.sales_order_lines.find(row=>String(row.id)===String(line.id));assert.equal(BigInt(actual.fulfilled_base_quantity),BigInt(line.fulfilled_base_quantity)-q);assert.equal(BigInt(actual.reserved_outstanding_base_quantity),BigInt(line.reserved_outstanding_base_quantity)+q);assert.equal(Number(actual.version),Number(line.version)+(q>0n?1:0));if(q===0n)assert.deepEqual(actual,line);}
 const mutable={sales_orders:["status","version","updated_at","last_business_updated_at","updated_by"],sales_order_lines:["reserved_outstanding_base_quantity","fulfilled_base_quantity","version","updated_at"],sales_order_line_reservations:["consumed_base_quantity","outstanding_base_quantity","status","inventory_version","updated_at"],inventory_reservations:["consumed_quantity","outstanding_quantity","status","version","updated_at","updated_by"],inventory_stock_controls:["reserved_quantity","version","updated_at"],inventory_stock_balances:["on_hand_quantity","fifo_anchor_date","version","updated_at"],fulfillments:["status","reversed_at","reversed_by","version","updated_at","last_business_updated_at","updated_by"],fulfillment_lines:["reversed_base_quantity","version","updated_at"],fulfillment_line_reservation_claims:["reversed_quantity","status","inventory_version","updated_at"],fulfillment_operation_requests:["status","result_json","public_error_code","public_error_details","lease_owner","lease_expires_at","next_attempt_at","updated_at","completed_at"],shipments:["status","reversed_at","reversed_by","version","updated_at","last_business_updated_at","updated_by"],shipment_lines:["reversed_base_quantity","updated_at"],shipment_issue_details:["reversal_movement_id"],shipment_reversals:["status","version","after_summary","completed_at","completed_by"]};
 const memberCount=before.fulfillment_line_reservation_claims.filter(row=>BigInt(row.consumed_quantity)>0n).length,newCounts={sales_operation_requests:1,sales_order_status_history:1,sales_audit_logs:1,inventory_movements:issues.length,inventory_operation_requests:1+memberCount+issues.length,inventory_audit_logs:memberCount,fulfillment_status_history:1,fulfillment_audit_logs:3,shipment_status_history:1,shipment_reversal_details:issues.length};
 for(const table of reversalTables){
  assert.equal(added(table).length,newCounts[table]??0,table+" exact new row count");assert.equal(after[table].length,before[table].length+(newCounts[table]??0),table+" no removed rows");
  for(const row of before[table]){const actual=after[table].find(item=>String(item.id)===String(row.id));assert.ok(actual,table+" retained original row");const allowed=table==="fulfillment_operation_requests"&&row.event_id!==f.command.eventId?[]:(mutable[table]??[]),keep=value=>Object.fromEntries(Object.entries(value).filter(([field])=>!allowed.includes(field)));assert.deepEqual(keep(actual),keep(row),table+" unchanged original fields");}
 }
 for(const row of added("inventory_operation_requests")){assert.equal(row.source_module,"FULFILLMENT");assert.equal(row.source_document_id,f.shipmentId);assert.equal(id(row.actor_user_id),id(f.userId));assert.equal(row.source_event_id,f.command.eventId);assert.equal(row.correlation_id,f.started.correlationId);assert.equal(row.request_id,f.started.correlationId);assert.notEqual(row.completed_at,null);}
 for(const row of added("inventory_audit_logs")){assert.equal(row.action,"movement.reverse");assert.equal(row.outcome,"SUCCEEDED");assert.equal(row.correlation_id,f.started.correlationId);assert.ok(movements.some(movement=>String(movement.operation_request_id)===String(row.operation_request_id)));}
 for(const table of ["sales_order_status_history","sales_audit_logs","fulfillment_status_history","fulfillment_audit_logs","shipment_status_history"])for(const row of added(table)){assert.equal(row.event_id,f.command.eventId);assert.equal(String(row.actor_user_id),String(f.userId));}
 const date=value=>value instanceof Date?value.toISOString().slice(0,10):value;
 for(const balance of before.inventory_stock_balances){const actual=after.inventory_stock_balances.find(row=>String(row.id)===String(balance.id)),legs=issues.filter(row=>String(row.inventory_balance_id)===String(balance.id));assert.equal(date(actual.fifo_anchor_date),legs.length&&Number(balance.on_hand_quantity)===0?f.options.time.fileDate():date(balance.fifo_anchor_date));}
}

export function mapperData(){
 const root={id:"1",active_shipment_id:"2",sales_order_id:"3",customer_id:"4",warehouse_id:"5",line_count:1},shipment={id:"2",fulfillment_id:"1",sales_order_id:"3",customer_id:"4",warehouse_id:"5",line_count:1,confirmation_event_id:"00000000-0000-4000-8000-000000000001"};
 const line={id:"10",fulfillment_id:"1",sales_order_id:"3",sales_order_line_id:"11",sku_id:"12",base_uom_id:"13",shipped_base_quantity:"3",reversed_base_quantity:"0"},child={id:"20",shipment_id:"2",fulfillment_id:"1",fulfillment_line_id:"10",sales_order_line_id:"11",sku_id:"12",base_uom_id:"13",shipped_base_quantity:"3",reversed_base_quantity:"0"};
 const claim={id:"30",fulfillment_id:"1",fulfillment_line_id:"10",sales_order_line_reservation_id:"41",inventory_reservation_id:"40",consumed_quantity:"3",active_claimed_quantity:"0",reversed_quantity:"0",status:"CONSUMED",inventory_version:3};
 const allocations=["2","1"].map((q,i)=>({id:String(50+i),fulfillment_id:"1",fulfillment_line_id:"10",claim_id:"30",inventory_reservation_id:"40",inventory_allocation_id:String(60+i),inventory_balance_id:String(70+i),warehouse_id:"5",bin_id:String(80+i),lot_id:null,stock_status_snapshot:"AVAILABLE",picked_base_quantity:q,status:"CONSUMED",balance_version:2}));
 const issues=allocations.map((a,i)=>({id:String(90+i),shipment_id:"2",shipment_line_id:"20",fulfillment_allocation_id:a.id,inventory_operation_id:"100",inventory_movement_id:String(110+i),inventory_reservation_id:"40",inventory_allocation_id:a.inventory_allocation_id,inventory_balance_id:a.inventory_balance_id,warehouse_id:"5",bin_id:a.bin_id,lot_id:null,stock_status_snapshot:"AVAILABLE",warehouse_code_snapshot:"WH",bin_code_snapshot:i?"B":"A",lot_number_snapshot:"",expiry_date_snapshot:null,sku_code_snapshot:"SYN",base_uom_code_snapshot:"EA",issued_base_quantity:a.picked_base_quantity,reversal_movement_id:null}));
 const sales={salesOrderId:"3",shipmentId:"2",originalConfirmationEventId:shipment.confirmation_event_id,customerId:"4",warehouseId:"5",observedVersion:2,lines:[{salesOrderLineId:"11",observedVersion:2,baseQuantity:"3",reservations:[{claimId:"30",salesReservationMappingId:"41",inventoryReservationId:"40",originalInventoryOperationId:"100",baseQuantity:"3",inventoryVersionFloor:3,consumedBaseQuantity:"3",outstandingBaseQuantity:"2"}]}]};
 const inventory={fulfillmentId:"1",shipmentId:"2",originalOperationId:"120",lines:[{fulfillmentLineId:"10",salesOrderLineId:"11",baseQuantity:"3",reservations:[{claimId:"30",inventoryReservationId:"40",originalInventoryOperationId:"100",expectedVersion:3,baseQuantity:"3",currentState:{originalQuantity:"5",consumedQuantity:"3",releasedQuantity:"0",outstandingQuantity:"2",status:"PARTIALLY_CONSUMED",version:3},allocations:issues.map(row=>({inventoryAllocationId:row.inventory_allocation_id,originalMovementId:row.inventory_movement_id,baseQuantity:row.issued_base_quantity,expectedBalanceVersion:2,bucketSnapshot:{warehouseId:"5",warehouseCode:"WH",binId:row.bin_id,binCode:row.bin_code_snapshot,lotId:null,lotNumber:null,expiryDate:null,stockStatus:"AVAILABLE",skuId:"12",skuCode:"SYN",skuName:"Synthetic",baseUomId:"13",baseUomCode:"EA",postedAt:1}}))}]}]};
 return {snapshot:{root,shipment,lines:[line],shipmentLines:[child],claims:[claim],allocations,issues},sales,inventory};
}

// Fixed TASK036 native Job harness. Every interception forwards the real receiver,
// executor, arguments and result; no capability or owner proof is manufactured.
export async function boundReversalCleanup(work,timeoutMs){
 let timer;
 try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("TASK036 owned work did not drain within its existing cleanup budget")),timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
export async function reversalRecoveryRuntime({applicationSource,eventId,shipmentId,restart=false}){
 const {createApplication}=await import("../../src/framework/application/createApplication.js");
 const app=await createApplication({configurationSource:applicationSource});
 const database=app.services.require("mysqldatabase"),scheduler=app.services.require("scheduler"),name="fulfillment.reversalRecovery";
 const reached=Promise.withResolvers(),resume=Promise.withResolvers();
 const state={service:null,declared:false,missingIssue:false,loseTakeoverAck:false,cloneChecks:restart,dispatches:0,recoveries:[],proofs:[],takeovers:[],phaseBs:0,posts:0,preclaims:0,missingRows:0,cloneRefusals:0,ackLosses:0,destroys:0,releasesAfterAck:0,unknownOutcomes:[],phaseBReached:reached.promise,resumePhaseB:resume.resolve};
 const originalRecover=ShipmentReversalService.prototype.recoverExpiredReversal,originalPhaseB=ShipmentReversalService.prototype.completeReversalPhaseB;
 const restorers=[],executors=new WeakMap(),wrapped=new WeakSet(),callbacks=new Set(),dispatches=new Set();
 function observeOwner(owner,method,label){
  const original=owner[method];
  owner[method]=async function(tx,session,proof){
   if(state.cloneChecks){await assert.rejects(original.call(this,tx,session,structuredClone(proof)),{code:label==="inventory"?"INVENTORY_SOURCE_CONFLICT":"SALES_FULFILLMENT_CONTRACT_MISMATCH"});state.cloneRefusals++;}
   const result=await original.call(this,tx,session,proof);state.proofs.push({owner:label,result:structuredClone(result)});return result;
  };
  restorers.push(()=>{owner[method]=original;});
 }
 ShipmentReversalService.prototype.recoverExpiredReversal=async function(id,...args){
  if(this.database!==database||id!==eventId)return originalRecover.call(this,id,...args);
  if(!state.service){
   state.service=this;
   observeOwner(this.inventoryLookup,"verifyShipmentReversalZeroEffectProofInTransaction","inventory");
   observeOwner(this.sales,"verifyShipmentReversalZeroEffectProofInTransaction","sales");
   const inventory=this.inventoryLookup.fulfillment,claim=inventory.claimFulfillmentBatchInTransaction,post=inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction;
   inventory.claimFulfillmentBatchInTransaction=function(...input){state.preclaims++;return claim.apply(this,input);};
   inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction=function(...input){state.posts++;return post.apply(this,input);};
   restorers.push(()=>{inventory.claimFulfillmentBatchInTransaction=claim;inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction=post;});
  }
  assert.equal(this,state.service,"One genuine private Job-held service");
  if(state.declared&&!(this.downstream instanceof FulfillmentDownstreamMatterService&&state.installedDownstream===this.downstream)){
   const previous=this.downstream;this.downstream=new FulfillmentDownstreamMatterService({database,registry:fixtureRegistry});state.installedDownstream=this.downstream;restorers.push(()=>{this.downstream=previous;});
  }
  try{const result=await originalRecover.call(this,id,...args);state.recoveries.push({state:result.state});return result;}
  catch(error){state.recoveries.push({error:error.code??error.name});throw error;}
 };
 ShipmentReversalService.prototype.completeReversalPhaseB=async function(...args){
  if(this.database!==database)return originalPhaseB.apply(this,args);
  state.phaseBs++;
  if(restart){reached.resolve();await resume.promise;}
  return originalPhaseB.apply(this,args);
 };
 const originalTransaction=database.withTransaction;
 database.withTransaction=async function(work,options){
  let actual;
  try{return await originalTransaction.call(this,(tx,details)=>{actual=tx;executors.set(tx.target,tx);const callback=Promise.resolve().then(()=>work(tx,details));callbacks.add(callback);callback.then(()=>callbacks.delete(callback),()=>callbacks.delete(callback));return callback;},options);}
  finally{if(actual&&getTransactionOutcome(actual)?.state==="INDETERMINATE")state.unknownOutcomes.push(getTransactionOutcome(actual));}
 };
 const originalGet=database.pool.getConnection;
 database.pool.getConnection=async function(){
  const connection=await originalGet.call(this);if(wrapped.has(connection))return connection;wrapped.add(connection);
  const query=connection.query,execute=connection.execute,commit=connection.commit,destroy=connection.destroy,release=connection.release;
  let takeover=false,ambiguous=false;
  connection.query=async function(input,values){
   const result=await query.call(this,input,values),sql=input.sql??input;
   if(state.missingIssue&&sql.includes("FROM shipment_issue_details")&&String(values?.[0])===shipmentId){
    assert.ok(result[0].length>0);state.missingRows++;return [result[0].slice(1),result[1]];
   }
   return result;
  };
  connection.execute=async function(input,values){
   const result=await execute.call(this,input,values),sql=input.sql??input;
   if(sql.startsWith("UPDATE fulfillment_operation_requests SET lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1")&&values?.[4]===eventId){
    assert.equal(result[0].affectedRows,1);takeover=true;state.takeovers.push({nonce:values[0],oldAttempt:Number(values[10]),tx:executors.get(connection)});
   }
   return result;
  };
  connection.commit=async function(){
   const result=await commit.call(this);
   if(takeover){takeover=false;if(state.loseTakeoverAck){state.loseTakeoverAck=false;ambiguous=true;state.ackLosses++;throw Object.assign(new Error("TASK036 takeover committed; synthetic ACK loss"),{code:"PROTOCOL_CONNECTION_LOST"});}}
   return result;
  };
  connection.destroy=function(){if(ambiguous)state.destroys++;return destroy.call(this);};
  connection.release=function(){if(ambiguous)state.releasesAfterAck++;return release.call(this);};
  restorers.push(()=>{connection.query=query;connection.execute=execute;connection.commit=commit;connection.destroy=destroy;connection.release=release;});
  return connection;
 };
 let job,closing;
 const abortOwned=()=>{for(const entry of scheduler.running.values())entry.controller.abort(new Error("TASK036 owned cleanup"));};
 const close=async()=>{
  return closing??=(async()=>{
   abortOwned();resume.resolve();
   const budget=applicationSource.application.shutdownTimeoutMs,deadline=performance.now()+budget;
   const stopped=await scheduler.stop({timeoutMs:budget});assert.equal(stopped.drained,true,"Actual Scheduler jobs drained before hook/DB teardown");
   await boundReversalCleanup(Promise.allSettled([...callbacks,...dispatches]),Math.max(1,deadline-performance.now()));
   assert.equal(callbacks.size,0);assert.equal(dispatches.size,0);assert.equal(scheduler.running.size,0);
   const refresh={...scheduler.stats.get("tokenRevocation.refresh")};assert.ok(refresh.runs+refresh.failures<=8);assert.equal(refresh.failures,0);assert.equal(refresh.timeouts,0);
   const result=await app.shutdown("task036_owned_functional_complete");assert.equal(result.exitCode,0);assert.equal(result.schedulerDrained,true);assert.equal(result.servicesClosed,true);
   state.cleanup={drained:true,callbacks:callbacks.size,dispatches:dispatches.size,jobs:scheduler.running.size,shutdownExitCode:result.exitCode,refreshRuns:refresh.runs,refreshFailures:refresh.failures};
   ShipmentReversalService.prototype.recoverExpiredReversal=originalRecover;ShipmentReversalService.prototype.completeReversalPhaseB=originalPhaseB;
   database.withTransaction=originalTransaction;database.pool.getConnection=originalGet;
   for(const restore of restorers.reverse())restore();
  })();
 };
 return {app,database,scheduler,state,close,abortOwned,
  async start(){
   await app.start();
   assert.equal(database.config.transactionTimeoutMs,20000);assert.equal(database.config.connectionLimit,10);
   const refresh=scheduler.jobs.get("tokenRevocation.refresh");assert.equal(refresh?.enabled,true);assert.equal(refresh.intervalMs,30000);
   assert.equal(scheduler.jobs.has(name),false,"No product activation");
   const service=await app.services.resolve("job.fulfillmentReversalRecovery"),prepare=scheduler.prepareAndSchedule;
   let prepared;
   scheduler.prepareAndSchedule=function(candidate){const result=prepare.call(this,candidate);if(candidate.name===name)prepared=result;return result;};
   try{scheduler.register(service);assert.ok(prepared);await prepared;}
   finally{scheduler.prepareAndSchedule=prepare;}
   job=scheduler.jobs.get(name);assert.ok(job?.enabled);const timer=scheduler.timers.get(name);assert.ok(timer);scheduler.clearTimer(timer);scheduler.timers.delete(name);
   return service;
  },
  async dispatch(expected){
   assert.ok(job);assert.ok(["succeeded","failed"].includes(expected));const previous=state.recoveries.length,before={...scheduler.stats.get(name)};state.dispatches++;
   const execution=scheduler.execute(job);dispatches.add(execution);
   try{await execution;}finally{dispatches.delete(execution);}
   assert.equal(scheduler.running.has(name),false);
   const stats=scheduler.stats.get(name);assert.equal(stats.lastOutcome,expected);
   assert.equal(stats.runs,before.runs+(expected==="succeeded"?1:0));assert.equal(stats.failures,before.failures+(expected==="failed"?1:0));assert.equal(stats.runs+stats.failures,state.dispatches);
   for(const field of ["timeouts","skippedNotLeader","skippedOverlapping"])assert.equal(stats[field],before[field],field);
   return state.recoveries.slice(previous);
  }
 };
}
