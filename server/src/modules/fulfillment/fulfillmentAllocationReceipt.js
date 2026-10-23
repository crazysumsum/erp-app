import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
const fail=()=>{throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");};
const fields=(value,keys)=>{if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join(",")!==[...keys].sort().join(","))fail();};
const id=value=>{try{fulfillmentInteger(value);}catch{fail();}};
const date=value=>{if(value!==null&&(typeof value!=="string"||! /^\d{4}-\d{2}-\d{2}$/u.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))fail();};
export function fulfillmentAllocationProjectionRows(result,payload,preparation,snapshot,at) {
 fields(result,["operationId","lines"]);if(result.operationId!==preparation.operationId||!Array.isArray(result.lines)||result.lines.length!==payload.lines.length)fail();
 const projections=[],allocationIds=new Set(),operationIds=new Set(),balanceVersions=new Map();
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
