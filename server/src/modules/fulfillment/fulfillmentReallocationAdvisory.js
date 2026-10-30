import {assertClaimQuantities,assertFulfillmentQuantities} from "./fulfillmentQuantityMath.js";
import {fulfillmentInteger} from "./fulfillmentValidation.js";
import {fulfillmentError} from "./fulfillmentErrors.js";
import {assertFulfillmentCandidateResult} from "./fulfillmentCandidateResult.js";
import {assertPickOwnerShape,assertPickOwnerVersions,assertPickOwnerMatches} from "./fulfillmentPickingScope.js";
const fail=(code="FULFILLMENT_SOURCE_CONFLICT")=>{throw fulfillmentError(code);};
const amount=value=>{try{return fulfillmentInteger(String(value),{positive:false});}catch{fail();}};
const total=(rows,key)=>rows.reduce((sum,row)=>sum+amount(row[key]),0n);

export function reallocationAdvisoryQuery(snapshot,{version,page},asOf){
 const {header,lines,claims,allocations,allocationTotals}=snapshot;
 if(header.status!=="PICKING"||header.active_shipment_id!==null||header.allocated_at===null||["picked_at","shipped_at","reversed_at"].some(key=>header[key]!==null))fail("FULFILLMENT_STATE_CONFLICT");
 if(Number(header.version)!==version||version>=4294967295)fail("VERSION_CONFLICT");
 if(!lines.length||lines.length>100||lines.length!==Number(header.line_count)||!claims.length||claims.length>5000||!allocations.length||allocations.length>5000||allocationTotals.length!==lines.length)fail();
 for(const rows of [lines,claims,allocations])if(new Set(rows.map(row=>String(row.id))).size!==rows.length)fail();
 if(new Set(claims.map(row=>String(row.inventory_reservation_id))).size!==claims.length||new Set(allocations.map(row=>String(row.inventory_allocation_id))).size!==allocations.length||new Set(allocationTotals.map(row=>String(row.fulfillment_line_id))).size!==lines.length)fail();
 const selected=lines.map(line=>{
  if(String(line.fulfillment_id)!==String(header.id))fail();if(Number(line.version)>=4294967295)fail("VERSION_CONFLICT");
  const members=claims.filter(row=>String(row.fulfillment_line_id)===String(line.id)),old=allocations.filter(row=>String(row.fulfillment_line_id)===String(line.id)),totals=allocationTotals.find(row=>String(row.fulfillment_line_id)===String(line.id));
  if(!totals||!members.length||members.length>50||!old.length||old.length>50||amount(totals.allocated)!==amount(line.allocated_base_quantity)||amount(totals.picked)!==0n||amount(line.allocated_base_quantity)+amount(line.planned_base_quantity)>BigInt(Number.MAX_SAFE_INTEGER)||total(members,"active_claimed_quantity")!==amount(line.planned_base_quantity))fail();
  try{assertFulfillmentQuantities("PICKING",[{planned:String(line.planned_base_quantity),allocated:String(line.allocated_base_quantity),released:String(totals.released),picked:String(line.picked_base_quantity),short:String(line.short_base_quantity),shipped:String(line.shipped_base_quantity),reversed:String(line.reversed_base_quantity)}]);}catch{fail();}
  const reservations=members.map(claim=>{
   if(String(claim.fulfillment_id)!==String(header.id)||claim.status!=="ACTIVE"||amount(claim.active_claimed_quantity)===0n||["released_quantity","consumed_quantity","reversed_quantity"].some(key=>amount(claim[key])!==0n))fail();
   try{assertClaimQuantities({original:String(claim.original_claimed_quantity),active:String(claim.active_claimed_quantity),released:String(claim.released_quantity),consumed:String(claim.consumed_quantity),reversed:String(claim.reversed_quantity)});}catch{fail();}
   const owned=old.filter(row=>String(row.claim_id)===String(claim.id));if(!owned.length||total(owned,"allocated_base_quantity")-total(owned,"released_base_quantity")!==amount(claim.active_claimed_quantity))fail();
   const releases=owned.map(row=>{
    if(String(row.fulfillment_id)!==String(header.id)||String(row.inventory_reservation_id)!==String(claim.inventory_reservation_id)||!["ACTIVE","PARTIALLY_RELEASED"].includes(row.status)||amount(row.picked_base_quantity)!==0n||amount(row.allocated_base_quantity)<=amount(row.released_base_quantity))fail();
    if(Number(row.inventory_version)>=4294967295)fail("VERSION_CONFLICT");
    return {inventoryAllocationId:String(row.inventory_allocation_id),expectedVersion:Number(row.inventory_version),baseQuantity:(amount(row.allocated_base_quantity)-amount(row.released_base_quantity)).toString()};
   }).sort((a,b)=>Number(a.inventoryAllocationId)-Number(b.inventoryAllocationId));
   return {claimId:String(claim.id),inventoryReservationId:String(claim.inventory_reservation_id),baseQuantity:String(claim.active_claimed_quantity),releases};
  }).sort((a,b)=>Number(a.inventoryReservationId)-Number(b.inventoryReservationId));
  if(old.some(row=>!members.some(claim=>String(claim.id)===String(row.claim_id))))fail();
  return {fulfillmentLineId:String(line.id),salesOrderLineId:String(line.sales_order_line_id),skuId:String(line.sku_id),baseQuantity:String(line.planned_base_quantity),reservations};
 }).sort((a,b)=>Number(a.fulfillmentLineId)-Number(b.fulfillmentLineId));
 if(claims.some(row=>!lines.some(line=>String(line.id)===String(row.fulfillment_line_id)))||allocations.some(row=>!lines.some(line=>String(line.id)===String(row.fulfillment_line_id))))fail();
 return {fulfillmentId:String(header.id),salesOrderId:String(header.sales_order_id),warehouseId:String(header.warehouse_id),lines:selected,page,asOf};
}

