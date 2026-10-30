import { normalizeFulfillmentAllocation } from "./fulfillmentAllocationCommand.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
const invalid=()=>{throw fulfillmentError("FULFILLMENT_INPUT_INVALID");};
export function normalizeFulfillmentReallocation(body){
 if(!body||Object.getPrototypeOf(body)!==Object.prototype||!Array.isArray(body.lines))invalid();
 const oldIds=new Set(),byLine=new Map(),lines=body.lines.map(line=>{
  if(!line||Object.getPrototypeOf(line)!==Object.prototype)invalid();const {releases,...selection}=line;
  if(!Array.isArray(releases)||!releases.length||releases.length>50)invalid();
  const old=releases.map(row=>{
   if(!row||Object.getPrototypeOf(row)!==Object.prototype||Object.keys(row).sort().join(",")!=="fulfillmentAllocationId,inventoryAllocationVersion"||!Number.isSafeInteger(row.fulfillmentAllocationId)||row.fulfillmentAllocationId<1||!Number.isSafeInteger(row.inventoryAllocationVersion)||row.inventoryAllocationVersion<1||row.inventoryAllocationVersion>4294967295||oldIds.has(row.fulfillmentAllocationId))invalid();oldIds.add(row.fulfillmentAllocationId);return Object.freeze({...row});
  }).sort((a,b)=>a.fulfillmentAllocationId-b.fulfillmentAllocationId);byLine.set(line.fulfillmentLineId,Object.freeze(old));return selection;
 });
 const normalized=normalizeFulfillmentAllocation({...body,lines});return Object.freeze({...normalized,lines:Object.freeze(normalized.lines.map(line=>Object.freeze({...line,releases:byLine.get(line.fulfillmentLineId)})))});
}
