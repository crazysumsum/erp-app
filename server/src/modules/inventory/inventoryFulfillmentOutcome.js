import { inventoryOperationHash } from "./InventoryOperationService.js";
import { readFulfillmentInventoryBatch,readOriginalFulfillmentIssueBatch } from "./inventoryFulfillmentReceipts.js";
import { readFulfillmentAllocationScope } from "./inventoryFulfillmentAllocationPreparation.js";
import { fulfillmentInventoryFields,fulfillmentInventoryId,fulfillmentInventoryVersion } from "./inventoryFulfillmentValidation.js";
import { inventoryError } from "./inventoryErrors.js";

const READ_TRANSACTIONS=new WeakSet();
const WRITE_TRANSACTIONS=new WeakSet();
const fail=()=>{throw inventoryError("INVENTORY_SOURCE_CONFLICT");};
const marks=rows=>rows.map(()=>"?").join(",");
const key=value=>String(value);
const quantity=value=>BigInt(fulfillmentInventoryId(key(value),{zero:true}));
const parse=value=>{try{return typeof value==="string"?JSON.parse(value):value;}catch{fail();}};
const unique=values=>[...new Set(values)].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
function indexed(rows,column="id"){const result=new Map(rows.map(row=>[key(row[column]),row]));if(result.size!==rows.length)fail();return result;}
function counterStatus(row,cancellable=false){
 const outstanding=quantity(row.outstanding_quantity),consumed=quantity(row.consumed_quantity),released=quantity(row.released_quantity);
 if(outstanding>0n){if(row.status!==(consumed>0n?"PARTIALLY_CONSUMED":"ACTIVE"))fail();}
 else if(!["CONSUMED","RELEASED",...(cancellable?["CANCELLED"]:[])].includes(row.status)||row.status==="CONSUMED"&&consumed===0n||["RELEASED","CANCELLED"].includes(row.status)&&released===0n)fail();
}
async function readBinLocks(tx,binIds){
 let rows,missing;
 try{[rows]=await tx.query(`SELECT id FROM inventory_bin_locks WHERE bin_id IN (${marks(binIds)}) AND released_at IS NULL ORDER BY bin_id,id FOR SHARE`,binIds);}
 catch(error){if((error?.cause?.code??error?.code)!=="ER_NO_SUCH_TABLE")throw error;missing=error;}
 const [tables]=await tx.query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('inventory_stocktakes','inventory_bin_locks') ORDER BY table_name");
 // Match the existing Inventory lock owner's optional Stocktake boundary; a partial installation is never an empty lock set.
 if(missing){if(tables.length!==0)throw missing;return [];}
 if(tables.length!==2)throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
 return rows;
}
export function markFulfillmentReconciliationRead(tx){if(WRITE_TRANSACTIONS.has(tx))fail();READ_TRANSACTIONS.add(tx);}
export function enterFulfillmentWriteMode(tx){if(READ_TRANSACTIONS.has(tx))fail();WRITE_TRANSACTIONS.add(tx);}

// The caller holds the genuine early event gate; this is admission, not a zero-effect proof.
export async function readFulfillmentShipmentEventAdmission(tx,eventId){
 const [rows]=await tx.query("SELECT id FROM inventory_operation_requests WHERE source_module='FULFILLMENT' AND source_document_type IN ('SHIPMENT','SHIPMENT_LEG') AND source_event_id=? LIMIT 1",[eventId]);
 return {state:rows.length?"UNKNOWN":"CLEAR"};
}

