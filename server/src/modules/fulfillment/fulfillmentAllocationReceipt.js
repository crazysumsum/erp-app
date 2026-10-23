import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
const fail=()=>{throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");};
const fields=(value,keys)=>{if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join(",")!==[...keys].sort().join(","))fail();};
const id=value=>{try{fulfillmentInteger(value);}catch{fail();}};
const date=value=>{if(value!==null&&(typeof value!=="string"||! /^\d{4}-\d{2}-\d{2}$/u.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))fail();};
export function fulfillmentAllocationProjectionRows(result,payload,preparation,snapshot,at,initialBalanceVersions=new Map()) {
 fields(result,["operationId","lines"]);if(result.operationId!==preparation.operationId||!Array.isArray(result.lines)||result.lines.length!==payload.lines.length)fail();
 const projections=[],allocationIds=new Set(),operationIds=new Set(),balanceVersions=new Map(initialBalanceVersions);
 const returned=new Map(result.lines.map(line=>{fields(line,["fulfillmentLineId","salesOrderLineId","baseQuantity","reservations"]);return [line.fulfillmentLineId,line];}));if(returned.size!==payload.lines.length)fail();
 for(const line of [...payload.lines].sort((a,b)=>Number(a.fulfillmentLineId)-Number(b.fulfillmentLineId))){
  const output=returned.get(line.fulfillmentLineId),owned=snapshot.lines.find(row=>String(row.id)===line.fulfillmentLineId);fields(output,["fulfillmentLineId","salesOrderLineId","baseQuantity","reservations"]);
  if(!owned||output.salesOrderLineId!==line.salesOrderLineId||output.baseQuantity!==line.baseQuantity||!Array.isArray(output.reservations)||output.reservations.length!==line.reservations.length)fail();
  const members=new Map(output.reservations.map(member=>{fields(member,["claimId","inventoryReservationId","expectedVersion","version","baseQuantity","inventoryOperationId","allocations"]);return [member.claimId,member];}));if(members.size!==line.reservations.length)fail();
  for(const member of line.reservations){
   const actual=members.get(member.claimId);fields(actual,["claimId","inventoryReservationId","expectedVersion","version","baseQuantity","inventoryOperationId","allocations"]);
   if(actual.inventoryReservationId!==member.inventoryReservationId||actual.expectedVersion!==member.expectedVersion||actual.version!==member.expectedVersion+1||actual.version>4294967295||actual.baseQuantity!==member.baseQuantity||!Array.isArray(actual.allocations)||actual.allocations.length!==member.allocations.length)fail();id(actual.inventoryOperationId);if(operationIds.has(actual.inventoryOperationId))fail();operationIds.add(actual.inventoryOperationId);
   const legs=new Map(actual.allocations.map(leg=>{fields(leg,["inventoryAllocationId","inventoryBalanceId","baseQuantity","allocationVersion","balanceVersion","selectionStrategy","isSequenceOverride","recommendedRank","bucketSnapshot","recommendedSummary"]);return [leg.inventoryBalanceId,leg];}));if(legs.size!==member.allocations.length)fail();
   for(const selected of member.allocations){
    const leg=legs.get(selected.inventoryBalanceId);fields(leg,["inventoryAllocationId","inventoryBalanceId","baseQuantity","allocationVersion","balanceVersion","selectionStrategy","isSequenceOverride","recommendedRank","bucketSnapshot","recommendedSummary"]);
    id(leg.inventoryAllocationId);if(allocationIds.has(leg.inventoryAllocationId))fail();allocationIds.add(leg.inventoryAllocationId);
    const expectedBalance=(balanceVersions.get(selected.inventoryBalanceId)??selected.expectedBalanceVersion)+1;balanceVersions.set(selected.inventoryBalanceId,expectedBalance);
    if(leg.baseQuantity!==selected.baseQuantity||leg.allocationVersion!==1||leg.balanceVersion!==expectedBalance||leg.balanceVersion>4294967295||typeof leg.isSequenceOverride!=="boolean"||leg.isSequenceOverride!==(member.overrideReason!=="")||!Number.isSafeInteger(leg.recommendedRank)||leg.recommendedRank<1)fail();
    const bucket=leg.bucketSnapshot;fields(bucket,["warehouseId","warehouseCode","binId","binCode","lotId","lotNumber","expiryDate","stockStatus","skuId","skuCode","skuName","baseUomId","baseUomCode","postedAt"]);
    for(const key of ["warehouseId","binId","skuId","baseUomId"])id(bucket[key]);if(bucket.lotId!==null)id(bucket.lotId);
    if(bucket.warehouseId!==String(snapshot.header.warehouse_id)||bucket.skuId!==String(owned.sku_id)||bucket.baseUomId!==String(owned.base_uom_id)||bucket.stockStatus!=="AVAILABLE"||leg.selectionStrategy!==(bucket.expiryDate?"FEFO":"FIFO")||bucket.lotId===null&&(bucket.lotNumber!==null||bucket.expiryDate!==null)||typeof bucket.binCode!=="string"||!bucket.binCode||[...bucket.binCode].length>100||!Number.isSafeInteger(bucket.postedAt)||bucket.postedAt<0)fail();
    date(bucket.expiryDate);if(bucket.lotId!==null&&(typeof bucket.lotNumber!=="string"||!bucket.lotNumber||[...bucket.lotNumber].length>100))fail();
    if(!leg.isSequenceOverride){if(leg.recommendedSummary!==null)fail();}else{fields(leg.recommendedSummary,["recommendedBalanceId","recommendedExpiryDate","selectedBalanceId","selectedExpiryDate"]);id(leg.recommendedSummary.recommendedBalanceId);date(leg.recommendedSummary.recommendedExpiryDate);date(leg.recommendedSummary.selectedExpiryDate);if(leg.recommendedSummary.selectedBalanceId!==selected.inventoryBalanceId||leg.recommendedSummary.selectedExpiryDate!==bucket.expiryDate)fail();}
    projections.push({fulfillment_id:String(snapshot.header.id),fulfillment_line_id:line.fulfillmentLineId,claim_id:member.claimId,inventory_reservation_id:member.inventoryReservationId,inventory_allocation_id:leg.inventoryAllocationId,inventory_balance_id:leg.inventoryBalanceId,warehouse_id:bucket.warehouseId,bin_id:bucket.binId,lot_id:bucket.lotId,bin_code_snapshot:bucket.binCode,lot_number_snapshot:bucket.lotNumber??"",expiry_date_snapshot:bucket.expiryDate,stock_status_snapshot:bucket.stockStatus,selection_strategy:leg.selectionStrategy,recommended_rank_snapshot:leg.recommendedRank,is_sequence_override:leg.isSequenceOverride?1:0,override_reason:member.overrideReason,recommended_summary:leg.recommendedSummary===null?null:JSON.stringify(leg.recommendedSummary),allocated_base_quantity:leg.baseQuantity,status:"ACTIVE",inventory_version:leg.allocationVersion,balance_version:leg.balanceVersion,created_at:at,updated_at:at});
   }
  }
 }
 return projections;
}

