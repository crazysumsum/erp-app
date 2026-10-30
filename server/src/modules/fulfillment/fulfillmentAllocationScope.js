import { assertClaimQuantities,assertFulfillmentQuantities } from "./fulfillmentQuantityMath.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
const fail=(code="FULFILLMENT_SOURCE_CONFLICT")=>{throw fulfillmentError(code);};
function preparationQuery({header,lines,claims,allocations=[],allocationTotals=[]},command,reallocate) {
 if(!header)fail("FULFILLMENT_NOT_FOUND");
 if(header.status!==(reallocate?"PICKING":"DRAFT"))fail("FULFILLMENT_STATE_CONFLICT");if(Number(header.version)!==command.version||Number(header.version)>=4294967295)fail("VERSION_CONFLICT");
 if(!lines.length||lines.length>100||lines.length!==Number(header.line_count)||!claims.length||claims.length>5000)fail();
 if(header.active_shipment_id!==null||(reallocate?["picked_at","shipped_at","reversed_at"]:["allocated_at","picked_at","shipped_at","reversed_at"]).some(key=>header[key]!==null)||reallocate&&header.allocated_at===null)fail("FULFILLMENT_STATE_CONFLICT");
 const totals=new Map(allocationTotals.map(row=>[String(row.fulfillment_line_id),row]));
 if(reallocate&&(!allocations.length||allocations.length>5000||totals.size!==lines.length||allocationTotals.length!==lines.length||allocationTotals.some(row=>!lines.some(line=>String(line.id)===String(row.fulfillment_line_id)))))fail();
 assertFulfillmentQuantities(reallocate?"PICKING":"DRAFT",lines.map(line=>{const total=totals.get(String(line.id));if(reallocate&&(!total||String(total.allocated)!==String(line.allocated_base_quantity)||BigInt(total.picked)!==0n||BigInt(line.allocated_base_quantity)+BigInt(line.planned_base_quantity)>BigInt(Number.MAX_SAFE_INTEGER)))fail();return {planned:String(line.planned_base_quantity),allocated:String(line.allocated_base_quantity),released:reallocate?String(total.released):"0",picked:String(line.picked_base_quantity),short:String(line.short_base_quantity),shipped:String(line.shipped_base_quantity),reversed:String(line.reversed_base_quantity)};}));
 if(command.lines.length!==lines.length)fail("FULFILLMENT_INPUT_INVALID");
 const selected=lines.map(line=>{
  if(Number(line.version)>=4294967295)fail("VERSION_CONFLICT");
  const input=command.lines.find(row=>String(row.fulfillmentLineId)===String(line.id)),members=claims.filter(row=>String(row.fulfillment_line_id)===String(line.id));
  if(!input)fail("FULFILLMENT_INPUT_INVALID");if(!members.length||members.length>50)fail();
  for(const claim of members){assertClaimQuantities({original:String(claim.original_claimed_quantity),active:String(claim.active_claimed_quantity),released:String(claim.released_quantity),consumed:String(claim.consumed_quantity),reversed:String(claim.reversed_quantity)});if(claim.status!=="ACTIVE"||BigInt(claim.active_claimed_quantity)<=0n||BigInt(claim.released_quantity)!==0n||BigInt(claim.consumed_quantity)!==0n||BigInt(claim.reversed_quantity)!==0n)fail();}
  if(members.reduce((sum,row)=>sum+BigInt(row.active_claimed_quantity),0n)!==BigInt(line.planned_base_quantity))fail();
  if(input.allocations.some(leg=>!members.some(claim=>String(claim.inventory_reservation_id)===String(leg.inventoryReservationId))))fail("FULFILLMENT_INPUT_INVALID");
  const old=allocations.filter(row=>String(row.fulfillment_line_id)===String(line.id)),oldInput=new Map((input.releases??[]).map(row=>[String(row.fulfillmentAllocationId),row]));
  if(reallocate&&(!old.length||old.length>50||old.length!==oldInput.size||old.length!==input.releases.length||old.some(row=>!oldInput.has(String(row.id))||Number(row.inventory_version)!==oldInput.get(String(row.id)).inventoryAllocationVersion||Number(row.inventory_version)>=4294967295||!["ACTIVE","PARTIALLY_RELEASED"].includes(row.status)||BigInt(row.picked_base_quantity)!==0n||BigInt(row.allocated_base_quantity)<=BigInt(row.released_base_quantity)||!members.some(claim=>String(claim.id)===String(row.claim_id)&&String(claim.inventory_reservation_id)===String(row.inventory_reservation_id)))))fail("VERSION_CONFLICT");
  const reservations=members.map(claim=>{
   const allocations=input.allocations.filter(leg=>String(leg.inventoryReservationId)===String(claim.inventory_reservation_id));
   if(!allocations.length||allocations.reduce((sum,leg)=>sum+BigInt(leg.baseQuantity),0n)!==BigInt(claim.active_claimed_quantity))fail("FULFILLMENT_INPUT_INVALID");
   const releases=old.filter(row=>String(row.claim_id)===String(claim.id)).map(row=>({inventoryAllocationId:String(row.inventory_allocation_id),expectedVersion:Number(row.inventory_version),baseQuantity:(BigInt(row.allocated_base_quantity)-BigInt(row.released_base_quantity)).toString()})).sort((a,b)=>Number(a.inventoryAllocationId)-Number(b.inventoryAllocationId));
   if(reallocate&&(!releases.length||releases.reduce((sum,row)=>sum+BigInt(row.baseQuantity),0n)!==BigInt(claim.active_claimed_quantity)))fail();
   return {...(reallocate?{releases}:{}),claimId:String(claim.id),inventoryReservationId:String(claim.inventory_reservation_id),baseQuantity:String(claim.active_claimed_quantity),allocations:allocations.map(leg=>({inventoryBalanceId:String(leg.inventoryBalanceId),expectedBalanceVersion:leg.balanceVersion,baseQuantity:leg.baseQuantity}))};
  }).sort((a,b)=>Number(a.inventoryReservationId)-Number(b.inventoryReservationId));
  return {fulfillmentLineId:String(line.id),salesOrderLineId:String(line.sales_order_line_id),skuId:String(line.sku_id),baseQuantity:String(line.planned_base_quantity),overrideReason:input.overrideReason,reservations};
 }).sort((a,b)=>Number(a.salesOrderLineId)-Number(b.salesOrderLineId));
 if(claims.some(claim=>!lines.some(line=>String(line.id)===String(claim.fulfillment_line_id)))||reallocate&&allocations.some(row=>!lines.some(line=>String(line.id)===String(row.fulfillment_line_id))))fail();
 return {fulfillmentId:String(header.id),salesOrderId:String(header.sales_order_id),warehouseId:String(header.warehouse_id),lines:selected};
}
export function allocationPreparationQuery(snapshot,command){return preparationQuery(snapshot,command,false);}
export function reallocationPreparationQuery(snapshot,command){return preparationQuery(snapshot,command,true);}
export function assertAllocationSourceFacts(snapshot,allClaims,salesFacts,nativeFacts) {
 if(salesFacts.orderId!==String(snapshot.header.sales_order_id)||nativeFacts.length!==snapshot.claims.length)fail();
 const states=new Map(nativeFacts.map(row=>[row.inventoryReservationId,row])),sources=salesFacts.lines.flatMap(line=>line.reservations.map(row=>({...row,salesOrderLineId:line.salesOrderLineId}))),byClaim=new Map(sources.map(row=>[row.claimId,row])),byLine=new Map(snapshot.lines.map(line=>[String(line.id),line]));if(states.size!==nativeFacts.length||sources.length!==snapshot.claims.length||byClaim.size!==sources.length)fail();
 const totals=new Map();for(const claim of allClaims)if(claim.status==="ACTIVE")totals.set(String(claim.inventory_reservation_id),(totals.get(String(claim.inventory_reservation_id))??0n)+BigInt(claim.active_claimed_quantity));
 for(const claim of snapshot.claims){
  const state=states.get(String(claim.inventory_reservation_id)),source=byClaim.get(String(claim.id)),line=byLine.get(String(claim.fulfillment_line_id));
  if(!state||!source||!line||state.warehouseId!==String(snapshot.header.warehouse_id)||state.salesOrderId!==String(snapshot.header.sales_order_id)||state.salesOrderLineId!==String(line.sales_order_line_id)||state.skuId!==String(line.sku_id)||source.salesOrderLineId!==String(line.sales_order_line_id)||source.salesReservationMappingId!==String(claim.sales_order_line_reservation_id)||source.inventoryReservationId!==String(claim.inventory_reservation_id)||state.originalQuantity!==source.originalBaseQuantity||state.consumedQuantity!==source.consumedBaseQuantity||state.releasedQuantity!==source.releasedBaseQuantity||state.outstandingQuantity!==source.outstandingBaseQuantity||state.originalSourceEventId!==source.sourceEventId||state.version<source.inventoryVersion||state.version<Number(claim.inventory_version)||!totals.has(state.inventoryReservationId)||totals.get(state.inventoryReservationId)>BigInt(state.outstandingQuantity))fail("FULFILLABLE_QUANTITY_CHANGED");
 }
}