// Authority is checked by the owner's private verifier before calling these SQL helpers.
export async function prepareFulfillmentIssueOutcome(tx,source){
 const [[scope]]=await tx.query("SELECT * FROM inventory_operation_requests WHERE source_module='FULFILLMENT' AND source_document_type='PICK_SCOPE' AND source_document_id=? AND source_line_id='' AND source_event_id='scope-v1' FOR SHARE",[source.fulfillmentId]);
 const summary=scope?parse(scope.result_summary):null;
 if(!scope||scope.command_type!=="FULFILLMENT_SCOPE_LOCK"||scope.result_type!=="FULFILLMENT_SCOPE"||scope.result_id!==source.fulfillmentId||scope.completed_at===null||scope.request_hash!==inventoryOperationHash({commandType:"FULFILLMENT_SCOPE_LOCK",payload:{fulfillmentId:source.fulfillmentId}})||summary?.warehouseId!==source.warehouseId||summary?.salesOrderId!==source.salesOrderId)return {available:false,rows:[]};
 const rows=[];
 for(const type of ["SHIPMENT","SHIPMENT_LEG"]){let afterLine="",afterId="0";
  for(;;){
   const [page]=await tx.query("SELECT * FROM inventory_operation_requests FORCE INDEX (idx_inventory_operations_source) WHERE source_module='FULFILLMENT' AND source_document_type=? AND source_document_id=? AND source_event_id=? AND (source_line_id>? OR (source_line_id=? AND id>?)) ORDER BY source_line_id,id LIMIT 100 FOR SHARE",[type,source.shipmentId,source.eventId,afterLine,afterLine,afterId]);
   rows.push(...page);if(rows.length>10001)return {available:false,rows:[]};if(page.length<100)break;afterLine=page.at(-1).source_line_id;afterId=fulfillmentInventoryId(key(page.at(-1).id));
  }
 }
 return {available:true,rows};
}

function selection(source){
 const lines=source.pickedLines;if(!Array.isArray(lines)||!lines.length||lines.length>100)fail();
 const members=[],legs=[],lineIds=new Set(),salesIds=new Set(),claims=new Set(),reservations=new Set(),allocations=new Set();let total=0n;
 for(const line of lines){
  fulfillmentInventoryFields(line,["fulfillmentLineId","salesOrderLineId","skuId","baseQuantity","reservations"]);
  for(const field of ["fulfillmentLineId","salesOrderLineId","skuId"])fulfillmentInventoryId(line[field]);
  if(lineIds.has(line.fulfillmentLineId)||salesIds.has(line.salesOrderLineId)||!Array.isArray(line.reservations)||line.reservations.length>50)fail();lineIds.add(line.fulfillmentLineId);salesIds.add(line.salesOrderLineId);
  let sum=0n,lineLegs=0;for(const member of line.reservations){
   fulfillmentInventoryFields(member,["claimId","inventoryReservationId","baseQuantity","allocations"]);for(const field of ["claimId","inventoryReservationId","baseQuantity"])fulfillmentInventoryId(member[field]);
   if(claims.has(member.claimId)||reservations.has(member.inventoryReservationId)||!Array.isArray(member.allocations)||!member.allocations.length)fail();claims.add(member.claimId);reservations.add(member.inventoryReservationId);let amount=0n;
   for(const leg of member.allocations){fulfillmentInventoryFields(leg,["inventoryAllocationId","inventoryBalanceId","baseQuantity"]);for(const field of Object.keys(leg))fulfillmentInventoryId(leg[field]);if(allocations.has(leg.inventoryAllocationId))fail();allocations.add(leg.inventoryAllocationId);amount+=BigInt(leg.baseQuantity);legs.push({line,member,leg});}
   if(amount!==BigInt(member.baseQuantity))fail();lineLegs+=member.allocations.length;sum+=amount;members.push({line,member});
  }
  if(lineLegs>50||sum!==quantity(line.baseQuantity))fail();total+=sum;
 }
 if(total===0n||members.length>5000||legs.length>5000)fail();return {lines,members,legs};
}

