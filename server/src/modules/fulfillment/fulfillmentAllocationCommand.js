import { fulfillmentError } from "./fulfillmentErrors.js";
const invalid=()=>{throw fulfillmentError("FULFILLMENT_INPUT_INVALID");};
const exact=(value,required,optional=[])=>value&&Object.getPrototypeOf(value)===Object.prototype&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>[...required,...optional].includes(key));
const id=value=>Number.isSafeInteger(value)&&value>0;
export function normalizeFulfillmentAllocation(body) {
 if(!exact(body,["eventId","version","lines"])||typeof body.eventId!=="string"||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(body.eventId)||!id(body.version)||body.version>4294967295||!Array.isArray(body.lines)||!body.lines.length||body.lines.length>100)invalid();
 const lineIds=new Set(),reservationLines=new Map(),versions=new Map();
 const lines=body.lines.map(line=>{
  if(!exact(line,["fulfillmentLineId","allocations"],["overrideReason"])||!id(line.fulfillmentLineId)||lineIds.has(line.fulfillmentLineId)||!Array.isArray(line.allocations)||!line.allocations.length||line.allocations.length>50)invalid();lineIds.add(line.fulfillmentLineId);
  const reason=line.overrideReason??"";if(typeof reason!=="string"||[...reason].length>500||/[\p{Cc}\p{Cf}]/u.test(reason))invalid();
  const pairs=new Set();let total=0n;
  const allocations=line.allocations.map(leg=>{
   if(!exact(leg,["inventoryReservationId","inventoryBalanceId","balanceVersion","baseQuantity"])||!id(leg.inventoryReservationId)||!id(leg.inventoryBalanceId)||!id(leg.balanceVersion)||leg.balanceVersion>4294967295||typeof leg.baseQuantity!=="string"||! /^[1-9][0-9]{0,15}$/u.test(leg.baseQuantity)||BigInt(leg.baseQuantity)>BigInt(Number.MAX_SAFE_INTEGER))invalid();
   const key=`${leg.inventoryReservationId}:${leg.inventoryBalanceId}`;
   if(pairs.has(key)||reservationLines.has(leg.inventoryReservationId)&&reservationLines.get(leg.inventoryReservationId)!==line.fulfillmentLineId||versions.has(leg.inventoryBalanceId)&&versions.get(leg.inventoryBalanceId)!==leg.balanceVersion)invalid();
   pairs.add(key);reservationLines.set(leg.inventoryReservationId,line.fulfillmentLineId);versions.set(leg.inventoryBalanceId,leg.balanceVersion);total+=BigInt(leg.baseQuantity);return Object.freeze({...leg});
  }).sort((a,b)=>a.inventoryReservationId-b.inventoryReservationId||a.inventoryBalanceId-b.inventoryBalanceId);
  if(total>BigInt(Number.MAX_SAFE_INTEGER))invalid();
  return Object.freeze({fulfillmentLineId:line.fulfillmentLineId,allocations:Object.freeze(allocations),overrideReason:reason.trim()});
 }).sort((a,b)=>a.fulfillmentLineId-b.fulfillmentLineId);
 return Object.freeze({eventId:body.eventId,version:body.version,lines:Object.freeze(lines)});
}
