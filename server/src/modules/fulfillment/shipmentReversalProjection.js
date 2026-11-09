import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { assertClaimQuantities } from "./fulfillmentQuantityMath.js";

const fail=()=>{throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");},key=value=>String(value);
const quantity=value=>fulfillmentInteger(key(value),{positive:false});
function version(value){if(!Number.isSafeInteger(value)||value<1||value>4294967295)fail();return value;}
function fields(value,names){const allowed=names.split(",");if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.getOwnPropertySymbols(value).length||Object.keys(value).length!==allowed.length||Object.keys(value).some(name=>!allowed.includes(name)))fail();}

export function assertShipmentReversalSource(snapshot,payload,intent,order,salesScope){
 const {root,shipment,lines,shipmentLines,claims,allocations,issues}=snapshot;
 if(payload.fulfillmentId!==key(root.id)||payload.shipmentId!==key(shipment.id)||intent.shipmentId!==key(shipment.id)||intent.salesOrderId!==key(root.sales_order_id)||
    intent.originalConfirmationEventId!==shipment.confirmation_event_id||order.orderId!==intent.salesOrderId||order.customer.id!==key(root.customer_id)||order.warehouse.id!==key(root.warehouse_id)||
    order.version!==intent.expectedOrderVersion||payload.lines.length!==lines.length||intent.lines.length!==lines.length||order.lines.length!==lines.length)fail();
 const usedClaims=new Set(),usedIssues=new Set();
 for(const claim of claims)assertClaimQuantities({original:key(claim.original_claimed_quantity),active:key(claim.active_claimed_quantity),released:key(claim.released_quantity),consumed:key(claim.consumed_quantity),reversed:key(claim.reversed_quantity)});
 for(const selected of payload.lines){
  const line=lines.find(row=>key(row.id)===selected.fulfillmentLineId),child=shipmentLines.find(row=>key(row.fulfillment_line_id)===selected.fulfillmentLineId),sales=intent.lines.find(row=>row.salesOrderLineId===selected.salesOrderLineId),locked=order.lines.find(row=>row.lineId===selected.salesOrderLineId);
  if(!line||!child||!sales||!locked||key(line.sales_order_line_id)!==selected.salesOrderLineId||key(line.shipped_base_quantity)!==selected.baseQuantity||key(child.shipped_base_quantity)!==selected.baseQuantity||sales.baseQuantity!==selected.baseQuantity||locked.version!==sales.expectedVersion||locked.skuId!==key(line.sku_id)||locked.baseUomId!==key(line.base_uom_id)||selected.reservations.length!==sales.reservations.length)fail();
  for(const member of selected.reservations){
   const claim=claims.find(row=>key(row.id)===member.claimId),saved=salesScope.lines.find(row=>row.salesOrderLineId===selected.salesOrderLineId)?.reservations.find(row=>row.claimId===member.claimId),mapping=locked.reservationMappings.find(row=>row.inventoryReservationId===member.inventoryReservationId),salesMember=sales.reservations.find(row=>row.claimId===member.claimId);
   if(!claim||!saved||!mapping||!salesMember||usedClaims.has(member.claimId)||key(claim.fulfillment_line_id)!==selected.fulfillmentLineId||key(claim.inventory_reservation_id)!==member.inventoryReservationId||claim.status!=="CONSUMED"||quantity(claim.active_claimed_quantity)!==0n||quantity(claim.reversed_quantity)!==0n||key(claim.consumed_quantity)!==member.baseQuantity||
      key(claim.sales_order_line_reservation_id)!==saved.salesReservationMappingId||mapping.salesReservationMappingId!==saved.salesReservationMappingId||mapping.inventoryVersion>member.expectedVersion||Number(claim.inventory_version)>member.expectedVersion||
      salesMember.inventoryReservationId!==member.inventoryReservationId||salesMember.expectedVersion!==member.expectedVersion||salesMember.baseQuantity!==member.baseQuantity||salesMember.originalInventoryOperationId!==member.originalInventoryOperationId)fail();
   usedClaims.add(member.claimId);
   for(const leg of member.allocations){
    const issue=issues.find(row=>key(row.id)===leg.shipmentIssueId),allocation=allocations.find(row=>key(row.inventory_allocation_id)===leg.inventoryAllocationId);
    if(!issue||!allocation||usedIssues.has(leg.shipmentIssueId)||key(issue.inventory_operation_id)!==member.originalInventoryOperationId||key(issue.inventory_movement_id)!==leg.originalMovementId||key(issue.inventory_allocation_id)!==leg.inventoryAllocationId||key(allocation.claim_id)!==member.claimId||key(allocation.id)!==key(issue.fulfillment_allocation_id)||allocation.status!=="CONSUMED"||key(issue.issued_base_quantity)!==leg.baseQuantity||issue.reversal_movement_id!==null)fail();
    usedIssues.add(leg.shipmentIssueId);
   }
  }
 }
 if(usedClaims.size!==claims.filter(row=>quantity(row.consumed_quantity)>0n).length||usedIssues.size!==issues.length||usedIssues.size!==allocations.length)fail();
}