async function readAnchors(tx,source,work){
 const skuIds=unique(work.members.map(entry=>entry.line.skuId)),balanceIds=unique(work.legs.map(entry=>entry.leg.inventoryBalanceId)),reservationIds=unique(work.members.map(entry=>entry.member.inventoryReservationId)),allocationIds=unique(work.legs.map(entry=>entry.leg.inventoryAllocationId));
 const [[warehouse]]=await tx.query("SELECT id FROM inventory_warehouses WHERE id=? FOR SHARE",[source.warehouseId]);if(!warehouse)fail();
 const [controls]=await tx.query(`SELECT * FROM inventory_stock_controls WHERE warehouse_id=? AND sku_id IN (${marks(skuIds)}) ORDER BY warehouse_id,sku_id FOR SHARE`,[source.warehouseId,...skuIds]);if(controls.length!==skuIds.length)fail();
 const [references]=await tx.query(`SELECT * FROM inventory_stock_balances WHERE id IN (${marks(balanceIds)}) ORDER BY id`,balanceIds);if(references.length!==balanceIds.length||references.some(row=>key(row.warehouse_id)!==source.warehouseId))fail();const referenceById=indexed(references);
 const binIds=unique(references.map(row=>key(row.bin_id))),[bins]=await tx.query(`SELECT * FROM inventory_bins WHERE id IN (${marks(binIds)}) ORDER BY id FOR SHARE`,binIds);if(bins.length!==binIds.length||bins.some(row=>key(row.warehouse_id)!==source.warehouseId))fail();
 await readBinLocks(tx,binIds);
 const lotIds=unique(references.filter(row=>row.lot_id!==null).map(row=>key(row.lot_id))),[lots]=lotIds.length?await tx.query(`SELECT * FROM inventory_lots WHERE id IN (${marks(lotIds)}) ORDER BY sku_id,normalized_lot_number FOR SHARE`,lotIds):[[]];if(lots.length!==lotIds.length)fail();
 const [balances]=await tx.query(`SELECT * FROM inventory_stock_balances WHERE id IN (${marks(balanceIds)}) ORDER BY warehouse_id,sku_id,bin_id,lot_scope,stock_status FOR SHARE`,balanceIds),lotById=indexed(lots),balanceById=indexed(balances);
 if(balances.length!==balanceIds.length)fail();for(const row of balances){const before=referenceById.get(key(row.id)),lot=row.lot_id===null?null:lotById.get(key(row.lot_id));if(!before||["warehouse_id","sku_id","bin_id","lot_id","stock_status"].some(field=>key(before[field])!==key(row[field]))||quantity(row.allocated_quantity)>quantity(row.on_hand_quantity)||row.lot_id!==null&&(!lot||key(lot.sku_id)!==key(row.sku_id)))fail();}
 const [reservations]=await tx.query(`SELECT r.*,o.source_module,o.source_document_type,o.source_document_id,o.source_line_id,o.source_event_id FROM inventory_reservations r JOIN inventory_operation_requests o ON o.id=r.create_operation_id WHERE r.id IN (${marks(reservationIds)}) ORDER BY r.id FOR SHARE OF r`,reservationIds);if(reservations.length!==reservationIds.length)fail();
 const [allocations]=await tx.query(`SELECT * FROM inventory_allocations WHERE id IN (${marks(allocationIds)}) ORDER BY id FOR SHARE`,allocationIds);if(allocations.length!==allocationIds.length)fail();
 const [reserved]=await tx.query(`SELECT sku_id,SUM(outstanding_quantity) AS reserved FROM inventory_reservations WHERE warehouse_id=? AND sku_id IN (${marks(skuIds)}) GROUP BY sku_id`,[source.warehouseId,...skuIds]);
 const reservedBySku=indexed(reserved,"sku_id"),controlBySku=indexed(controls,"sku_id"),reservationById=indexed(reservations),allocationById=indexed(allocations);
 for(const control of controls){fulfillmentInventoryVersion(Number(control.version));const total=reservedBySku.get(key(control.sku_id));if(!total||quantity(total.reserved)!==quantity(control.reserved_quantity))fail();}
 const [allocated]=await tx.query(`SELECT reservation_id,SUM(outstanding_quantity) AS allocated FROM inventory_allocations WHERE reservation_id IN (${marks(reservationIds)}) GROUP BY reservation_id`,reservationIds);
 const allocatedByReservation=indexed(allocated,"reservation_id");
 for(const {line,member}of work.members){
  const row=reservationById.get(member.inventoryReservationId),control=controlBySku.get(line.skuId);
  if(!row||!control||key(row.warehouse_id)!==source.warehouseId||key(row.sku_id)!==line.skuId||row.purpose!=="SALE"||row.source_module!=="SALES"||row.source_document_type!=="SALES_ORDER"||row.source_document_id!==source.salesOrderId||row.source_line_id!==line.salesOrderLineId||quantity(row.original_quantity)!==quantity(row.consumed_quantity)+quantity(row.released_quantity)+quantity(row.outstanding_quantity)||quantity(control.reserved_quantity)<quantity(row.outstanding_quantity))fail();
  counterStatus(row,true);fulfillmentInventoryVersion(Number(row.version));const total=allocatedByReservation.get(member.inventoryReservationId);if(!total||quantity(total.allocated)>quantity(row.outstanding_quantity))fail();
 }
 for(const {line,member,leg}of work.legs){
  const row=allocationById.get(leg.inventoryAllocationId),balance=balanceById.get(leg.inventoryBalanceId);
  if(!row||!balance||key(row.reservation_id)!==member.inventoryReservationId||key(row.stock_balance_id)!==leg.inventoryBalanceId||key(balance.sku_id)!==line.skuId||balance.stock_status!=="AVAILABLE"||quantity(row.allocated_quantity)!==quantity(row.consumed_quantity)+quantity(row.released_quantity)+quantity(row.outstanding_quantity))fail();
  counterStatus(row);fulfillmentInventoryVersion(Number(row.version));fulfillmentInventoryVersion(Number(balance.version));
 }
 return {reservationById,allocationById,balanceById};
}