// The owner may derive Reservation CAS/reason, but cannot replace a caller's selection.
export function assertPreparedFulfillmentAllocation(prepared,query) {
 const unavailable=()=>fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE"),fields=(value,keys)=>{if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))unavailable();},array=(value,length)=>{if(!Array.isArray(value)||value.length!==length)unavailable();};
 fields(prepared,["payload","reservationFacts"]);fields(prepared.payload,["fulfillmentId","lines"]);
 if(prepared.payload.fulfillmentId!==query.fulfillmentId)unavailable();array(prepared.payload.lines,query.lines.length);
 const expectedMembers=query.lines.flatMap(line=>line.reservations.map(member=>({line,member})));array(prepared.reservationFacts,expectedMembers.length);
 const facts=new Map();
 for(const fact of prepared.reservationFacts){
  fields(fact,["inventoryReservationId","warehouseId","skuId","salesOrderId","salesOrderLineId","originalSourceEventId","originalQuantity","consumedQuantity","releasedQuantity","outstandingQuantity","version"]);
  if(facts.has(fact.inventoryReservationId)||typeof fact.originalSourceEventId!=="string"||!fact.originalSourceEventId||!Number.isInteger(fact.version)||fact.version<1||fact.version>=4294967295)unavailable();
  for(const key of ["originalQuantity","consumedQuantity","releasedQuantity","outstandingQuantity"])if(typeof fact[key]!=="string"||!/^(0|[1-9][0-9]*)$/u.test(fact[key])||BigInt(fact[key])>BigInt(Number.MAX_SAFE_INTEGER))unavailable();
  if(BigInt(fact.originalQuantity)!==BigInt(fact.consumedQuantity)+BigInt(fact.releasedQuantity)+BigInt(fact.outstandingQuantity))unavailable();facts.set(fact.inventoryReservationId,fact);
 }
 for(let index=0;index<query.lines.length;index++){
  const expected=query.lines[index],line=prepared.payload.lines[index];fields(line,["fulfillmentLineId","salesOrderLineId","baseQuantity","reservations"]);
  for(const key of ["fulfillmentLineId","salesOrderLineId","baseQuantity"])if(line[key]!==expected[key])unavailable();array(line.reservations,expected.reservations.length);
  for(let memberIndex=0;memberIndex<expected.reservations.length;memberIndex++){
   const selected=expected.reservations[memberIndex],member=line.reservations[memberIndex];fields(member,["claimId","inventoryReservationId","baseQuantity","allocations","expectedVersion","overrideReason"]);
   for(const key of ["claimId","inventoryReservationId","baseQuantity"])if(member[key]!==selected[key])unavailable();
   if(member.overrideReason!==""&&member.overrideReason!==expected.overrideReason.trim())unavailable();array(member.allocations,selected.allocations.length);
   for(let legIndex=0;legIndex<selected.allocations.length;legIndex++){const leg=member.allocations[legIndex];fields(leg,["inventoryBalanceId","expectedBalanceVersion","baseQuantity"]);for(const key of Object.keys(leg))if(leg[key]!==selected.allocations[legIndex][key])unavailable();}
   const fact=facts.get(member.inventoryReservationId);
   if(!fact||fact.version!==member.expectedVersion||fact.warehouseId!==query.warehouseId||fact.salesOrderId!==query.salesOrderId||fact.salesOrderLineId!==expected.salesOrderLineId||fact.skuId!==expected.skuId||BigInt(fact.outstandingQuantity)<BigInt(member.baseQuantity))unavailable();
  }
 }
}