export function shipmentReversalProjection(result,payload,proof,snapshot,inventoryScope){
 fields(result,"operationId,lines");if(result.operationId!==proof.operationId||!Array.isArray(result.lines)||result.lines.length!==payload.lines.length)fail();
 const members=new Map(),legs=new Map(),movements=new Set(),operations=new Set([result.operationId]),balances=new Map(),details=[];
 for(const [i,line]of payload.lines.entries()){
  const actual=result.lines[i];fields(actual,"fulfillmentLineId,salesOrderLineId,baseQuantity,reservations");
  if(actual.fulfillmentLineId!==line.fulfillmentLineId||actual.salesOrderLineId!==line.salesOrderLineId||actual.baseQuantity!==line.baseQuantity||!Array.isArray(actual.reservations)||actual.reservations.length!==line.reservations.length)fail();
  for(const [j,member]of line.reservations.entries()){
   const current=actual.reservations[j],before=inventoryScope.lines.find(row=>row.fulfillmentLineId===line.fulfillmentLineId)?.reservations.find(row=>row.claimId===member.claimId)?.currentState;
   fields(current,"claimId,inventoryReservationId,expectedVersion,version,baseQuantity,inventoryOperationId,originalInventoryOperationId,allocations");
   if(!before||before.version!==member.expectedVersion||current.claimId!==member.claimId||current.inventoryReservationId!==member.inventoryReservationId||current.expectedVersion!==member.expectedVersion||version(current.version)!==member.expectedVersion+1||current.baseQuantity!==member.baseQuantity||current.originalInventoryOperationId!==member.originalInventoryOperationId||members.has(member.claimId)||operations.has(current.inventoryOperationId)||!Array.isArray(current.allocations)||current.allocations.length!==member.allocations.length)fail();
   fulfillmentInteger(current.inventoryOperationId);operations.add(current.inventoryOperationId);members.set(member.claimId,current);
   const consumed=quantity(before.consumedQuantity)-quantity(member.baseQuantity),outstanding=quantity(before.outstandingQuantity)+quantity(member.baseQuantity);
   if(consumed<0n||quantity(before.originalQuantity)!==consumed+quantity(before.releasedQuantity)+outstanding)fail();
   const after={...before,consumedQuantity:consumed.toString(),outstandingQuantity:outstanding.toString(),status:consumed>0n?"PARTIALLY_CONSUMED":"ACTIVE",version:current.version};
   for(const [k,leg]of member.allocations.entries()){
    const output=current.allocations[k],issue=snapshot.issues.find(row=>key(row.id)===leg.shipmentIssueId),allocation=snapshot.allocations.find(row=>key(row.inventory_allocation_id)===leg.inventoryAllocationId),child=snapshot.shipmentLines.find(row=>key(row.fulfillment_line_id)===line.fulfillmentLineId);
    fields(output,"inventoryAllocationId,inventoryBalanceId,baseQuantity,allocationVersion,balanceVersion,movementId,bucketSnapshot,shipmentIssueId,originalMovementId");
    const bucket=output.bucketSnapshot;fields(bucket,"warehouseId,warehouseCode,binId,binCode,lotId,lotNumber,expiryDate,stockStatus,skuId,skuCode,skuName,baseUomId,baseUomCode,postedAt");
    if(!issue||!allocation||legs.has(leg.inventoryAllocationId)||output.inventoryAllocationId!==leg.inventoryAllocationId||output.shipmentIssueId!==leg.shipmentIssueId||output.originalMovementId!==leg.originalMovementId||output.inventoryBalanceId!==key(issue.inventory_balance_id)||output.baseQuantity!==leg.baseQuantity||version(output.allocationVersion)!==Number(allocation.inventory_version)||
       bucket.warehouseId!==key(issue.warehouse_id)||bucket.binId!==key(issue.bin_id)||bucket.lotId!==(issue.lot_id===null?null:key(issue.lot_id))||bucket.stockStatus!==issue.stock_status_snapshot||bucket.warehouseCode!==issue.warehouse_code_snapshot||bucket.binCode!==issue.bin_code_snapshot||(bucket.lotNumber??"")!==issue.lot_number_snapshot||bucket.expiryDate!==issue.expiry_date_snapshot||bucket.skuId!==key(child.sku_id)||bucket.skuCode!==issue.sku_code_snapshot||bucket.skuName!==child.sku_name_snapshot||bucket.baseUomId!==key(child.base_uom_id)||bucket.baseUomCode!==issue.base_uom_code_snapshot)fail();
    fulfillmentInteger(output.movementId);if(movements.has(output.movementId)||output.movementId===leg.originalMovementId)fail();movements.add(output.movementId);legs.set(leg.inventoryAllocationId,output);
    const prior=balances.get(output.inventoryBalanceId);if(prior!==undefined&&prior!==leg.expectedBalanceVersion)fail();balances.set(output.inventoryBalanceId,leg.expectedBalanceVersion);
    details.push({reversal_id:key(snapshot.reversal.id),shipment_id:key(snapshot.shipment.id),shipment_issue_detail_id:leg.shipmentIssueId,inventory_reversal_operation_id:current.inventoryOperationId,inventory_reversal_movement_id:output.movementId,inventory_reservation_id:member.inventoryReservationId,warehouse_id:bucket.warehouseId,bin_id:bucket.binId,lot_id:bucket.lotId,stock_status_snapshot:bucket.stockStatus,reversed_base_quantity:leg.baseQuantity,reservation_before_summary:JSON.stringify(before),reservation_after_summary:JSON.stringify(after)});
   }
  }
 }
 const ordered=payload.lines.flatMap(line=>line.reservations.map(member=>({line,member}))).sort((a,b)=>Number(a.line.fulfillmentLineId)-Number(b.line.fulfillmentLineId)||Number(a.member.inventoryReservationId)-Number(b.member.inventoryReservationId));
 for(const {member}of ordered)for(const leg of member.allocations){const output=legs.get(leg.inventoryAllocationId),next=version(balances.get(output.inventoryBalanceId)+1);if(output.balanceVersion!==next)fail();balances.set(output.inventoryBalanceId,next);}
 if(details.length!==snapshot.issues.length||!details.length)fail();return {members,details};
}