export async function finishFulfillmentIssueOutcome(tx,prepared,source){
 if(!prepared.available)return {state:"UNKNOWN"};
 const work=selection(source),anchors=await readAnchors(tx,source,work);
 const movements=[],operationIds=unique(prepared.rows.map(row=>key(row.id)));
 for(let start=0;start<operationIds.length;start+=100){const ids=operationIds.slice(start,start+100),[rows]=await tx.query(`SELECT id,movement_type FROM inventory_movements FORCE INDEX (idx_inventory_movements_operation) WHERE operation_request_id IN (${marks(ids)}) ORDER BY operation_request_id,id LIMIT 5001 FOR SHARE`,ids);movements.push(...rows);if(movements.length>5000)return {state:"UNKNOWN"};}
 if(prepared.rows.length===0){
  if(movements.length)return {state:"UNKNOWN"};
  const facts=await readFulfillmentAllocationScope(tx,{fulfillmentId:source.fulfillmentId,inventoryAllocationIds:work.legs.map(entry=>entry.leg.inventoryAllocationId)});
  if(facts.fulfillmentId!==source.fulfillmentId||facts.allocations.length!==work.legs.length||facts.reservationFacts.length!==work.members.length||new Set(facts.allocations.map(row=>row.inventoryAllocationId)).size!==work.legs.length)fail();
  const allocationFacts=indexed(facts.allocations,"inventoryAllocationId");for(const {line,member,leg}of work.legs){const row=allocationFacts.get(leg.inventoryAllocationId);if(!row||row.claimId!==member.claimId||row.fulfillmentLineId!==line.fulfillmentLineId||row.salesOrderLineId!==line.salesOrderLineId||row.skuId!==line.skuId||row.warehouseId!==source.warehouseId||row.inventoryReservationId!==member.inventoryReservationId||row.inventoryBalanceId!==leg.inventoryBalanceId||row.status!=="ACTIVE"||row.consumedQuantity!=="0"||row.outstandingQuantity!==leg.baseQuantity)fail();}
  return {state:"ABSENT",facts};
 }
 const rows=prepared.rows,roots=rows.filter(row=>row.source_document_type==="SHIPMENT"&&row.source_line_id===""&&row.command_type==="FULFILLMENT_BATCH_ISSUE");
 if(roots.length!==1||rows.some(row=>row.completed_at===null||key(row.actor_user_id)!==source.actorId||row.correlation_id!==source.correlationId))return {state:"UNKNOWN"};
 const root=roots[0];if(source.inventoryRequestHash!==null&&root.request_hash!==source.inventoryRequestHash)return {state:"UNKNOWN"};
 const decoded=await readFulfillmentInventoryBatch(tx,{action:"ISSUE",operationId:key(root.id),documentId:source.shipmentId,eventId:source.eventId,requestHash:root.request_hash,locking:false}),memberIds=new Set(),movementIds=new Set();
 if(decoded.fulfillmentId!==source.fulfillmentId||decoded.result.lines.length!==work.lines.length)fail();
 for(const line of work.lines){
  const result=decoded.result.lines.find(item=>item.fulfillmentLineId===line.fulfillmentLineId&&item.salesOrderLineId===line.salesOrderLineId);if(!result||result.baseQuantity!==line.baseQuantity||result.reservations.length!==line.reservations.length)fail();
  for(const member of line.reservations){
   const actual=result.reservations.find(item=>item.claimId===member.claimId&&item.inventoryReservationId===member.inventoryReservationId),current=anchors.reservationById.get(member.inventoryReservationId);if(!actual||actual.baseQuantity!==member.baseQuantity||actual.allocations.length!==member.allocations.length||Number(current.version)<actual.version||quantity(current.consumed_quantity)<BigInt(member.baseQuantity))fail();memberIds.add(actual.inventoryOperationId);
   for(const leg of member.allocations){const effect=actual.allocations.find(item=>item.inventoryAllocationId===leg.inventoryAllocationId&&item.inventoryBalanceId===leg.inventoryBalanceId),allocation=anchors.allocationById.get(leg.inventoryAllocationId);if(!effect||effect.baseQuantity!==leg.baseQuantity||allocation.status!=="CONSUMED"||quantity(allocation.outstanding_quantity)!==0n||quantity(allocation.consumed_quantity)!==BigInt(leg.baseQuantity)||Number(allocation.version)<effect.allocationVersion)fail();movementIds.add(effect.movementId);}
  }
 }
 const members=rows.filter(row=>row.source_document_type==="SHIPMENT"&&row.source_line_id!==""),legs=rows.filter(row=>row.source_document_type==="SHIPMENT_LEG");
 if(rows.length!==1+work.members.length+work.legs.length||members.length!==memberIds.size||members.some(row=>row.command_type!=="ISSUE_POST"||!memberIds.has(key(row.id)))||legs.length!==movementIds.size||legs.some(row=>row.command_type!=="FULFILLMENT_BATCH_LEG"||!movementIds.has(key(parse(row.result_summary)?.movementId))))fail();
 if(movements.length!==movementIds.size||movements.some(row=>!movementIds.has(key(row.id))))fail();
 return {state:"SUCCEEDED",result:decoded.result,requestHash:root.request_hash};
}


