import {fulfillmentError} from "./fulfillmentErrors.js";
import {fulfillmentInteger} from "./fulfillmentValidation.js";
import {assertClaimQuantities,assertFulfillmentQuantities} from "./fulfillmentQuantityMath.js";
import {reallocationAdvisoryQuery} from "./fulfillmentReallocationAdvisory.js";
import {assertPickOwnerShape,assertPickOwnerVersions,assertPickOwnerMatches} from "./fulfillmentPickingScope.js";
const invalid=()=>{throw fulfillmentError("FULFILLMENT_INPUT_INVALID");};
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const id=value=>Number.isSafeInteger(value)&&value>0;
const version=value=>id(value)&&value<=4294967295;
export function normalizeFulfillmentAllocationPreview(input){
 if(!exact(input,["version","selectedClaimId","page","selections","lineReasons"])||!version(input.version)||!id(input.selectedClaimId)||!id(input.page)||!Number.isSafeInteger(input.page*100)||!Array.isArray(input.selections)||input.selections.length>5000||!Array.isArray(input.lineReasons)||input.lineReasons.length>100)invalid();
 const claims=new Set(),lines=new Set();let count=0;
 const selections=input.selections.map(member=>{
  if(!exact(member,["claimId","allocations"])||!id(member.claimId)||claims.has(member.claimId)||!Array.isArray(member.allocations)||member.allocations.length>50)invalid();claims.add(member.claimId);const balances=new Set();
  const allocations=member.allocations.map(leg=>{
   if(!exact(leg,["inventoryBalanceId","expectedBalanceVersion","baseQuantity"])||!id(leg.inventoryBalanceId)||balances.has(leg.inventoryBalanceId)||!version(leg.expectedBalanceVersion)||typeof leg.baseQuantity!=="string"||!/^[1-9][0-9]{0,15}$/u.test(leg.baseQuantity)||BigInt(leg.baseQuantity)>BigInt(Number.MAX_SAFE_INTEGER)||++count>5000)invalid();balances.add(leg.inventoryBalanceId);
   return Object.freeze({inventoryBalanceId:leg.inventoryBalanceId,expectedBalanceVersion:leg.expectedBalanceVersion,baseQuantity:leg.baseQuantity});
  }).sort((a,b)=>a.inventoryBalanceId-b.inventoryBalanceId);
  return Object.freeze({claimId:member.claimId,allocations:Object.freeze(allocations)});
 }).sort((a,b)=>a.claimId-b.claimId);
 const lineReasons=input.lineReasons.map(line=>{
  if(!exact(line,["fulfillmentLineId","reason"])||!id(line.fulfillmentLineId)||lines.has(line.fulfillmentLineId)||typeof line.reason!=="string"||[...line.reason].length>500||/[\p{Cc}\p{Cf}]/u.test(line.reason))invalid();lines.add(line.fulfillmentLineId);
  return Object.freeze({fulfillmentLineId:line.fulfillmentLineId,reason:line.reason.trim()});
 }).sort((a,b)=>a.fulfillmentLineId-b.fulfillmentLineId);
 return Object.freeze({version:input.version,selectedClaimId:input.selectedClaimId,page:input.page,selections:Object.freeze(selections),lineReasons:Object.freeze(lineReasons)});
}