export function fulfillmentReallocationProjectionRows(result,payload,preparation,snapshot,at){
 fields(result,["operationId","lines"]);if(!Array.isArray(result.lines)||result.lines.length!==payload.lines.length)fail();
 const returned=new Map(result.lines.map(line=>{fields(line,["fulfillmentLineId","salesOrderLineId","baseQuantity","reservations"]);return [line.fulfillmentLineId,line];}));if(returned.size!==payload.lines.length)fail();
 const versions=new Map(),oldByInventory=new Map(snapshot.allocations.map(row=>[String(row.inventory_allocation_id),row])),oldRows=[],seen=new Set();
 for(const line of [...payload.lines].sort((a,b)=>Number(a.fulfillmentLineId)-Number(b.fulfillmentLineId))){
  const output=returned.get(line.fulfillmentLineId);if(!output||!Array.isArray(output.reservations)||output.reservations.length!==line.reservations.length)fail();const members=new Map(output.reservations.map(member=>{fields(member,["claimId","inventoryReservationId","expectedVersion","version","baseQuantity","inventoryOperationId","allocations","releases"]);return [member.claimId,member];}));if(members.size!==line.reservations.length)fail();
  for(const member of line.reservations){const actual=members.get(member.claimId);if(!actual||!Array.isArray(actual.releases)||actual.releases.length!==member.releases.length)fail();const releases=new Map(actual.releases.map(leg=>{fields(leg,["inventoryAllocationId","inventoryBalanceId","baseQuantity","allocationVersion","balanceVersion","status","releasedQuantity","outstandingQuantity"]);return [leg.inventoryAllocationId,leg];}));if(releases.size!==member.releases.length)fail();
   for(const selected of member.releases){const leg=releases.get(selected.inventoryAllocationId),old=oldByInventory.get(selected.inventoryAllocationId),expectedBalance=(versions.get(selected.inventoryBalanceId)??selected.expectedBalanceVersion)+1;if(!leg||!old||seen.has(selected.inventoryAllocationId)||leg.inventoryBalanceId!==selected.inventoryBalanceId||leg.baseQuantity!==selected.baseQuantity||leg.allocationVersion!==selected.expectedVersion+1||leg.allocationVersion>4294967295||leg.balanceVersion!==expectedBalance||expectedBalance>4294967295||leg.status!=="RELEASED"||leg.releasedQuantity!==String(old.allocated_base_quantity)||leg.outstandingQuantity!=="0")fail();versions.set(selected.inventoryBalanceId,expectedBalance);seen.add(selected.inventoryAllocationId);oldRows.push({id:String(old.id),inventoryAllocationId:selected.inventoryAllocationId,inventoryVersion:leg.allocationVersion,balanceVersion:leg.balanceVersion,priorVersion:Number(old.inventory_version)});}
  }
 }
 if(seen.size!==snapshot.allocations.length)fail();
 const stripped={...result,lines:result.lines.map(line=>({...line,reservations:line.reservations.map(member=>{const {releases:_releases,...selection}=member;return selection;})}))},newRows=fulfillmentAllocationProjectionRows(stripped,payload,preparation,snapshot,at,versions);
 for(const row of newRows){if(seen.has(row.inventory_allocation_id))fail();versions.set(row.inventory_balance_id,row.balance_version);}
 return {oldRows,newRows,finalBalanceVersions:versions};
}