// REVERSE uses the same prepare-only scope/event locks; its domain reads stay in finish.
// No ABSENT is issued until the caller's all-attempt fence and every writer barrier are proven.
export async function finishFulfillmentReversalOutcome(tx,prepared,source){
 if(!prepared.available)return {state:"UNKNOWN",reason:"SCOPE_OR_EVENT_PROOF_UNAVAILABLE"};
 if(prepared.rows.length===0)return {state:"UNKNOWN",reason:"REVERSAL_ABSENCE_BARRIER_UNPROVEN"};
 const work=selection(source),anchors=await readAnchors(tx,source,work),rows=prepared.rows;
 const roots=rows.filter(row=>row.source_document_type==="SHIPMENT"&&row.source_line_id===""&&row.command_type==="FULFILLMENT_BATCH_REVERSE");
 if(roots.length!==1||rows.some(row=>row.completed_at===null||key(row.actor_user_id)!==source.actorId||row.correlation_id!==source.correlationId))return {state:"UNKNOWN"};
 const root=roots[0];if(root.request_hash!==source.inventoryRequestHash)return {state:"UNKNOWN"};
 const decoded=await readFulfillmentInventoryBatch(tx,{action:"REVERSE",operationId:key(root.id),documentId:source.shipmentId,eventId:source.eventId,requestHash:root.request_hash,locking:false});
 const references=source.originalIssue.references,referenceByAllocation=indexed(references,"inventoryAllocationId");
 if(references.length!==work.legs.length)fail();
 const original=await readOriginalFulfillmentIssueBatch(tx,{shipmentId:source.shipmentId,
  members:unique(references.map(reference=>reference.originalInventoryOperationId)).map(originalInventoryOperationId=>({originalInventoryOperationId}))});
 if(original.root.source_event_id!==source.originalIssue.eventId||original.fulfillmentId!==source.fulfillmentId||original.result.lines.length!==work.lines.length||decoded.fulfillmentId!==source.fulfillmentId||decoded.result.lines.length!==work.lines.length)fail();
 const memberIds=new Set(),movementIds=new Set(),originalMovementIds=new Set();
 for(const line of work.lines){
  const result=decoded.result.lines.find(item=>item.fulfillmentLineId===line.fulfillmentLineId&&item.salesOrderLineId===line.salesOrderLineId);
  const old=original.result.lines.find(item=>item.fulfillmentLineId===line.fulfillmentLineId&&item.salesOrderLineId===line.salesOrderLineId);
  if(!result||!old||result.baseQuantity!==line.baseQuantity||old.baseQuantity!==line.baseQuantity||result.reservations.length!==line.reservations.length||old.reservations.length!==line.reservations.length)fail();
  for(const member of line.reservations){
   const actual=result.reservations.find(item=>item.claimId===member.claimId&&item.inventoryReservationId===member.inventoryReservationId);
   const previous=old.reservations.find(item=>item.claimId===member.claimId&&item.inventoryReservationId===member.inventoryReservationId);
   const current=anchors.reservationById.get(member.inventoryReservationId);
   if(!actual||!previous||actual.originalInventoryOperationId!==previous.inventoryOperationId||actual.baseQuantity!==member.baseQuantity||actual.allocations.length!==member.allocations.length||Number(current.version)<actual.version)fail();
   memberIds.add(actual.inventoryOperationId);
   for(const leg of member.allocations){
    const effect=actual.allocations.find(item=>item.inventoryAllocationId===leg.inventoryAllocationId&&item.inventoryBalanceId===leg.inventoryBalanceId);
    const prior=previous.allocations.find(item=>item.inventoryAllocationId===leg.inventoryAllocationId&&item.inventoryBalanceId===leg.inventoryBalanceId);
    const allocation=anchors.allocationById.get(leg.inventoryAllocationId),reference=referenceByAllocation.get(leg.inventoryAllocationId);
    if(!effect||!prior||!reference||reference.originalInventoryOperationId!==previous.inventoryOperationId||reference.originalMovementId!==prior.movementId||effect.shipmentIssueId!==reference.shipmentIssueId||effect.originalMovementId!==reference.originalMovementId||effect.baseQuantity!==leg.baseQuantity||effect.originalMovementId!==prior.movementId||allocation.status!=="CONSUMED"||quantity(allocation.outstanding_quantity)!==0n||quantity(allocation.consumed_quantity)!==BigInt(leg.baseQuantity)||Number(allocation.version)<effect.allocationVersion)fail();
    movementIds.add(effect.movementId);originalMovementIds.add(prior.movementId);
   }
  }
 }
 const members=rows.filter(row=>row.source_document_type==="SHIPMENT"&&row.source_line_id!==""),legs=rows.filter(row=>row.source_document_type==="SHIPMENT_LEG");
 if(rows.length!==1+work.members.length+work.legs.length||members.length!==memberIds.size||members.some(row=>row.command_type!=="FULFILLMENT_REVERSE_ISSUE"||!memberIds.has(key(row.id)))||legs.length!==movementIds.size||legs.some(row=>row.command_type!=="FULFILLMENT_BATCH_LEG"||!movementIds.has(key(parse(row.result_summary)?.movementId))))fail();
 const effectRows=[],ids=unique(rows.map(row=>key(row.id)));
 for(let start=0;start<ids.length;start+=100){
  const page=ids.slice(start,start+100),[effects]=await tx.query(`SELECT id FROM inventory_movements FORCE INDEX (idx_inventory_movements_operation) WHERE operation_request_id IN (${marks(page)}) ORDER BY operation_request_id,id LIMIT 5001 FOR SHARE`,page);
  effectRows.push(...effects);if(effectRows.length>5000)fail();
 }
 if(effectRows.length!==movementIds.size||effectRows.some(row=>!movementIds.has(key(row.id))))fail();
 const reverseRows=[],originalIds=unique([...originalMovementIds]);
 for(let start=0;start<originalIds.length;start+=100){
  const page=originalIds.slice(start,start+100),[effects]=await tx.query(`SELECT id,reversal_of_movement_id FROM inventory_movements FORCE INDEX (uq_inventory_movement_reversal) WHERE reversal_of_movement_id IN (${marks(page)}) ORDER BY reversal_of_movement_id FOR SHARE`,page);
  reverseRows.push(...effects);
 }
 if(reverseRows.length!==movementIds.size||reverseRows.some(row=>!movementIds.has(key(row.id))||!originalMovementIds.has(key(row.reversal_of_movement_id))))fail();
 return {state:"SUCCEEDED",result:decoded.result,requestHash:root.request_hash};
}

