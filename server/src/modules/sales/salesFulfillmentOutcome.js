import { salesError } from "./salesErrors.js";

const READ_TRANSACTIONS=new WeakSet(),WRITE_TRANSACTIONS=new WeakSet();
const fail=()=>{throw salesError("SALES_FULFILLMENT_CONTRACT_MISMATCH");};
export function markSalesReconciliationRead(tx){if(WRITE_TRANSACTIONS.has(tx))fail();READ_TRANSACTIONS.add(tx);}
export function enterSalesFulfillmentWriteMode(tx){if(READ_TRANSACTIONS.has(tx))fail();WRITE_TRANSACTIONS.add(tx);}
export function unknownSalesOutcomeSource(error){return ["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR","SALES_FULFILLMENT_CONTRACT_MISMATCH"].includes(error?.cause?.code??error?.code);}
export function salesOutcomeSelection(source){
 const fields=(value,names)=>{if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.getOwnPropertySymbols(value).length||Object.keys(value).sort().join(",")!==names.split(",").sort().join(","))fail();};
 const id=(value,zero=false)=>{if(typeof value!=="string"||!/^(0|[1-9][0-9]{0,15})$/u.test(value)||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER)||!zero&&value==="0")fail();return value;};
 const claims=new Set(),reservations=new Set(),lines=new Set(),compare=(a,b)=>BigInt(a)<BigInt(b)?-1:1;
 if(!Array.isArray(source.pickedLines)||!source.pickedLines.length||source.pickedLines.length>100)fail();let total=0n;
 const selected=source.pickedLines.map(line=>{
  fields(line,"fulfillmentLineId,salesOrderLineId,skuId,baseQuantity,reservations");id(line.fulfillmentLineId);id(line.salesOrderLineId);id(line.skuId);id(line.baseQuantity,true);
  if(lines.has(line.salesOrderLineId)||!Array.isArray(line.reservations)||line.reservations.length>50)fail();lines.add(line.salesOrderLineId);let sum=0n;
  const members=line.reservations.map(member=>{fields(member,"claimId,inventoryReservationId,baseQuantity,allocations");id(member.claimId);id(member.inventoryReservationId);id(member.baseQuantity);if(claims.has(member.claimId)||reservations.has(member.inventoryReservationId)||!Array.isArray(member.allocations)||!member.allocations.length)fail();claims.add(member.claimId);reservations.add(member.inventoryReservationId);sum+=BigInt(member.baseQuantity);return {claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,baseQuantity:member.baseQuantity};}).sort((a,b)=>compare(a.inventoryReservationId,b.inventoryReservationId));
  if(sum!==BigInt(line.baseQuantity))fail();total+=sum;return {salesOrderLineId:line.salesOrderLineId,skuId:line.skuId,baseQuantity:line.baseQuantity,reservations:members};
 }).sort((a,b)=>compare(a.salesOrderLineId,b.salesOrderLineId));
 if(total===0n||claims.size>5000)fail();return selected;
}
