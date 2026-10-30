import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
const fail=()=>{throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");};
const exact=(value,keys)=>{if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join(",")!==[...keys].sort().join(","))fail();};
const integer=(value,min=1,max=Number.MAX_SAFE_INTEGER)=>{if(!Number.isSafeInteger(value)||value<min||value>max)fail();};
const quantity=(value,positive=true)=>{try{return fulfillmentInteger(value,{positive});}catch{fail();}};
const date=value=>{if(value!==null&&(typeof value!=="string"||! /^\d{4}-\d{2}-\d{2}$/u.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))fail();};
export function assertFulfillmentCandidateResult(result,demands,claims,warehouseId,baseUomIds) {
 exact(result,["warehouseId","asOf","demands"]);if(result.warehouseId!==warehouseId||!Array.isArray(result.demands)||result.demands.length!==demands.length)fail();integer(result.asOf,0);
 const expected=[...demands].sort((a,b)=>Number(a.fulfillmentLineId)-Number(b.fulfillmentLineId)||Number(a.inventoryReservationId)-Number(b.inventoryReservationId));
 for(const [index,member] of result.demands.entries()){
  exact(member,["fulfillmentLineId","claimId","inventoryReservationId","skuId","expectedReservationVersion","requestedQuantity","minimumRemainingDays","baseUom","page","hasMore","candidates","summary"]);
  const request=expected[index],current=claims.find(row=>row.inventoryReservationId===request.inventoryReservationId);
  for(const field of ["fulfillmentLineId","claimId","inventoryReservationId","skuId","requestedQuantity","page"])if(member[field]!==request[field])fail();
  if(!current||member.expectedReservationVersion!==current.inventoryVersion)fail();integer(member.expectedReservationVersion,1,4294967295);integer(member.minimumRemainingDays,0,36500);
  exact(member.baseUom,["uomId","uomCode","version"]);quantity(member.baseUom.uomId);if(member.baseUom.uomId!==baseUomIds.get(member.fulfillmentLineId))fail();if(typeof member.baseUom.uomCode!=="string"||!member.baseUom.uomCode)fail();integer(member.baseUom.version,1,4294967295);
  if(typeof member.hasMore!=="boolean"||!Array.isArray(member.candidates)||member.candidates.length>100||member.hasMore&&member.candidates.length!==100)fail();
  const ids=new Set();let visibleRecommended=0n;
  for(const [offset,candidate]of member.candidates.entries()){
   exact(candidate,["inventoryBalanceId","binId","binCode","lotId","expiryDate","firstReceiptDate","fifoAnchorDate","freeQuantity","batchAvailableQuantity","expectedBalanceVersion","selectionStrategy","rank","eligible","recommendedQuantity"]);
   quantity(candidate.inventoryBalanceId);quantity(candidate.binId);if(candidate.lotId!==null)quantity(candidate.lotId);if(ids.has(candidate.inventoryBalanceId))fail();ids.add(candidate.inventoryBalanceId);
   for(const key of ["expiryDate","firstReceiptDate","fifoAnchorDate"])date(candidate[key]);
   if(candidate.lotId===null&&(candidate.expiryDate!==null||candidate.firstReceiptDate!==null)||candidate.lotId!==null&&candidate.firstReceiptDate===null)fail();
   if(typeof candidate.binCode!=="string"||!candidate.binCode||candidate.eligible!==true||candidate.rank!==(member.page-1)*100+offset+1||candidate.selectionStrategy!==(candidate.expiryDate?"FEFO":"FIFO"))fail();integer(candidate.expectedBalanceVersion,1,4294967295);
   const free=quantity(candidate.freeQuantity),available=quantity(candidate.batchAvailableQuantity),recommended=quantity(candidate.recommendedQuantity,false);if(available>free||recommended>available)fail();visibleRecommended+=recommended;
  }
  exact(member.summary,["requestedBaseQuantity","recommendedBaseQuantity","quantityComplete","insufficientStock"]);
  const requested=quantity(member.requestedQuantity),recommended=quantity(member.summary.recommendedBaseQuantity,false);
  if(member.summary.requestedBaseQuantity!==member.requestedQuantity||recommended>requested||recommended<visibleRecommended||member.page===1&&!member.hasMore&&recommended!==visibleRecommended||member.summary.quantityComplete!==(recommended===requested)||member.summary.insufficientStock!==(recommended<requested))fail();
 }
}