export async function finishFulfillmentReversalZeroEffect(tx,prepared,source){
 if(!prepared.available||prepared.rows.length)return {state:"UNKNOWN"};
 const work=selection(source),anchors=await readAnchors(tx,source,work);
 const references=source.originalIssue.references,byAllocation=indexed(references,"inventoryAllocationId");
 if(references.length!==work.legs.length)fail();
 const original=await readOriginalFulfillmentIssueBatch(tx,{shipmentId:source.shipmentId,
  members:unique(references.map(row=>row.originalInventoryOperationId)).map(originalInventoryOperationId=>({originalInventoryOperationId}))});
 if(original.fulfillmentId!==source.fulfillmentId||original.root.source_event_id!==source.originalIssue.eventId||original.result.lines.length!==work.lines.length)fail();
 for(const line of work.lines){
  const old=original.result.lines.find(row=>row.fulfillmentLineId===line.fulfillmentLineId&&row.salesOrderLineId===line.salesOrderLineId);
  if(!old||old.baseQuantity!==line.baseQuantity||old.reservations.length!==line.reservations.length)fail();
  for(const member of line.reservations){
   const prior=old.reservations.find(row=>row.claimId===member.claimId&&row.inventoryReservationId===member.inventoryReservationId);
   const reservation=anchors.reservationById.get(member.inventoryReservationId);
   if(!prior||prior.baseQuantity!==member.baseQuantity||prior.allocations.length!==member.allocations.length||
       Number(reservation.version)<prior.version||quantity(reservation.consumed_quantity)<BigInt(member.baseQuantity))fail();
   for(const leg of member.allocations){
    const effect=prior.allocations.find(row=>row.inventoryAllocationId===leg.inventoryAllocationId&&row.inventoryBalanceId===leg.inventoryBalanceId);
    const reference=byAllocation.get(leg.inventoryAllocationId),allocation=anchors.allocationById.get(leg.inventoryAllocationId),balance=anchors.balanceById.get(leg.inventoryBalanceId);
    if(!effect||effect.baseQuantity!==leg.baseQuantity||!reference||reference.originalInventoryOperationId!==prior.inventoryOperationId||
        reference.originalMovementId!==effect.movementId||effect.bucketSnapshot.warehouseId!==source.warehouseId||
        allocation.status!=="CONSUMED"||quantity(allocation.outstanding_quantity)!==0n||quantity(allocation.consumed_quantity)!==BigInt(leg.baseQuantity)||
        Number(allocation.version)!==effect.allocationVersion)fail();
    const bucket=effect.bucketSnapshot;
    if(key(balance.warehouse_id)!==bucket.warehouseId||key(balance.sku_id)!==bucket.skuId||key(balance.bin_id)!==bucket.binId||
        (balance.lot_id===null?null:key(balance.lot_id))!==bucket.lotId||balance.stock_status!==bucket.stockStatus)fail();
   }
  }
 }
 // Domain locks remain held. Inspect every original pointer, regardless of reverse event/target.
 const originals=unique(references.map(row=>row.originalMovementId));
 for(let start=0;start<originals.length;start+=100){
  const ids=originals.slice(start,start+100),[rows]=await tx.query(`SELECT id,reversal_of_movement_id FROM inventory_movements FORCE INDEX (uq_inventory_movement_reversal) WHERE reversal_of_movement_id IN (${marks(ids)}) ORDER BY reversal_of_movement_id FOR SHARE`,ids);
  if(rows.length)return {state:"UNKNOWN"};
 }
 const balances=unique(work.legs.map(entry=>entry.leg.inventoryBalanceId));
 for(let start=0;start<balances.length;start+=100){
  const ids=balances.slice(start,start+100),[rows]=await tx.query(`SELECT b.id,b.allocated_quantity,COALESCE(SUM(a.outstanding_quantity),0) AS outstanding FROM inventory_stock_balances b LEFT JOIN inventory_allocations a ON a.stock_balance_id=b.id WHERE b.id IN (${marks(ids)}) GROUP BY b.id,b.allocated_quantity ORDER BY b.id`,ids);
  if(rows.length!==ids.length||rows.some(row=>quantity(row.allocated_quantity)!==quantity(row.outstanding)))fail();
 }
 // Re-read the full event class, not just this shipment/root; all participants share the early gate.
 if((await readFulfillmentShipmentEventAdmission(tx,source.eventId)).state!=="CLEAR")return {state:"UNKNOWN"};
 return {state:"ABSENT"};
}
