import { normalizeFulfillmentInventoryBatch } from "../inventory/inventoryFulfillmentValidation.js";
import { freezeShipmentIntent } from "./shipmentConfirmationScope.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";

const fail=()=>{throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");};
const quantity=value=>fulfillmentInteger(String(value),{positive:false});
const key=value=>{const result=String(value);fulfillmentInteger(result);return result;};
const version=value=>{if(!Number.isSafeInteger(value)||value<1||value>4294967295)fail();return value;};
const compare=(a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0;
function index(rows,column,max=5000){
 if(!Array.isArray(rows)||rows.length>max)fail();
 const result=new Map();for(const row of rows){const id=key(row?.[column]);if(result.has(id))fail();result.set(id,row);}return result;
}
function sameQuantity(...values){if(values.some(value=>quantity(value)!==quantity(values[0])))fail();}
function bucketMatches(issue,allocation,bucket,line,root){
 if(!bucket||bucket.warehouseId!==key(root.warehouse_id)||bucket.skuId!==key(line.sku_id)||bucket.baseUomId!==key(line.base_uom_id)||bucket.stockStatus!=="AVAILABLE")fail();
 for(const [field,property]of [["warehouse_id","warehouseId"],["bin_id","binId"]])if(key(issue[field])!==bucket[property]||key(allocation[field])!==bucket[property])fail();
 for(const row of [issue,allocation])if((row.lot_id===null?null:key(row.lot_id))!==bucket.lotId||row.stock_status_snapshot!==bucket.stockStatus)fail();
 for(const [field,property]of [["warehouse_code_snapshot","warehouseCode"],["bin_code_snapshot","binCode"],["sku_code_snapshot","skuCode"],["base_uom_code_snapshot","baseUomCode"],["expiry_date_snapshot","expiryDate"]])if(issue[field]!==bucket[property])fail();
 if(issue.lot_number_snapshot!==(bucket.lotNumber??""))fail();
}

// Complete local source rows and owner advisories are data, never a lease, receipt or locked-write capability.
export function mapShipmentReversalSources(snapshot,salesScope,inventoryScope){
 const {root,shipment,lines,shipmentLines,claims,allocations,issues}=snapshot;
 if(salesScope.salesOrderId!==key(root.sales_order_id)||salesScope.shipmentId!==key(shipment.id)||salesScope.originalConfirmationEventId!==shipment.confirmation_event_id||
    salesScope.customerId!==key(root.customer_id)||salesScope.warehouseId!==key(root.warehouse_id)||inventoryScope.fulfillmentId!==key(root.id)||inventoryScope.shipmentId!==key(shipment.id)||
    key(shipment.fulfillment_id)!==key(root.id)||key(root.active_shipment_id)!==key(shipment.id)||["sales_order_id","customer_id","warehouse_id"].some(field=>key(shipment[field])!==key(root[field])))fail();
 key(inventoryScope.originalOperationId);
 const localLines=index(lines,"sales_order_line_id",100),children=index(shipmentLines,"fulfillment_line_id",100),salesLines=index(salesScope.lines,"salesOrderLineId",100),ownerLines=index(inventoryScope.lines,"fulfillmentLineId",100);
 if(!localLines.size||localLines.size!==Number(root.line_count)||localLines.size!==Number(shipment.line_count)||localLines.size!==children.size||localLines.size!==salesLines.size||localLines.size!==ownerLines.size)fail();
 index(lines,"id",100);index(shipmentLines,"id",100);
 if(!Array.isArray(claims)||!Array.isArray(allocations))fail();
 index(claims,"id");
 const originalClaims=index(claims.filter(row=>quantity(row.consumed_quantity)>0n),"id"),originalAllocations=index(allocations.filter(row=>quantity(row.picked_base_quantity)>0n),"inventory_allocation_id");
 const originalIssues=index(issues,"inventory_allocation_id");index(issues,"id");index(issues,"inventory_movement_id");
 if(!originalIssues.size||originalIssues.size!==originalAllocations.size)fail();
 const usedClaims=new Set(),usedAllocations=new Set(),usedReservations=new Set(),originalOperations=new Set(),balanceVersions=new Map();
 const mapped=[...salesLines].sort(([a],[b])=>compare(a,b)).map(([salesOrderLineId,salesLine])=>{
  const line=localLines.get(salesOrderLineId),owner=line&&ownerLines.get(key(line.id)),child=line&&children.get(key(line.id));
  if(!line||!owner||!child||key(line.fulfillment_id)!==key(root.id)||key(line.sales_order_id)!==key(root.sales_order_id)||owner.salesOrderLineId!==salesOrderLineId||
     key(child.shipment_id)!==key(shipment.id)||key(child.fulfillment_id)!==key(root.id)||key(child.sales_order_line_id)!==salesOrderLineId||key(child.sku_id)!==key(line.sku_id)||key(child.base_uom_id)!==key(line.base_uom_id)||
     quantity(line.reversed_base_quantity)!==0n||quantity(child.reversed_base_quantity)!==0n)fail();
  sameQuantity(line.shipped_base_quantity,child.shipped_base_quantity,salesLine.baseQuantity,owner.baseQuantity);
  const salesMembers=index(salesLine.reservations,"claimId",50),ownerMembers=index(owner.reservations,"claimId",50);
  if(salesMembers.size!==ownerMembers.size)fail();
  const reservations=[...salesMembers.values()].sort((a,b)=>compare(a.inventoryReservationId,b.inventoryReservationId)).map(member=>{
   const claim=originalClaims.get(member.claimId),current=ownerMembers.get(member.claimId);
   if(!claim||!current||usedClaims.has(member.claimId)||usedReservations.has(member.inventoryReservationId)||key(claim.fulfillment_id)!==key(root.id)||key(claim.fulfillment_line_id)!==key(line.id)||
      key(claim.inventory_reservation_id)!==member.inventoryReservationId||key(claim.sales_order_line_reservation_id)!==member.salesReservationMappingId||current.inventoryReservationId!==member.inventoryReservationId||
      current.originalInventoryOperationId!==member.originalInventoryOperationId||originalOperations.has(member.originalInventoryOperationId)||claim.status!=="CONSUMED"||quantity(claim.active_claimed_quantity)!==0n||quantity(claim.reversed_quantity)!==0n)fail();
   sameQuantity(claim.consumed_quantity,member.baseQuantity,current.baseQuantity);
   const state=current.currentState,expectedVersion=version(current.expectedVersion);
   if(!state||version(state.version)!==expectedVersion||version(member.inventoryVersionFloor)>expectedVersion||version(Number(claim.inventory_version))>expectedVersion||
      !["CONSUMED","PARTIALLY_CONSUMED"].includes(state.status)||quantity(state.originalQuantity)!==quantity(state.consumedQuantity)+quantity(state.releasedQuantity)+quantity(state.outstandingQuantity)||quantity(state.consumedQuantity)<quantity(member.baseQuantity))fail();
   sameQuantity(state.consumedQuantity,member.consumedBaseQuantity);sameQuantity(state.outstandingQuantity,member.outstandingBaseQuantity);
   usedClaims.add(member.claimId);usedReservations.add(member.inventoryReservationId);originalOperations.add(key(member.originalInventoryOperationId));
   const legs=index(current.allocations,"inventoryAllocationId",50);
   const selected=[...legs.values()].sort((a,b)=>compare(a.inventoryAllocationId,b.inventoryAllocationId)).map(leg=>{
    const issue=originalIssues.get(leg.inventoryAllocationId),allocation=originalAllocations.get(leg.inventoryAllocationId);
    if(!issue||!allocation||usedAllocations.has(leg.inventoryAllocationId)||key(issue.shipment_id)!==key(shipment.id)||key(issue.shipment_line_id)!==key(child.id)||
       key(issue.fulfillment_allocation_id)!==key(allocation.id)||key(issue.inventory_operation_id)!==member.originalInventoryOperationId||key(issue.inventory_movement_id)!==leg.originalMovementId||
       key(issue.inventory_reservation_id)!==member.inventoryReservationId||key(issue.inventory_balance_id)!==key(allocation.inventory_balance_id)||issue.reversal_movement_id!==null||
       key(allocation.fulfillment_id)!==key(root.id)||key(allocation.fulfillment_line_id)!==key(line.id)||key(allocation.claim_id)!==member.claimId||key(allocation.inventory_reservation_id)!==member.inventoryReservationId||allocation.status!=="CONSUMED")fail();
    sameQuantity(issue.issued_base_quantity,allocation.picked_base_quantity,leg.baseQuantity);bucketMatches(issue,allocation,leg.bucketSnapshot,line,root);
    const balanceId=key(issue.inventory_balance_id),expectedBalanceVersion=version(leg.expectedBalanceVersion),prior=balanceVersions.get(balanceId);
    if(version(Number(allocation.balance_version))>expectedBalanceVersion||prior!==undefined&&prior!==expectedBalanceVersion)fail();
    balanceVersions.set(balanceId,expectedBalanceVersion);usedAllocations.add(leg.inventoryAllocationId);
    return {inventoryAllocationId:leg.inventoryAllocationId,shipmentIssueId:key(issue.id),originalMovementId:leg.originalMovementId,expectedBalanceVersion,baseQuantity:leg.baseQuantity};
   });
   return {claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,expectedVersion,baseQuantity:member.baseQuantity,originalInventoryOperationId:member.originalInventoryOperationId,allocations:selected};
  });
  return {fulfillmentLineId:key(line.id),salesOrderLineId,baseQuantity:salesLine.baseQuantity,reservations};
 });
 if(usedClaims.size!==originalClaims.size||usedAllocations.size!==originalIssues.size)fail();
 const inventoryPayload=normalizeFulfillmentInventoryBatch("REVERSE",{fulfillmentId:key(root.id),shipmentId:key(shipment.id),lines:mapped});
 // The caller supplies the trusted original E_R/actor and genuine preclaim requestHash later.
 const salesIntentFields={purpose:"SHIPMENT_REVERSED",salesOrderId:salesScope.salesOrderId,expectedOrderVersion:version(salesScope.observedVersion),shipmentId:salesScope.shipmentId,originalConfirmationEventId:salesScope.originalConfirmationEventId,
  lines:inventoryPayload.lines.map(line=>({salesOrderLineId:line.salesOrderLineId,expectedVersion:version(salesLines.get(line.salesOrderLineId).observedVersion),baseQuantity:line.baseQuantity,
   reservations:line.reservations.map(({claimId,inventoryReservationId,expectedVersion,baseQuantity,originalInventoryOperationId})=>({claimId,inventoryReservationId,expectedVersion,baseQuantity,originalInventoryOperationId}))}))};
 return freezeShipmentIntent({inventoryPayload,salesIntentFields});
}