export function assertReallocationAdvisoryResult(result,snapshot,query,source){
 const unavailable=()=>fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
 if(!result||Object.keys(result).sort().join(",")!=="asOf,demands,scope,warehouseId"||!Array.isArray(result.demands))unavailable();
 const ids=snapshot.allocations.map(row=>String(row.inventory_allocation_id)),scopeQuery={fulfillmentId:query.fulfillmentId,inventoryAllocationIds:ids};
 assertPickOwnerShape(result.scope,scopeQuery);assertPickOwnerVersions(snapshot,result.scope);assertPickOwnerMatches(snapshot,result.scope);
 const sourceByClaim=new Map(source.lines.flatMap(line=>line.reservations.map(member=>[member.claimId,{...member,salesOrderLineId:line.salesOrderLineId}]))),reservationById=new Map(result.scope.reservationFacts.map(row=>[row.inventoryReservationId,row]));
 if(source.orderId!==query.salesOrderId||sourceByClaim.size!==snapshot.claims.length)unavailable();
 for(const claim of snapshot.claims){const expected=sourceByClaim.get(String(claim.id)),fact=reservationById.get(String(claim.inventory_reservation_id)),line=snapshot.lines.find(row=>String(row.id)===String(claim.fulfillment_line_id));if(!expected||!fact||!line||expected.inventoryReservationId!==String(claim.inventory_reservation_id)||expected.salesReservationMappingId!==String(claim.sales_order_line_reservation_id)||fact.salesOrderId!==query.salesOrderId||fact.salesOrderLineId!==String(line.sales_order_line_id)||fact.warehouseId!==query.warehouseId||fact.skuId!==String(line.sku_id)||fact.originalSourceEventId!==expected.sourceEventId||fact.originalQuantity!==expected.originalBaseQuantity)unavailable();}
 const credits=new Map(),versions=new Map();
 for(const fact of result.scope.allocations){if(!["ACTIVE","PARTIALLY_CONSUMED"].includes(fact.status)||BigInt(fact.outstandingQuantity)<=0n)unavailable();credits.set(fact.inventoryBalanceId,(credits.get(fact.inventoryBalanceId)??0n)+BigInt(fact.outstandingQuantity));versions.set(fact.inventoryBalanceId,fact.balanceVersion);}
 const demands=query.lines.flatMap(line=>line.reservations.map(member=>({fulfillmentLineId:line.fulfillmentLineId,claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,skuId:line.skuId,requestedQuantity:member.baseQuantity,page:query.page}))),claims=result.scope.reservationFacts.map(row=>({inventoryReservationId:row.inventoryReservationId,inventoryVersion:row.version}));
 const converted={warehouseId:result.warehouseId,asOf:result.asOf,demands:result.demands.map(member=>{
  if(!member||!Array.isArray(member.candidates))unavailable();
  return {...member,candidates:member.candidates.map(candidate=>{
   if(!candidate)unavailable();const {physicalFreeQuantity,ownReleaseCredit,availableAfterOwnRelease,...rest}=candidate;
   let physical,credit,available;try{physical=fulfillmentInteger(physicalFreeQuantity,{positive:false});credit=fulfillmentInteger(ownReleaseCredit,{positive:false});available=fulfillmentInteger(availableAfterOwnRelease);}catch{unavailable();}
   if(credit!==(credits.get(candidate.inventoryBalanceId)??0n)||available!==physical+credit)unavailable();
   const prior=versions.get(candidate.inventoryBalanceId);if(prior!==undefined&&prior!==candidate.expectedBalanceVersion)unavailable();versions.set(candidate.inventoryBalanceId,candidate.expectedBalanceVersion);
   return {...rest,freeQuantity:availableAfterOwnRelease};
  })};
 })};
 assertFulfillmentCandidateResult(converted,demands,claims,query.warehouseId,new Map(snapshot.lines.map(row=>[String(row.id),String(row.base_uom_id)])));
 const {scope:_scope,...projection}=result;return projection;
}
