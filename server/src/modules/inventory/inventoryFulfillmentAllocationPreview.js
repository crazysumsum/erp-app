import {fulfillmentInventoryFields as fields,fulfillmentInventoryId as identifier,fulfillmentInventoryVersion as version} from "./inventoryFulfillmentValidation.js";
import {normalizeReallocationAdvisoryQuery,lockReallocationAdvisoryScope} from "./inventoryFulfillmentReallocationAdvisory.js";
import {loadInventoryCandidates,loadFulfillmentReallocationCandidates} from "./InventoryPickSequenceService.js";
import {virtualPages} from "./inventoryFulfillmentAllocationPreparation.js";
import {assessFulfillmentAllocationSelection} from "./inventoryFulfillmentAllocation.js";
import {inventoryError} from "./inventoryErrors.js";
import {inventoryRemainingLifeDays} from "./inventoryValidation.js";
const fail=(code="INVENTORY_INPUT_INVALID")=>{throw inventoryError(code);};
const freeze=value=>{if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const compare=(a,b)=>Number(a)-Number(b);
const reason=value=>{if(typeof value!=="string"||[...value].length>500||/[\p{Cc}\p{Cf}]/u.test(value))fail();return value.trim();};
export function normalizeInventoryAllocationPreview(input){
 fields(input,["fulfillmentId","salesOrderId","warehouseId","version","purpose","asOf","page","selectedClaimId","lines","selections","lineReasons"]);
 if(!["ALLOCATE","REALLOCATE"].includes(input.purpose)||!Number.isSafeInteger(input.page)||input.page<1||!Number.isSafeInteger(input.page*100)||!Number.isSafeInteger(input.asOf)||input.asOf<0||!Array.isArray(input.lines)||!input.lines.length||input.lines.length>100)fail();
 const source={fulfillmentId:identifier(input.fulfillmentId),salesOrderId:identifier(input.salesOrderId),warehouseId:identifier(input.warehouseId),asOf:input.asOf,page:input.page},claims=new Set(),reservations=new Set(),lineIds=new Set(),salesLines=new Set();
 let lines;
 if(input.purpose==="REALLOCATE")lines=normalizeReallocationAdvisoryQuery({...source,lines:input.lines}).lines;
 else lines=input.lines.map(line=>{
  fields(line,["fulfillmentLineId","salesOrderLineId","skuId","baseQuantity","reservations"]);
  const result=Object.fromEntries(["fulfillmentLineId","salesOrderLineId","skuId","baseQuantity"].map(key=>[key,identifier(line[key])]));
  if(!Array.isArray(line.reservations)||!line.reservations.length||line.reservations.length>50)fail();
  const members=line.reservations.map(member=>{fields(member,["claimId","inventoryReservationId","baseQuantity"]);return Object.fromEntries(["claimId","inventoryReservationId","baseQuantity"].map(key=>[key,identifier(member[key])]));}).sort((a,b)=>compare(a.inventoryReservationId,b.inventoryReservationId));
  if(members.reduce((sum,member)=>sum+BigInt(member.baseQuantity),0n)!==BigInt(result.baseQuantity))fail();return {...result,reservations:members};
 }).sort((a,b)=>compare(a.fulfillmentLineId,b.fulfillmentLineId));
 for(const line of lines){if(lineIds.has(line.fulfillmentLineId)||salesLines.has(line.salesOrderLineId))fail();lineIds.add(line.fulfillmentLineId);salesLines.add(line.salesOrderLineId);for(const member of line.reservations){if(claims.has(member.claimId)||reservations.has(member.inventoryReservationId))fail();claims.add(member.claimId);reservations.add(member.inventoryReservationId);}}
 if(claims.size>5000||!Array.isArray(input.selections)||input.selections.length>5000||!Array.isArray(input.lineReasons)||input.lineReasons.length>100)fail();
 const selectedClaimId=identifier(input.selectedClaimId);if(!claims.has(selectedClaimId))fail();const selected=new Set(),reasonLines=new Set();let legCount=0;
 const selections=input.selections.map(member=>{
  fields(member,["claimId","allocations"]);const claimId=identifier(member.claimId);if(!claims.has(claimId)||selected.has(claimId)||!Array.isArray(member.allocations)||member.allocations.length>50)fail();selected.add(claimId);const balances=new Set();
  const allocations=member.allocations.map(leg=>{fields(leg,["inventoryBalanceId","expectedBalanceVersion","baseQuantity"]);const inventoryBalanceId=identifier(leg.inventoryBalanceId);if(balances.has(inventoryBalanceId)||++legCount>5000)fail();balances.add(inventoryBalanceId);return {inventoryBalanceId,expectedBalanceVersion:version(leg.expectedBalanceVersion),baseQuantity:identifier(leg.baseQuantity)};}).sort((a,b)=>compare(a.inventoryBalanceId,b.inventoryBalanceId));return {claimId,allocations};
 }).sort((a,b)=>compare(a.claimId,b.claimId));
 const lineReasons=input.lineReasons.map(line=>{fields(line,["fulfillmentLineId","reason"]);const fulfillmentLineId=identifier(line.fulfillmentLineId);if(!lineIds.has(fulfillmentLineId)||reasonLines.has(fulfillmentLineId))fail();reasonLines.add(fulfillmentLineId);return {fulfillmentLineId,reason:reason(line.reason)};}).sort((a,b)=>compare(a.fulfillmentLineId,b.fulfillmentLineId));
 return freeze({...source,version:version(input.version),purpose:input.purpose,lines,selectedClaimId,selections,lineReasons});
}

// Only the owner supplies eligibility, current source proofs and physical rows.
export async function assessFulfillmentAllocationPreview(tx,query,context){
 const {time,actor,byProfile,reservations,credits,releaseCounts}=context,asOf=context.asOf??time.nowMs(),currentDate=context.currentDate??time.fileDate(asOf),used=new Map(),occurrences=new Map(),cache=new Map(),physical=context.balanceFacts??new Map();
 const load=context.loadCandidates??loadInventoryCandidates;
 const read=virtualPages(used,cache,async(executor,args)=>{
  const rows=await load(executor,args);
  return rows.map(row=>{
   const id=String(row.id),credit=Number(credits.get(id)??0n),base=row.freeQuantity,free=base-credit;
   if(!Number.isSafeInteger(base)||base<=0||!Number.isSafeInteger(free)||free<0||!Number.isSafeInteger(credit)||credit<0||!Number.isSafeInteger(row.version)||row.version<1||row.version>4294967295||row.physicalFreeQuantity!==undefined&&row.physicalFreeQuantity!==free||row.ownReleaseCredit!==undefined&&row.ownReleaseCredit!==credit)fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
   const previous=physical.get(id);if(previous&&(previous.version!==row.version||previous.base!==base||previous.skuId!==String(args.skuId)))fail("INVENTORY_DEPENDENCY_UNAVAILABLE");physical.set(id,{inventoryBalanceId:id,warehouseId:String(args.warehouseId),skuId:String(args.skuId),binId:String(row.binId),binCode:row.binCode,lotId:row.lotId===null?null:String(row.lotId),expiryDate:row.expiryDate,firstReceiptDate:row.firstReceiptDate,fifoAnchorDate:row.fifoAnchorDate,version:row.version,base,physicalFreeQuantity:String(free),ownReleaseCredit:String(credit),availableAfterOwnRelease:String(base)});
   return {...row,physicalFreeQuantity:free,ownReleaseCredit:credit,availableAfterOwnRelease:base};
  });
 });
 const choices=new Map(query.selections.map(member=>[member.claimId,member.allocations])),reasons=new Map(query.lineReasons.map(line=>[line.fulfillmentLineId,line.reason])),assessments=[];let prefix="READY",selectedClaim;
 for(const line of [...query.lines].sort((a,b)=>compare(a.fulfillmentLineId,b.fulfillmentLineId))){
  let lineStatus="READY",known=true,fefo=false,fifo=false,lineLegs=0;const issues=[];
  for(const member of [...line.reservations].sort((a,b)=>compare(a.inventoryReservationId,b.inventoryReservationId))){
   const reservation=reservations.get(member.inventoryReservationId),profile=byProfile.get(line.skuId),legs=choices.get(member.claimId)??[];
   if(!reservation||!profile||!["none","batch","batch_expiry"].includes(profile.trackingPolicy)||Number(reservation.warehouse_id)!==Number(query.warehouseId)||Number(reservation.sku_id)!==Number(line.skuId)||!Number.isSafeInteger(Number(reservation.version))||Number(reservation.version)<1||Number(reservation.version)>4294967295||!Number.isInteger(Number(reservation.minimum_remaining_days))||Number(reservation.minimum_remaining_days)<0||Number(reservation.minimum_remaining_days)>36500||!profile.baseUom||typeof profile.baseUom.uomCode!=="string"||!profile.baseUom.uomCode)fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
   try{identifier(profile.baseUom.uomId);version(profile.baseUom.version);}catch{fail("INVENTORY_DEPENDENCY_UNAVAILABLE");}
   const args={warehouseId:Number(query.warehouseId),skuId:Number(line.skuId),currentDate,minimumRemainingDays:Number(reservation.minimum_remaining_days),trackingPolicy:profile.trackingPolicy};
   if(member.claimId===query.selectedClaimId){
    const offset=(query.page-1)*100,rows=prefix==="READY"?await read(tx,{...args,offset,limit:101}):[];
    selectedClaim={fulfillmentLineId:line.fulfillmentLineId,claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,skuId:line.skuId,expectedReservationVersion:Number(reservation.version),requestedQuantity:member.baseQuantity,minimumRemainingDays:args.minimumRemainingDays,baseUom:{uomId:profile.baseUom.uomId,uomCode:profile.baseUom.uomCode,version:profile.baseUom.version},page:query.page,hasMore:rows.length>100,prefixStatus:prefix,options:rows.slice(0,100).map((row,index)=>({inventoryBalanceId:String(row.id),binId:String(row.binId),binCode:row.binCode,lotId:row.lotId===null?null:String(row.lotId),expiryDate:row.expiryDate,firstReceiptDate:row.firstReceiptDate,fifoAnchorDate:row.fifoAnchorDate,physicalFreeQuantity:String(row.physicalFreeQuantity),ownReleaseCredit:String(row.ownReleaseCredit),priorSelectedQuantity:String(used.get(String(row.id))??0),availableQuantity:String(row.freeQuantity),expectedBalanceVersion:row.version,selectionStrategy:row.expiryDate?"FEFO":"FIFO",rank:offset+index+1,eligible:true}))};
   }
   const issue=(code,balanceId=null)=>issues.push({code,claimId:member.claimId,inventoryBalanceId:balanceId});
   if(prefix!=="READY"){known=false;lineStatus=prefix;issue("FULFILLMENT_INPUT_INVALID");continue;}
   const total=legs.reduce((sum,leg)=>sum+BigInt(leg.baseQuantity),0n),requested=BigInt(member.baseQuantity);let state="READY";
   if(total!==requested){state=total<requested?"INCOMPLETE":"INVALID";issue("FULFILLMENT_INPUT_INVALID");}
   else if(lineLegs+legs.length>50){state="INVALID";issue("FULFILLMENT_INPUT_INVALID");}
   else if(Number(reservation.version)>=4294967295){state="INVALID";issue("VERSION_CONFLICT");}
   let recommendation;
   if(state==="READY"){
    try{recommendation=await assessFulfillmentAllocationSelection(tx,{time:{fileDate:()=>currentDate}},{reservation,input:{baseQuantity:member.baseQuantity},legs:legs.map(input=>({kind:"ALLOCATE",input}))},profile,read);}
    catch(error){if(error.code!=="ALLOCATION_INSUFFICIENT")throw error;state="INVALID";issue("ALLOCATION_INSUFFICIENT");}
   }
   if(recommendation)for(const leg of legs){const candidate=recommendation.selected.get(leg.inventoryBalanceId)?.candidate;
    if(!candidate||BigInt(leg.baseQuantity)>BigInt(candidate.freeQuantity)){state="INVALID";issue("ALLOCATION_INSUFFICIENT",leg.inventoryBalanceId);}
    else if(candidate.version!==leg.expectedBalanceVersion||candidate.version+(releaseCounts.get(leg.inventoryBalanceId)??0)+(occurrences.get(leg.inventoryBalanceId)??0)+1>4294967295){state="INVALID";issue("VERSION_CONFLICT",leg.inventoryBalanceId);}
   }
   if(state!=="READY"){prefix=state;lineStatus=state;known=false;continue;}
   // Commit a member's virtual budget only after its complete selection validates.
   for(const leg of legs){used.set(leg.inventoryBalanceId,(used.get(leg.inventoryBalanceId)??0)+Number(leg.baseQuantity));occurrences.set(leg.inventoryBalanceId,(occurrences.get(leg.inventoryBalanceId)??0)+1);}lineLegs+=legs.length;
   if(recommendation.differs){if(recommendation.fefo)fefo=true;else fifo=true;}
  }
  const overrideType=!known?"UNKNOWN":fefo?"FEFO":fifo?"FIFO":"NONE",text=reasons.get(line.fulfillmentLineId)??"",required=known?overrideType!=="NONE":null;
  const reasonStatus=!known?"UNKNOWN":required?([...text].length>=5?"VALID":"REQUIRED"):text?"UNUSED":"NOT_REQUIRED",fefoPermission=!known?"UNKNOWN":fefo?(actor.permissions.includes("inventory.fefo.override")?"GRANTED":"DENIED"):"NOT_REQUIRED";
  if(reasonStatus==="REQUIRED")issues.push({code:fefo?"FEFO_OVERRIDE_REQUIRED":"PICK_SEQUENCE_REASON_REQUIRED",claimId:null,inventoryBalanceId:null});if(reasonStatus==="UNUSED")issues.push({code:"INVENTORY_INPUT_INVALID",claimId:null,inventoryBalanceId:null});if(fefoPermission==="DENIED")issues.push({code:"FEFO_OVERRIDE_DENIED",claimId:null,inventoryBalanceId:null});
  assessments.push({fulfillmentLineId:line.fulfillmentLineId,selectionStatus:lineStatus,overrideType,reasonRequired:required,reasonStatus,fefoPermission,issues,canSubmit:known&&lineStatus==="READY"&&issues.length===0});
 }
 if(!selectedClaim)fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
 return freeze({fulfillmentId:query.fulfillmentId,version:query.version,purpose:query.purpose,warehouseId:query.warehouseId,asOf,selectedClaim,assessments,canSubmit:assessments.every(line=>line.canSubmit)});
}

export async function readFulfillmentAllocationPreview(tx,query,{inventory,time,actor,readReservations}){
 const asOf=time.nowMs(),currentDate=time.fileDate(asOf),skuIds=[...new Set(query.lines.map(line=>line.skuId))];let context,allocationScope=null,nativeFacts;
 if(query.purpose==="REALLOCATE"){
  const source=Object.fromEntries(["fulfillmentId","salesOrderId","warehouseId","lines","page","asOf"].map(key=>[key,query[key]])),locked=await lockReallocationAdvisoryScope(tx,source,{inventory,time});allocationScope=locked.scope;nativeFacts=allocationScope.reservationFacts;
  const reservations=new Map(nativeFacts.map(fact=>[fact.inventoryReservationId,{...locked.reservations.get(fact.inventoryReservationId),warehouse_id:Number(fact.warehouseId),sku_id:Number(fact.skuId)}]));
  context={...locked,reservations,loadCandidates:(executor,args)=>loadFulfillmentReallocationCandidates(executor,args,locked.bySku.get(String(args.skuId))??new Map())};
 }else{
  nativeFacts=await readReservations({warehouseId:query.warehouseId,salesOrderId:query.salesOrderId,members:query.lines.flatMap(line=>line.reservations.map(member=>({inventoryReservationId:member.inventoryReservationId,salesOrderLineId:line.salesOrderLineId,skuId:line.skuId})))});
  const profiles=await inventory.itemLookup.getFulfillmentInventoryProfilesInTransaction(tx,skuIds,{atMs:time.nowMs()}),byProfile=new Map(profiles.map(profile=>[profile.skuId,profile]));
  if(profiles.length!==skuIds.length||byProfile.size!==skuIds.length||skuIds.some(id=>!byProfile.has(id))||profiles.some(profile=>!profile.usable||!profile.inventoryTracked))fail("INVENTORY_RESOURCE_NOT_FOUND");if(profiles.some(profile=>profile.trackingPolicy==="serial"))fail("SERIAL_TRACKING_UNSUPPORTED");
  context={byProfile,credits:new Map(),releaseCounts:new Map(),reservations:new Map(nativeFacts.map(fact=>[fact.inventoryReservationId,{id:fact.inventoryReservationId,warehouse_id:Number(fact.warehouseId),sku_id:Number(fact.skuId),version:fact.version,minimum_remaining_days:fact.minimumRemainingDays}]))};
 }
 const facts=new Map(nativeFacts.map(fact=>[fact.inventoryReservationId,fact]));
 if(facts.size!==query.lines.reduce((sum,line)=>sum+line.reservations.length,0))fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
 for(const line of query.lines)for(const member of line.reservations){const fact=facts.get(member.inventoryReservationId);if(!fact||fact.warehouseId!==query.warehouseId||fact.skuId!==line.skuId||fact.salesOrderId!==query.salesOrderId||fact.salesOrderLineId!==line.salesOrderLineId)fail("INVENTORY_SOURCE_CONFLICT");if(BigInt(fact.outstandingQuantity)<BigInt(member.baseQuantity))fail("RESERVATION_STATE_CONFLICT");}
 const balanceFacts=new Map(),assessed=await assessFulfillmentAllocationPreview(tx,query,{...context,inventory,time,actor,balanceFacts,asOf,currentDate}),options=await labelFulfillmentPreviewOptions(tx,assessed.selectedClaim,currentDate),projection={...assessed,selectedClaim:{...assessed.selectedClaim,options}};
 const reservationFacts=nativeFacts.map(fact=>({...Object.fromEntries(["inventoryReservationId","warehouseId","skuId","salesOrderId","salesOrderLineId","originalInventoryOperationId","originalSourceEventId","originalQuantity","consumedQuantity","releasedQuantity","outstandingQuantity","version"].map(key=>[key,fact[key]])),minimumRemainingDays:Number(context.reservations.get(fact.inventoryReservationId).minimum_remaining_days)}));
 return freeze({projection,reservationFacts,allocationScope,balanceFacts:[...balanceFacts.values()].map(({base:_base,...fact})=>fact)});
}

export async function labelFulfillmentPreviewOptions(tx,selected,currentDate){
 const ids=[...new Set(selected.options.filter(option=>option.lotId!==null).map(option=>option.lotId))];if(ids.length>100)fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
 const [rows]=ids.length?await tx.query(`SELECT id,sku_id,lot_number,DATE_FORMAT(expiry_date,'%Y-%m-%d') AS expiry_date FROM inventory_lots WHERE id IN (${ids.map(()=>"?").join(",")}) ORDER BY id`,ids):[[]],lots=new Map(rows.map(row=>[String(row.id),row]));
 if(rows.length!==ids.length||lots.size!==ids.length||[...lots.keys()].some(id=>!ids.includes(id)))fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
 return selected.options.map(option=>{
  const lot=option.lotId===null?null:lots.get(option.lotId);if(lot&&(String(lot.sku_id)!==selected.skuId||lot.expiry_date!==option.expiryDate||typeof lot.lot_number!=="string"||!lot.lot_number||[...lot.lot_number].length>100||/[\p{Cc}\p{Cf}]/u.test(lot.lot_number))||option.lotId!==null&&!lot)fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
  let remainingDays=null;try{if(option.expiryDate!==null)remainingDays=inventoryRemainingLifeDays(option.expiryDate,currentDate);}catch{fail("INVENTORY_DEPENDENCY_UNAVAILABLE");}
  if(option.lotId===null&&option.expiryDate!==null||remainingDays!==null&&(!Number.isSafeInteger(remainingDays)||remainingDays<0))fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
  return {...option,lotNumber:lot?.lot_number??null,remainingDays};
 });
}