export function assertPreparedFulfillmentReallocation(prepared,query,snapshot){
 const unavailable=()=>fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE"),fields=(value,keys)=>{if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))unavailable();};
 fields(prepared,["payload","reservationFacts","releaseFacts"]);fields(prepared.payload,["fulfillmentId","lines"]);if(!Array.isArray(prepared.payload.lines))unavailable();
 const stripped={payload:{...prepared.payload,lines:prepared.payload.lines.map(line=>{fields(line,["fulfillmentLineId","salesOrderLineId","baseQuantity","reservations"]);if(!Array.isArray(line.reservations))unavailable();return {...line,reservations:line.reservations.map(member=>{fields(member,["claimId","inventoryReservationId","baseQuantity","allocations","expectedVersion","overrideReason","releases"]);const {releases:_releases,...selection}=member;return selection;})};})},reservationFacts:prepared.reservationFacts};assertPreparedFulfillmentAllocation(stripped,query);
 if(!Array.isArray(prepared.releaseFacts)||prepared.releaseFacts.length!==snapshot.allocations.length)unavailable();
 const byOld=new Map(snapshot.allocations.map(row=>[String(row.inventory_allocation_id),row])),facts=new Map(),credits=new Map(),balances=new Map(),lines=new Map(snapshot.lines.map(row=>[String(row.id),row]));
 for(const fact of prepared.releaseFacts){
  fields(fact,["inventoryAllocationId","inventoryReservationId","claimId","fulfillmentLineId","salesOrderLineId","inventoryBalanceId","warehouseId","skuId","version","status","allocatedQuantity","consumedQuantity","releasedQuantity","outstandingQuantity","balanceVersion","physicalFreeQuantity","ownReleaseCredit","availableAfterOwnRelease"]);
  const old=byOld.get(fact.inventoryAllocationId),line=lines.get(fact.fulfillmentLineId);if(!old||!line||facts.has(fact.inventoryAllocationId))unavailable();
  for(const key of ["allocatedQuantity","consumedQuantity","releasedQuantity","outstandingQuantity","physicalFreeQuantity","ownReleaseCredit","availableAfterOwnRelease"])if(typeof fact[key]!=="string"||!/^(0|[1-9][0-9]*)$/u.test(fact[key])||BigInt(fact[key])>BigInt(Number.MAX_SAFE_INTEGER))unavailable();
  if(fact.inventoryReservationId!==String(old.inventory_reservation_id)||fact.claimId!==String(old.claim_id)||fact.fulfillmentLineId!==String(old.fulfillment_line_id)||fact.salesOrderLineId!==String(line.sales_order_line_id)||fact.inventoryBalanceId!==String(old.inventory_balance_id)||fact.warehouseId!==String(snapshot.header.warehouse_id)||fact.skuId!==String(line.sku_id)||fact.version!==Number(old.inventory_version)||fact.allocatedQuantity!==String(old.allocated_base_quantity)||fact.consumedQuantity!=="0"||fact.releasedQuantity!==String(old.released_base_quantity)||BigInt(fact.outstandingQuantity)!==BigInt(old.allocated_base_quantity)-BigInt(old.released_base_quantity)||!["ACTIVE","PARTIALLY_CONSUMED"].includes(fact.status)||!Number.isInteger(fact.balanceVersion)||fact.balanceVersion<Number(old.balance_version)||fact.balanceVersion>4294967295)unavailable();
  const prior=balances.get(fact.inventoryBalanceId);if(prior&&(prior.balanceVersion!==fact.balanceVersion||prior.physicalFreeQuantity!==fact.physicalFreeQuantity||prior.ownReleaseCredit!==fact.ownReleaseCredit))unavailable();balances.set(fact.inventoryBalanceId,fact);credits.set(fact.inventoryBalanceId,(credits.get(fact.inventoryBalanceId)??0n)+BigInt(fact.outstandingQuantity));facts.set(fact.inventoryAllocationId,fact);
 }
 for(const fact of facts.values())if(BigInt(fact.ownReleaseCredit)!==credits.get(fact.inventoryBalanceId)||BigInt(fact.availableAfterOwnRelease)!==BigInt(fact.physicalFreeQuantity)+BigInt(fact.ownReleaseCredit))unavailable();
 const requested=new Map(query.lines.flatMap(line=>line.reservations.map(member=>[member.claimId,member])));
 for(const line of prepared.payload.lines)for(const member of line.reservations){const expected=requested.get(member.claimId);if(!expected||!Array.isArray(member.releases)||member.releases.length!==expected.releases.length)unavailable();const seen=new Set();
  for(const leg of member.releases){fields(leg,["inventoryAllocationId","inventoryBalanceId","expectedVersion","expectedBalanceVersion","baseQuantity"]);const selected=expected.releases.find(row=>row.inventoryAllocationId===leg.inventoryAllocationId),fact=facts.get(leg.inventoryAllocationId);if(!selected||!fact||seen.has(leg.inventoryAllocationId)||leg.inventoryBalanceId!==fact.inventoryBalanceId||leg.expectedVersion!==selected.expectedVersion||leg.expectedBalanceVersion!==fact.balanceVersion||leg.baseQuantity!==selected.baseQuantity)unavailable();seen.add(leg.inventoryAllocationId);}
  for(const leg of member.allocations){const balance=balances.get(leg.inventoryBalanceId);if(balance&&leg.expectedBalanceVersion!==balance.balanceVersion)unavailable();}
 }
}
