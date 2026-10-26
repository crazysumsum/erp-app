import { fulfillmentError } from "./fulfillmentErrors.js";
import { assertClaimQuantities,assertFulfillmentQuantities } from "./fulfillmentQuantityMath.js";
const fail=(code="FULFILLMENT_SOURCE_CONFLICT")=>{throw fulfillmentError(code);};
const invalid=()=>fail("FULFILLMENT_INPUT_INVALID");
const sum=(rows,key)=>rows.reduce((total,row)=>total+BigInt(row[key]),0n);
export function normalizeFulfillmentCancel(body){
 if(!body||Object.getPrototypeOf(body)!==Object.prototype||!["eventId","version"].every(key=>Object.hasOwn(body,key))||Object.keys(body).some(key=>!["eventId","version","reason","goodsReturnedToOriginalBins"].includes(key))||typeof body.eventId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(body.eventId)||!Number.isSafeInteger(body.version)||body.version<1||body.version>4294967295||body.reason!==undefined&&(typeof body.reason!=="string"||[...body.reason].length>500||/[\p{Cc}\p{Cf}]/u.test(body.reason))||body.goodsReturnedToOriginalBins!==undefined&&typeof body.goodsReturnedToOriginalBins!=="boolean")invalid();
 const reason=(body.reason??"").trim();if(reason&&[...reason].length<5)invalid();return Object.freeze({eventId:body.eventId,version:body.version,reason,goodsReturnedToOriginalBins:body.goodsReturnedToOriginalBins??false});
}
export function planFulfillmentCancel(snapshot,command){
 const {header,lines,claims,allocations,allocationTotals}=snapshot,status=header.status;
 if(!["DRAFT","PICKING","PICKED"].includes(status)||header.active_shipment_id!==null||snapshot.hasShipment||header.shipped_at!==null||header.reversed_at!==null)fail("FULFILLMENT_STATE_CONFLICT");
 if(Number(header.version)!==command.version||command.version>=4294967295)fail("VERSION_CONFLICT");
 if(status!=="DRAFT"&&!command.reason||sum(lines,"picked_base_quantity")>0n&&!command.goodsReturnedToOriginalBins)invalid();
 if(!lines.length||lines.length>100||lines.length!==Number(header.line_count)||!claims.length||claims.length>5000||allocations.length>5000||new Set(claims.map(row=>String(row.inventory_reservation_id))).size!==claims.length)fail();
 if(status==="DRAFT"&&(allocations.length||allocationTotals.length||header.allocated_at!==null||header.picked_at!==null)||status!=="DRAFT"&&header.allocated_at===null||status==="PICKING"&&header.picked_at!==null||status==="PICKED"&&header.picked_at===null)fail();
 assertFulfillmentQuantities(status,lines.map(line=>{
  const members=claims.filter(row=>String(row.fulfillment_line_id)===String(line.id)),total=allocationTotals.find(row=>String(row.fulfillment_line_id)===String(line.id))??{allocated:"0",released:"0",picked:"0"};
  if(!members.length||members.length>50||String(line.fulfillment_id)!==String(header.id)||String(total.allocated)!==String(line.allocated_base_quantity)||String(total.picked)!==String(line.picked_base_quantity)||sum(members,"original_claimed_quantity")!==BigInt(line.planned_base_quantity)||sum(members,"active_claimed_quantity")!==BigInt(status==="PICKED"?line.picked_base_quantity:line.planned_base_quantity))fail();
  for(const claim of members){assertClaimQuantities({original:String(claim.original_claimed_quantity),active:String(claim.active_claimed_quantity),released:String(claim.released_quantity),consumed:String(claim.consumed_quantity),reversed:String(claim.reversed_quantity)});if(String(claim.fulfillment_id)!==String(header.id)||BigInt(claim.consumed_quantity)!==0n||BigInt(claim.reversed_quantity)!==0n||claim.status!==(BigInt(claim.active_claimed_quantity)>0n?"ACTIVE":"RELEASED"))fail();const owned=allocations.filter(row=>String(row.claim_id)===String(claim.id));if(status!=="DRAFT"&&sum(owned,"allocated_base_quantity")-sum(owned,"released_base_quantity")!==BigInt(claim.active_claimed_quantity))fail();}
  return {planned:String(line.planned_base_quantity),allocated:String(line.allocated_base_quantity),released:String(total.released),picked:String(line.picked_base_quantity),short:String(line.short_base_quantity),shipped:String(line.shipped_base_quantity),reversed:String(line.reversed_base_quantity)};
 }));
 if(status!=="DRAFT"&&allocationTotals.length!==lines.length||claims.some(row=>!lines.some(line=>String(line.id)===String(row.fulfillment_line_id))))fail();
 const plan=allocations.map(row=>{const claim=claims.find(value=>String(value.id)===String(row.claim_id)),line=lines.find(value=>String(value.id)===String(row.fulfillment_line_id)),outstanding=BigInt(row.allocated_base_quantity)-BigInt(row.released_base_quantity);if(!claim||!line||String(row.fulfillment_id)!==String(header.id)||String(claim.fulfillment_line_id)!==String(line.id)||String(row.inventory_reservation_id)!==String(claim.inventory_reservation_id)||outstanding<=0n||BigInt(row.picked_base_quantity)!==(status==="PICKED"?outstanding:0n)||!["ACTIVE","PARTIALLY_RELEASED"].includes(row.status))fail();return Object.freeze({fulfillmentAllocationId:String(row.id),fulfillmentLineId:String(row.fulfillment_line_id),pickedBaseQuantity:"0",shortBaseQuantity:outstanding.toString()});});
 return Object.freeze({status,allocations:Object.freeze(plan)});
}