const sourceConflict=()=>{throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");};
const sourceQuantity=(value,positive=false)=>{try{return fulfillmentInteger(String(value),{positive});}catch{sourceConflict();}};
const freeze=value=>{if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export function fulfillmentAllocationPreviewScope(snapshot,request,asOf){
 const {header,lines,claims}=snapshot;
 if(!["DRAFT","PICKING"].includes(header.status))throw fulfillmentError("FULFILLMENT_STATE_CONFLICT");
 if(Number(header.version)!==request.version||Number(header.version)>=4294967295||lines.some(line=>Number(line.version)>=4294967295)||snapshot.historySequence>=4294967295)throw fulfillmentError("VERSION_CONFLICT");
 let base;
 if(header.status==="PICKING")base=reallocationAdvisoryQuery(snapshot,request,asOf);
 else{
  if(header.active_shipment_id!==null||["allocated_at","picked_at","shipped_at","reversed_at"].some(key=>header[key]!==null))throw fulfillmentError("FULFILLMENT_STATE_CONFLICT");
  if(!lines.length||lines.length>100||lines.length!==Number(header.line_count)||!claims.length||claims.length>5000)sourceConflict();
  const claimIds=new Set(),reservationIds=new Set();
  const selected=lines.map(line=>{
   if(String(line.fulfillment_id)!==String(header.id)||!version(Number(line.version)))sourceConflict();
   try{assertFulfillmentQuantities("DRAFT",[{planned:String(line.planned_base_quantity),allocated:String(line.allocated_base_quantity),released:"0",picked:String(line.picked_base_quantity),short:String(line.short_base_quantity),shipped:String(line.shipped_base_quantity),reversed:String(line.reversed_base_quantity)}]);}catch{sourceConflict();}
   const members=claims.filter(claim=>String(claim.fulfillment_line_id)===String(line.id));if(!members.length||members.length>50)sourceConflict();
   const reservations=members.map(claim=>{
    if(String(claim.fulfillment_id)!==String(header.id)||claim.status!=="ACTIVE"||claimIds.has(String(claim.id))||reservationIds.has(String(claim.inventory_reservation_id))||["released_quantity","consumed_quantity","reversed_quantity"].some(key=>sourceQuantity(claim[key])!==0n))sourceConflict();claimIds.add(String(claim.id));reservationIds.add(String(claim.inventory_reservation_id));
    try{assertClaimQuantities({original:String(claim.original_claimed_quantity),active:String(claim.active_claimed_quantity),released:String(claim.released_quantity),consumed:String(claim.consumed_quantity),reversed:String(claim.reversed_quantity)});}catch{sourceConflict();}
    return {claimId:sourceQuantity(claim.id,true).toString(),inventoryReservationId:sourceQuantity(claim.inventory_reservation_id,true).toString(),baseQuantity:sourceQuantity(claim.active_claimed_quantity,true).toString()};
   }).sort((a,b)=>Number(a.inventoryReservationId)-Number(b.inventoryReservationId));
   if(reservations.reduce((sum,member)=>sum+BigInt(member.baseQuantity),0n)!==sourceQuantity(line.planned_base_quantity,true))sourceConflict();
   return {fulfillmentLineId:sourceQuantity(line.id,true).toString(),salesOrderLineId:sourceQuantity(line.sales_order_line_id,true).toString(),skuId:sourceQuantity(line.sku_id,true).toString(),baseQuantity:String(line.planned_base_quantity),reservations};
  }).sort((a,b)=>Number(a.fulfillmentLineId)-Number(b.fulfillmentLineId));
  if(claimIds.size!==claims.length)sourceConflict();
  base={fulfillmentId:sourceQuantity(header.id,true).toString(),salesOrderId:sourceQuantity(header.sales_order_id,true).toString(),warehouseId:sourceQuantity(header.warehouse_id,true).toString(),lines:selected,page:request.page,asOf};
 }
 const claimIds=new Set(base.lines.flatMap(line=>line.reservations.map(member=>member.claimId))),lineIds=new Set(base.lines.map(line=>line.fulfillmentLineId));
 if(!claimIds.has(String(request.selectedClaimId))||request.selections.some(member=>!claimIds.has(String(member.claimId)))||request.lineReasons.some(line=>!lineIds.has(String(line.fulfillmentLineId))))invalid();
 return freeze({...base,version:request.version,purpose:header.status==="DRAFT"?"ALLOCATE":"REALLOCATE",selectedClaimId:String(request.selectedClaimId),selections:request.selections.map(member=>({claimId:String(member.claimId),allocations:member.allocations.map(leg=>({...leg,inventoryBalanceId:String(leg.inventoryBalanceId)}))})),lineReasons:request.lineReasons.map(line=>({fulfillmentLineId:String(line.fulfillmentLineId),reason:line.reason}))});
}

// Validate source identity and the private owner proof before exposing its bounded DTO.
// Eligibility and sequence classification remain exclusively Inventory decisions.
export function assertFulfillmentAllocationPreviewResult(result,snapshot,query,source,actor){
 const fail=()=>{throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");},fields=(value,keys)=>{if(!exact(value,keys))fail();},array=(value,max)=>{if(!Array.isArray(value)||value.length>max)fail();},quantity=(value,positive=false)=>{try{return fulfillmentInteger(value,{positive});}catch{fail();}},uint=value=>{if(!version(value))fail();},date=value=>{if(value!==null&&(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/u.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))fail();};
 fields(result,["projection","reservationFacts","allocationScope","balanceFacts"]);array(result.reservationFacts,5000);array(result.balanceFacts,Number.MAX_SAFE_INTEGER);
 const facts=new Map(),expected=new Map(query.lines.flatMap(line=>line.reservations.map(member=>[member.inventoryReservationId,{line,member}]))),sales=new Map(source.lines.flatMap(line=>line.reservations.map(member=>[member.claimId,{...member,salesOrderLineId:line.salesOrderLineId}])));
 if(source.orderId!==query.salesOrderId||result.reservationFacts.length!==expected.size||sales.size!==expected.size)fail();
 const claimsById=new Map();for(const row of snapshot.claims)if(!claimsById.has(String(row.id)))claimsById.set(String(row.id),row);
 for(const fact of result.reservationFacts){
  fields(fact,["inventoryReservationId","warehouseId","skuId","salesOrderId","salesOrderLineId","originalInventoryOperationId","originalSourceEventId","originalQuantity","consumedQuantity","releasedQuantity","outstandingQuantity","version","minimumRemainingDays"]);
  const target=expected.get(fact.inventoryReservationId),anchor=target&&sales.get(target.member.claimId),claim=target&&claimsById.get(target.member.claimId);
  if(!target||!anchor||!claim||facts.has(fact.inventoryReservationId)||fact.warehouseId!==query.warehouseId||fact.skuId!==target.line.skuId||fact.salesOrderId!==query.salesOrderId||fact.salesOrderLineId!==target.line.salesOrderLineId||anchor.salesOrderLineId!==target.line.salesOrderLineId||anchor.inventoryReservationId!==fact.inventoryReservationId||anchor.salesReservationMappingId!==String(claim.sales_order_line_reservation_id)||fact.originalSourceEventId!==anchor.sourceEventId||fact.originalQuantity!==anchor.originalBaseQuantity)fail();
  quantity(fact.originalInventoryOperationId,true);uint(fact.version);if(!Number.isInteger(fact.minimumRemainingDays)||fact.minimumRemainingDays<0||fact.minimumRemainingDays>36500)fail();
  const original=quantity(fact.originalQuantity),consumed=quantity(fact.consumedQuantity),released=quantity(fact.releasedQuantity),outstanding=quantity(fact.outstandingQuantity);if(original!==consumed+released+outstanding)fail();facts.set(fact.inventoryReservationId,fact);
 }
 const credits=new Map(),balanceVersions=new Map();
 if(query.purpose==="REALLOCATE"){
  assertPickOwnerShape(result.allocationScope,{fulfillmentId:query.fulfillmentId,inventoryAllocationIds:snapshot.allocations.map(row=>String(row.inventory_allocation_id))});assertPickOwnerVersions(snapshot,result.allocationScope);assertPickOwnerMatches(snapshot,result.allocationScope);
  for(const fact of result.allocationScope.reservationFacts){const current=facts.get(fact.inventoryReservationId);if(!current||Object.keys(fact).some(key=>fact[key]!==current[key]))fail();}
  for(const fact of result.allocationScope.allocations){credits.set(fact.inventoryBalanceId,(credits.get(fact.inventoryBalanceId)??0n)+quantity(fact.outstandingQuantity,true));balanceVersions.set(fact.inventoryBalanceId,fact.balanceVersion);}
 }else if(result.allocationScope!==null)fail();
 const balances=new Map();
 for(const fact of result.balanceFacts){
  fields(fact,["inventoryBalanceId","warehouseId","skuId","binId","binCode","lotId","expiryDate","firstReceiptDate","fifoAnchorDate","version","physicalFreeQuantity","ownReleaseCredit","availableAfterOwnRelease"]);
  for(const key of ["inventoryBalanceId","skuId","binId"])quantity(fact[key],true);if(fact.lotId!==null)quantity(fact.lotId,true);for(const key of ["expiryDate","firstReceiptDate","fifoAnchorDate"])date(fact[key]);uint(fact.version);
  if(balances.has(fact.inventoryBalanceId)||fact.warehouseId!==query.warehouseId||typeof fact.binCode!=="string"||!fact.binCode||fact.lotId===null&&(fact.expiryDate!==null||fact.firstReceiptDate!==null)||fact.lotId!==null&&fact.firstReceiptDate===null||balanceVersions.has(fact.inventoryBalanceId)&&balanceVersions.get(fact.inventoryBalanceId)!==fact.version)fail();
  const physical=quantity(fact.physicalFreeQuantity),credit=quantity(fact.ownReleaseCredit),available=quantity(fact.availableAfterOwnRelease,true);if(credit!==(credits.get(fact.inventoryBalanceId)??0n)||available!==physical+credit)fail();balances.set(fact.inventoryBalanceId,fact);
 }
 const projection=result.projection;fields(projection,["fulfillmentId","version","purpose","warehouseId","asOf","selectedClaim","assessments","canSubmit"]);
 for(const key of ["fulfillmentId","version","purpose","warehouseId"])if(projection[key]!==query[key])fail();if(!Number.isSafeInteger(projection.asOf)||projection.asOf<0)fail();
 const selected=projection.selectedClaim;fields(selected,["fulfillmentLineId","claimId","inventoryReservationId","skuId","expectedReservationVersion","requestedQuantity","minimumRemainingDays","baseUom","page","hasMore","prefixStatus","options"]);
 const selections=new Map(query.selections.map(member=>[member.claimId,member.allocations])),used=new Map(),occurrences=new Map(),releaseCounts=new Map(),lineReady=new Map();let prefixReady=true,selectedPrefixReady=false,selectedUsed;
 for(const allocation of result.allocationScope?.allocations??[])releaseCounts.set(allocation.inventoryBalanceId,(releaseCounts.get(allocation.inventoryBalanceId)??0)+1);
 for(const sourceLine of query.lines){
  let ready=true,legsCount=0;
  for(const member of sourceLine.reservations){
   if(member.claimId===query.selectedClaimId){selectedPrefixReady=prefixReady;selectedUsed=new Map(used);}
   const legs=selections.get(member.claimId)??[];legsCount+=legs.length;
   let complete=prefixReady&&legs.length>0&&legsCount<=50&&legs.reduce((sum,leg)=>sum+quantity(leg.baseQuantity,true),0n)===quantity(member.baseQuantity,true)&&facts.get(member.inventoryReservationId).version<4294967295;
   for(const leg of legs){const balance=balances.get(leg.inventoryBalanceId);if(!balance||balance.skuId!==sourceLine.skuId||balance.version!==leg.expectedBalanceVersion||balance.version+(releaseCounts.get(leg.inventoryBalanceId)??0)+(occurrences.get(leg.inventoryBalanceId)??0)+1>4294967295||quantity(leg.baseQuantity,true)+(used.get(leg.inventoryBalanceId)??0n)>quantity(balance.availableAfterOwnRelease,true))complete=false;}
   if(complete)for(const leg of legs){used.set(leg.inventoryBalanceId,(used.get(leg.inventoryBalanceId)??0n)+quantity(leg.baseQuantity,true));occurrences.set(leg.inventoryBalanceId,(occurrences.get(leg.inventoryBalanceId)??0)+1);}
   else{ready=false;prefixReady=false;}
  }
  lineReady.set(sourceLine.fulfillmentLineId,ready);
 }
 const target=[...expected.values()].find(row=>row.member.claimId===query.selectedClaimId),fact=facts.get(target.member.inventoryReservationId),line=snapshot.lines.find(row=>String(row.id)===target.line.fulfillmentLineId);
 for(const [key,value]of Object.entries({fulfillmentLineId:target.line.fulfillmentLineId,claimId:target.member.claimId,inventoryReservationId:target.member.inventoryReservationId,skuId:target.line.skuId,requestedQuantity:target.member.baseQuantity,expectedReservationVersion:fact.version,minimumRemainingDays:fact.minimumRemainingDays,page:query.page}))if(selected[key]!==value)fail();
 fields(selected.baseUom,["uomId","uomCode","version"]);if(selected.baseUom.uomId!==String(line.base_uom_id)||typeof selected.baseUom.uomCode!=="string"||!selected.baseUom.uomCode)fail();uint(selected.baseUom.version);
 if(!["READY","INCOMPLETE","INVALID"].includes(selected.prefixStatus)||typeof selected.hasMore!=="boolean"||selected.prefixStatus==="READY"&&!selectedPrefixReady)fail();array(selected.options,100);if(selected.hasMore&&selected.options.length!==100||selected.prefixStatus!=="READY"&&(selected.options.length||selected.hasMore))fail();
 const seen=new Set();
 for(const [index,option]of selected.options.entries()){
  fields(option,["inventoryBalanceId","binId","binCode","lotId","lotNumber","expiryDate","remainingDays","firstReceiptDate","fifoAnchorDate","physicalFreeQuantity","ownReleaseCredit","priorSelectedQuantity","availableQuantity","expectedBalanceVersion","selectionStrategy","rank","eligible"]);
  if(option.lotId===null?option.lotNumber!==null:typeof option.lotNumber!=="string"||!option.lotNumber||[...option.lotNumber].length>100||/[\p{Cc}\p{Cf}]/u.test(option.lotNumber))fail();if(option.expiryDate===null?option.remainingDays!==null:!Number.isSafeInteger(option.remainingDays)||option.remainingDays<0)fail();
  const balance=balances.get(option.inventoryBalanceId);if(!balance||seen.has(option.inventoryBalanceId)||balance.skuId!==target.line.skuId||option.expectedBalanceVersion!==balance.version||option.rank!==(query.page-1)*100+index+1||option.eligible!==true||option.selectionStrategy!==(option.expiryDate?"FEFO":"FIFO"))fail();seen.add(option.inventoryBalanceId);
  for(const key of ["binId","binCode","lotId","expiryDate","firstReceiptDate","fifoAnchorDate","physicalFreeQuantity","ownReleaseCredit"])if(option[key]!==balance[key])fail();
  if(quantity(option.availableQuantity,true)+quantity(option.priorSelectedQuantity)!==quantity(balance.availableAfterOwnRelease,true)||quantity(option.priorSelectedQuantity)!==(selectedUsed.get(option.inventoryBalanceId)??0n))fail();
 }
 array(projection.assessments,100);if(projection.assessments.length!==query.lines.length)fail();
 for(const [index,assessment]of projection.assessments.entries()){
  fields(assessment,["fulfillmentLineId","selectionStatus","overrideType","reasonRequired","reasonStatus","fefoPermission","issues","canSubmit"]);if(assessment.fulfillmentLineId!==query.lines[index].fulfillmentLineId||!["READY","INCOMPLETE","INVALID"].includes(assessment.selectionStatus)||!["UNKNOWN","NONE","FIFO","FEFO"].includes(assessment.overrideType)||typeof assessment.canSubmit!=="boolean")fail();
  array(assessment.issues,100);for(const issue of assessment.issues){fields(issue,["code","claimId","inventoryBalanceId"]);if(!["FULFILLMENT_INPUT_INVALID","VERSION_CONFLICT","ALLOCATION_INSUFFICIENT","FEFO_OVERRIDE_REQUIRED","PICK_SEQUENCE_REASON_REQUIRED","INVENTORY_INPUT_INVALID","FEFO_OVERRIDE_DENIED"].includes(issue.code)||issue.claimId!==null&&!query.lines[index].reservations.some(member=>member.claimId===issue.claimId))fail();if(issue.inventoryBalanceId!==null)quantity(issue.inventoryBalanceId,true);}
  const unknown=assessment.overrideType==="UNKNOWN",required=unknown?null:assessment.overrideType!=="NONE",text=query.lineReasons.find(row=>row.fulfillmentLineId===assessment.fulfillmentLineId)?.reason??"",reasonStatus=unknown?"UNKNOWN":required?([...text].length>=5?"VALID":"REQUIRED"):text?"UNUSED":"NOT_REQUIRED",permission=unknown?"UNKNOWN":assessment.overrideType==="FEFO"?(actor.permissions.includes("inventory.fefo.override")?"GRANTED":"DENIED"):"NOT_REQUIRED";
  if(assessment.reasonRequired!==required||assessment.reasonStatus!==reasonStatus||assessment.fefoPermission!==permission||assessment.canSubmit!==(!unknown&&assessment.selectionStatus==="READY"&&assessment.issues.length===0)||assessment.canSubmit&&(!lineReady.get(assessment.fulfillmentLineId)||reasonStatus==="REQUIRED"||reasonStatus==="UNUSED"||permission==="DENIED"))fail();
 }
 if(projection.canSubmit!==projection.assessments.every(row=>row.canSubmit))fail();return projection;
}
