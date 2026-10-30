const fail=()=>{throw new Error("分配資料不完整或已變更，請核對所有行、Reservation及庫位數量後重新載入");};
const integer=value=>Number.isSafeInteger(value)&&value>0;
const version=value=>integer(value)&&value<=4294967295;
const quantity=value=>{if(typeof value!=="string"||!/^(0|[1-9][0-9]{0,15})$/u.test(value)||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER))fail();return BigInt(value);};
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const reason=value=>{if(typeof value!=="string"||/[\p{Cc}\p{Cf}]/u.test(value)||[...value].length>500)fail();const text=value.trim();if(text!==""&&[...text].length<5)fail();return text;};

export function recommendedPreviewSelections(result){
 return Object.fromEntries(result.demands.map(demand=>[demand.claimId,demand.candidates.filter(candidate=>quantity(candidate.recommendedQuantity)>0n).map(candidate=>({inventoryBalanceId:Number(candidate.inventoryBalanceId),expectedBalanceVersion:candidate.expectedBalanceVersion,baseQuantity:candidate.recommendedQuantity}))]));
}
export function buildAllocationPreviewRequest(scope,selections,reasons,selectedClaimId,page=1){
 const {document,candidateResult}=scope,claims=new Set(candidateResult.demands.map(member=>member.claimId)),lines=new Set(document.lines.map(line=>line.id));
 if(candidateResult.fulfillmentId!==document.id||candidateResult.version!==document.version||!claims.has(String(selectedClaimId))||!integer(page)||!Number.isSafeInteger(page*100)||Object.keys(selections).some(key=>!claims.has(key))||Object.keys(reasons).some(key=>!lines.has(key)))fail();let count=0;
 const members=Object.entries(selections).map(([claimId,legs])=>{
  if(!Array.isArray(legs)||legs.length>50)fail();const seen=new Set();
  const allocations=legs.filter(leg=>leg.baseQuantity!==""&&quantity(leg.baseQuantity)>0n).map(leg=>{if(!exact(leg,["inventoryBalanceId","expectedBalanceVersion","baseQuantity"])||!integer(leg.inventoryBalanceId)||!version(leg.expectedBalanceVersion)||seen.has(leg.inventoryBalanceId)||++count>5000)fail();seen.add(leg.inventoryBalanceId);return {...leg};}).sort((a,b)=>a.inventoryBalanceId-b.inventoryBalanceId);
  return {claimId:Number(claimId),allocations};
 }).sort((a,b)=>a.claimId-b.claimId);
 const lineReasons=Object.entries(reasons).map(([fulfillmentLineId,text])=>{if(typeof text!=="string"||[...text].length>500||/[\p{Cc}\p{Cf}]/u.test(text))fail();return {fulfillmentLineId:Number(fulfillmentLineId),reason:text.trim()};}).sort((a,b)=>a.fulfillmentLineId-b.fulfillmentLineId);
 return {version:document.version,selectedClaimId:Number(selectedClaimId),page,selections:members,lineReasons};
}
export function buildAssessedAllocationIntent(scope,request,preview,eventId){
 const {document,candidateResult,action}=scope,reallocate=action==="reallocate";
 if(preview?.canSubmit!==true||preview.fulfillmentId!==document.id||preview.version!==document.version||preview.purpose!==(reallocate?"REALLOCATE":"ALLOCATE")||request.version!==document.version||document.status!==(reallocate?"PICKING":"DRAFT")||!document.allowedActions.includes(action)||!Array.isArray(preview.assessments)||preview.assessments.length!==document.lines.length)fail();
 const selected=new Map(request.selections.map(member=>[String(member.claimId),member.allocations])),reasons=new Map(request.lineReasons.map(line=>[String(line.fulfillmentLineId),line.reason]));
 const lines=document.lines.map(line=>{
  const assessment=preview.assessments.find(row=>row.fulfillmentLineId===line.id),members=candidateResult.demands.filter(member=>member.fulfillmentLineId===line.id);if(!assessment?.canSubmit||!members.length||members.length>50||members.reduce((sum,member)=>sum+quantity(member.requestedQuantity),0n)!==quantity(line.plannedBaseQuantity))fail();
  const allocations=members.flatMap(member=>{const legs=selected.get(member.claimId)??[];if(legs.reduce((sum,leg)=>sum+quantity(leg.baseQuantity),0n)!==quantity(member.requestedQuantity))fail();return legs.map(leg=>({inventoryReservationId:Number(member.inventoryReservationId),inventoryBalanceId:leg.inventoryBalanceId,balanceVersion:leg.expectedBalanceVersion,baseQuantity:leg.baseQuantity}));});
  const result={fulfillmentLineId:Number(line.id),overrideReason:reason(reasons.get(line.id)??""),allocations};
  if(reallocate){const old=scope.releases?.filter(row=>row.fulfillmentLineId===line.id);if(!old?.length||old.reduce((sum,row)=>sum+quantity(row.availableBaseQuantity),0n)!==quantity(line.plannedBaseQuantity))fail();result.releases=old.map(row=>({fulfillmentAllocationId:Number(row.id),inventoryAllocationVersion:row.inventoryVersion}));}return result;
 });
 return validateAllocationIntent({eventId,version:document.version,lines},reallocate);
}

export function validateAllocationIntent(body,reallocate){
 if(!exact(body,["eventId","version","lines"])||typeof body.eventId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(body.eventId)||!version(body.version)||!Array.isArray(body.lines)||!body.lines.length||body.lines.length>100)fail();
 const lineIds=new Set(),reservations=new Map(),versions=new Map(),oldIds=new Set();
 for(const line of body.lines){
  if(!exact(line,["fulfillmentLineId","overrideReason","allocations",...(reallocate?["releases"]:[])])||!integer(line.fulfillmentLineId)||lineIds.has(line.fulfillmentLineId)||!Array.isArray(line.allocations)||!line.allocations.length||line.allocations.length>50)fail();lineIds.add(line.fulfillmentLineId);reason(line.overrideReason);
  const pairs=new Set();let total=0n;
  for(const leg of line.allocations){
   if(!exact(leg,["inventoryReservationId","inventoryBalanceId","balanceVersion","baseQuantity"])||!integer(leg.inventoryReservationId)||!integer(leg.inventoryBalanceId)||!version(leg.balanceVersion)||quantity(leg.baseQuantity)===0n)fail();
   const pair=`${leg.inventoryReservationId}:${leg.inventoryBalanceId}`;
   if(pairs.has(pair)||reservations.has(leg.inventoryReservationId)&&reservations.get(leg.inventoryReservationId)!==line.fulfillmentLineId||versions.has(leg.inventoryBalanceId)&&versions.get(leg.inventoryBalanceId)!==leg.balanceVersion)fail();pairs.add(pair);reservations.set(leg.inventoryReservationId,line.fulfillmentLineId);versions.set(leg.inventoryBalanceId,leg.balanceVersion);total+=quantity(leg.baseQuantity);
  }
  if(total>BigInt(Number.MAX_SAFE_INTEGER))fail();
  if(reallocate){if(!Array.isArray(line.releases)||!line.releases.length||line.releases.length>50)fail();for(const old of line.releases){if(!exact(old,["fulfillmentAllocationId","inventoryAllocationVersion"])||!integer(old.fulfillmentAllocationId)||!version(old.inventoryAllocationVersion)||oldIds.has(old.fulfillmentAllocationId))fail();oldIds.add(old.fulfillmentAllocationId);}}
 }
 return body;
}
