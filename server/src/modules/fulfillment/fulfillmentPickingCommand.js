import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
const fail=(code="FULFILLMENT_INPUT_INVALID")=>{throw fulfillmentError(code);};
const exact=(value,required,optional=[])=>value&&Object.getPrototypeOf(value)===Object.prototype&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>[...required,...optional].includes(key));
const id=value=>Number.isSafeInteger(value)&&value>0;
function quantity(value){if(typeof value!=="string"||! /^(0|[1-9][0-9]{0,15})$/u.test(value)||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER))fail();return value;}
export function normalizeFulfillmentPick(input){
 if(!exact(input,["eventId","version","lines"])||typeof input.eventId!=="string"||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(input.eventId)||!id(input.version)||input.version>4294967295||!Array.isArray(input.lines)||!input.lines.length||input.lines.length>100)fail();
 const lines=new Set(),allocations=new Set();
 const result=input.lines.map(line=>{
  if(!exact(line,["fulfillmentLineId","allocations"],["shortPickReason"])||!id(line.fulfillmentLineId)||lines.has(line.fulfillmentLineId)||!Array.isArray(line.allocations)||!line.allocations.length||line.allocations.length>50)fail();lines.add(line.fulfillmentLineId);
  const reason=line.shortPickReason??"";if(typeof reason!=="string"||[...reason].length>500||/[\p{Cc}\p{Cf}]/u.test(reason))fail();
  const members=line.allocations.map(member=>{
   if(!exact(member,["fulfillmentAllocationId","inventoryAllocationVersion","pickedBaseQuantity"])||!id(member.fulfillmentAllocationId)||allocations.has(member.fulfillmentAllocationId)||!id(member.inventoryAllocationVersion)||member.inventoryAllocationVersion>4294967295)fail();allocations.add(member.fulfillmentAllocationId);
   return Object.freeze({...member,pickedBaseQuantity:quantity(member.pickedBaseQuantity)});
  }).sort((a,b)=>a.fulfillmentAllocationId-b.fulfillmentAllocationId);
  return Object.freeze({fulfillmentLineId:line.fulfillmentLineId,shortPickReason:reason.trim(),allocations:Object.freeze(members)});
 }).sort((a,b)=>a.fulfillmentLineId-b.fulfillmentLineId);
 return Object.freeze({eventId:input.eventId,version:input.version,lines:Object.freeze(result)});
}
export function planFulfillmentPick(snapshot,command){
 const {header,lines,allocations}=snapshot;
 if(header.status!=="PICKING")fail("FULFILLMENT_STATE_CONFLICT");if(Number(header.version)!==command.version||command.version===4294967295)fail("VERSION_CONFLICT");
 if(lines.length!==Number(header.line_count)||lines.length!==command.lines.length||allocations.length!==command.lines.reduce((sum,line)=>sum+line.allocations.length,0))fail("FULFILLMENT_SOURCE_CONFLICT");
 const planned=[],results=[];let totalPicked=0n,missingShortReason=false;
 for(const selected of command.lines){
  const line=lines.find(row=>String(row.id)===String(selected.fulfillmentLineId)),owned=allocations.filter(row=>String(row.fulfillment_line_id)===String(selected.fulfillmentLineId));
  if(!line||owned.length!==selected.allocations.length||["picked_base_quantity","short_base_quantity","shipped_base_quantity","reversed_base_quantity"].some(key=>BigInt(line[key])!==0n))fail("FULFILLMENT_SOURCE_CONFLICT");
  let picked=0n,short=0n,active=0n;
  for(const member of selected.allocations){
   const row=owned.find(value=>String(value.id)===String(member.fulfillmentAllocationId));if(!row||!["ACTIVE","PARTIALLY_RELEASED"].includes(row.status)||BigInt(row.picked_base_quantity)!==0n)fail("FULFILLMENT_SOURCE_CONFLICT");if(Number(row.inventory_version)!==member.inventoryAllocationVersion)fail("VERSION_CONFLICT");
   const available=fulfillmentInteger(String(row.allocated_base_quantity))-fulfillmentInteger(String(row.released_base_quantity),{positive:false}),actual=BigInt(member.pickedBaseQuantity);if(available<=0n||actual>available)fail("PICK_RESULT_INVALID");
   const difference=available-actual;active+=available;picked+=actual;short+=difference;
   results.push(Object.freeze({fulfillmentAllocationId:String(row.id),fulfillmentLineId:String(line.id),inventoryAllocationVersion:member.inventoryAllocationVersion,pickedBaseQuantity:actual.toString(),shortBaseQuantity:difference.toString()}));
  }
  if(active!==BigInt(line.planned_base_quantity)||BigInt(line.allocated_base_quantity)<active)fail("FULFILLMENT_SOURCE_CONFLICT");
  if(short>0n&&[...selected.shortPickReason].length<5)missingShortReason=true;totalPicked+=picked;
  planned.push(Object.freeze({fulfillmentLineId:String(line.id),pickedBaseQuantity:picked.toString(),shortBaseQuantity:short.toString(),shortPickReason:selected.shortPickReason}));
 }
 if(totalPicked===0n)fail("PICK_RESULT_INVALID");if(missingShortReason)fail("SHORT_PICK_REASON_REQUIRED");
 return Object.freeze({lines:Object.freeze(planned),allocations:Object.freeze(results)});
}