export function assertReversedSalesProjection(result,intent,before){
 fields(result,"orderId,status,version,lines");if(result.orderId!==intent.salesOrderId||version(result.version)!==intent.expectedOrderVersion+1||!["CONFIRMED","PARTIALLY_FULFILLED"].includes(result.status)||!Array.isArray(result.lines)||result.lines.length!==intent.lines.length)fail();
 for(const [i,line]of intent.lines.entries()){
  const actual=result.lines[i],source=before.lines.find(row=>row.lineId===line.salesOrderLineId),q=quantity(line.baseQuantity);
  fields(actual,"salesOrderLineId,version,orderedBaseQuantity,reservedOutstandingBaseQuantity,backorderedBaseQuantity,fulfilledBaseQuantity,cancelledBaseQuantity");
  if(!source||actual.salesOrderLineId!==line.salesOrderLineId||actual.version!==line.expectedVersion+(q>0n?1:0)||actual.reservedOutstandingBaseQuantity!==(quantity(source.reservedOutstandingBaseQuantity)+q).toString()||actual.fulfilledBaseQuantity!==(quantity(source.fulfilledBaseQuantity)-q).toString()||["orderedBaseQuantity","backorderedBaseQuantity","cancelledBaseQuantity"].some(field=>actual[field]!==source[field]))fail();
 }
}