export function assertReallocationOwnerStates(current,projection,snapshot){
 fields(current,["fulfillmentId","allocations"]);if(current.fulfillmentId!==String(snapshot.header.id)||!Array.isArray(current.allocations)||current.allocations.length!==projection.oldRows.length+projection.newRows.length)fail();
 const oldById=new Map(snapshot.allocations.map(row=>[String(row.inventory_allocation_id),row])),released=new Map(projection.oldRows.map(row=>[row.inventoryAllocationId,row])),created=new Map(projection.newRows.map(row=>[row.inventory_allocation_id,row])),lines=new Map(snapshot.lines.map(row=>[String(row.id),row])),seen=new Set();
 for(const row of current.allocations){
  fields(row,["inventoryAllocationId","inventoryReservationId","claimId","fulfillmentLineId","salesOrderLineId","inventoryBalanceId","warehouseId","skuId","version","balanceVersion","status","allocatedQuantity","consumedQuantity","releasedQuantity","outstandingQuantity"]);const old=oldById.get(row.inventoryAllocationId),fresh=created.get(row.inventoryAllocationId),owned=old??fresh,line=owned&&lines.get(String(owned.fulfillment_line_id));if(!owned||!line||seen.has(row.inventoryAllocationId)||old&&fresh)fail();seen.add(row.inventoryAllocationId);
  if(row.inventoryReservationId!==String(owned.inventory_reservation_id)||row.claimId!==String(owned.claim_id)||row.fulfillmentLineId!==String(owned.fulfillment_line_id)||row.salesOrderLineId!==String(line.sales_order_line_id)||row.inventoryBalanceId!==String(owned.inventory_balance_id)||row.warehouseId!==String(snapshot.header.warehouse_id)||row.skuId!==String(line.sku_id)||row.balanceVersion!==projection.finalBalanceVersions.get(row.inventoryBalanceId)||row.allocatedQuantity!==String(owned.allocated_base_quantity)||row.consumedQuantity!=="0"||row.version!==(old?released.get(row.inventoryAllocationId)?.inventoryVersion:1)||row.status!==(old?"RELEASED":"ACTIVE")||row.releasedQuantity!==(old?String(old.allocated_base_quantity):"0")||row.outstandingQuantity!==(old?"0":String(fresh.allocated_base_quantity)))fail();
 }
}