export async function saveShipmentReversalProjection(tx,snapshot,projection,request,actor,at){
 const {root,shipment,reversal}=snapshot;
 for(let start=0;start<projection.details.length;start+=100){
  const rows=projection.details.slice(start,start+100).map(row=>({...row,created_at:at})),columns=Object.keys(rows[0]);
  await tx.execute(`INSERT INTO shipment_reversal_details (${columns.join(",")}) VALUES ${rows.map(()=>`(${columns.map(()=>"?").join(",")})`).join(",")}`,rows.flatMap(row=>columns.map(column=>row[column])));
  const [changed]=await tx.execute(`UPDATE shipment_issue_details SET reversal_movement_id=CASE id ${rows.map(()=>"WHEN ? THEN ?").join(" ")} END WHERE id IN (${rows.map(()=>"?").join(",")}) AND shipment_id=? AND reversal_movement_id IS NULL AND (${rows.map(()=>"(id=? AND inventory_movement_id=?)").join(" OR ")})`,[...rows.flatMap(row=>[row.shipment_issue_detail_id,row.inventory_reversal_movement_id]),...rows.map(row=>row.shipment_issue_detail_id),shipment.id,...rows.flatMap(row=>[row.shipment_issue_detail_id,snapshot.issues.find(issue=>key(issue.id)===row.shipment_issue_detail_id).inventory_movement_id])]);if(changed.affectedRows!==rows.length)fail();
 }
 const claims=snapshot.claims.filter(row=>projection.members.has(key(row.id)));
 for(let start=0;start<claims.length;start+=100){const rows=claims.slice(start,start+100),[changed]=await tx.execute(`UPDATE fulfillment_line_reservation_claims SET reversed_quantity=consumed_quantity,status='REVERSED',inventory_version=CASE id ${rows.map(()=>"WHEN ? THEN ?").join(" ")} END,updated_at=? WHERE id IN (${rows.map(()=>"?").join(",")}) AND fulfillment_id=? AND (${rows.map(()=>"(id=? AND status='CONSUMED' AND active_claimed_quantity=0 AND reversed_quantity=0 AND consumed_quantity=? AND inventory_version=?)").join(" OR ")})`,[...rows.flatMap(row=>[row.id,projection.members.get(key(row.id)).version]),at,...rows.map(row=>row.id),root.id,...rows.flatMap(row=>[row.id,key(row.consumed_quantity),Number(row.inventory_version)])]);if(changed.affectedRows!==rows.length)fail();}
 for(const line of snapshot.lines){
  if(quantity(line.shipped_base_quantity)===0n)continue;
  const child=snapshot.shipmentLines.find(row=>key(row.fulfillment_line_id)===key(line.id));version(Number(line.version)+1);
  const [updated]=await tx.execute("UPDATE fulfillment_lines SET reversed_base_quantity=shipped_base_quantity,version=version+1,updated_at=? WHERE id=? AND fulfillment_id=? AND version=? AND shipped_base_quantity=? AND reversed_base_quantity=0",[at,line.id,root.id,line.version,key(line.shipped_base_quantity)]);if(updated.affectedRows!==1)fail();
  const [changed]=await tx.execute("UPDATE shipment_lines SET reversed_base_quantity=shipped_base_quantity,updated_at=? WHERE id=? AND shipment_id=? AND shipped_base_quantity=? AND reversed_base_quantity=0",[at,child.id,shipment.id,key(line.shipped_base_quantity)]);if(changed.affectedRows!==1)fail();
 }
 const shipmentVersion=version(Number(shipment.version)+1),rootVersion=version(Number(root.version)+1);version(Number(reversal.version)+1);
 const [shipmentChanged]=await tx.execute("UPDATE shipments SET status='REVERSED',reversed_at=?,reversed_by=?,version=version+1,updated_at=?,last_business_updated_at=?,updated_by=? WHERE id=? AND status='REVERSING' AND version=? AND reversal_event_id=? AND correlation_id=?",[at,actor.id,at,at,actor.id,shipment.id,shipment.version,request.eventId,request.correlationId]);if(shipmentChanged.affectedRows!==1)fail();
 const [rootChanged]=await tx.execute("UPDATE fulfillments SET status='REVERSED',reversed_at=?,reversed_by=?,version=version+1,updated_at=?,last_business_updated_at=?,updated_by=? WHERE id=? AND status='SHIPPED' AND version=? AND active_shipment_id=?",[at,actor.id,at,at,actor.id,root.id,root.version,shipment.id]);if(rootChanged.affectedRows!==1)fail();
 const after={fulfillmentId:key(root.id),shipmentId:key(shipment.id),reversalId:key(reversal.id),status:"REVERSED",version:shipmentVersion,rowCount:projection.details.length};
 const [reversalChanged]=await tx.execute("UPDATE shipment_reversals SET status='REVERSED',version=version+1,after_summary=?,completed_at=?,completed_by=? WHERE id=? AND shipment_id=? AND status='REVERSING' AND version=? AND event_id=? AND correlation_id=?",[JSON.stringify(after),at,actor.id,reversal.id,shipment.id,reversal.version,request.eventId,request.correlationId]);if(reversalChanged.affectedRows!==1)fail();
 for(const [table,parent,id,from,version]of [["fulfillment_status_history","fulfillment_id",root.id,"SHIPPED",rootVersion],["shipment_status_history","shipment_id",shipment.id,"REVERSING",shipmentVersion]]){
  const [[sequence]]=await tx.query(`SELECT COALESCE(MAX(sequence_no),0)+1 AS next FROM ${table} WHERE ${parent}=?`,[id]);if(Number(sequence.next)>4294967295)fail();
  await tx.execute(`INSERT INTO ${table} (${parent},sequence_no,from_status,to_status,action,reason,event_id,version_after,actor_user_id,actor_label,occurred_at) VALUES (?,?,?,'REVERSED','REVERSE',?,?,?,?,?,?)`,[id,sequence.next,from,request.payload.reason,request.eventId,version,actor.id,actor.username,at]);
 }
 for(const [type,id,version]of [["FULFILLMENT",root.id,rootVersion],["SHIPMENT",shipment.id,shipmentVersion],["REVERSAL",reversal.id,Number(reversal.version)+1]])await tx.execute("INSERT INTO fulfillment_audit_logs (target_type,target_id,action,event_id,correlation_id,actor_user_id,actor_label,after_summary,occurred_at) VALUES (?,?,'REVERSE',?,?,?,?,?,?)",[type,id,request.eventId,request.correlationId,actor.id,actor.username,JSON.stringify({...after,version}),at]);
 return {id:key(shipment.id),number:shipment.shipment_number,status:"REVERSED",version:shipmentVersion};
}
