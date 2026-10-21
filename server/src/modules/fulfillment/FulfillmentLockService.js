import { normalizeSalesFulfillmentIntent } from "../sales/SalesFulfillmentService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { assertFulfillmentQuantities } from "./fulfillmentQuantityMath.js";
const placeholders=ids=>ids.map(()=>"?").join(",");
const conflict=()=>{throw fulfillmentError("RESERVATION_CLAIM_CONFLICT");};
const id=value=>{fulfillmentInteger(value);return value;};
function normalize(input){
  if(!input||Object.keys(input).sort().join(",")!=="expectedVersion,fulfillmentId,lines,salesIntent"||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1||input.expectedVersion>4294967295||!Array.isArray(input.lines)||!input.lines.length||input.lines.length>100)throw new TypeError("Invalid Claim scope");
  const salesIntent=normalizeSalesFulfillmentIntent(input.salesIntent);if(salesIntent.purpose!=="CLAIM")throw new TypeError("Claim purpose required");
  const seenLines=new Set(),seenReservations=new Set();let memberCount=0;
  const lines=input.lines.map(line=>{
    if(!line||Object.keys(line).sort().join(",")!=="baseQuantity,fulfillmentLineId,reservations,salesOrderLineId"||!Array.isArray(line.reservations)||!line.reservations.length)throw new TypeError("Invalid Claim line");
    const fulfillmentLineId=id(line.fulfillmentLineId);if(seenLines.has(fulfillmentLineId))conflict();seenLines.add(fulfillmentLineId);
    const salesOrderLineId=id(line.salesOrderLineId),baseQuantity=id(line.baseQuantity);
    const reservations=line.reservations.map(member=>{
      if(!member||Object.keys(member).sort().join(",")!=="baseQuantity,inventoryReservationId")throw new TypeError("Invalid Claim member");
      const inventoryReservationId=id(member.inventoryReservationId);if(seenReservations.has(inventoryReservationId)||++memberCount>5000)conflict();seenReservations.add(inventoryReservationId);
      return {inventoryReservationId,baseQuantity:id(member.baseQuantity)};
    }).sort((a,b)=>Number(a.inventoryReservationId)-Number(b.inventoryReservationId));
    if(reservations.reduce((sum,m)=>sum+BigInt(m.baseQuantity),0n)!==BigInt(baseQuantity))conflict();
    return {fulfillmentLineId,salesOrderLineId,baseQuantity,reservations};
  }).sort((a,b)=>Number(a.fulfillmentLineId)-Number(b.fulfillmentLineId));
  if(salesIntent.lines.length!==lines.length)conflict();
  for(const line of lines){const selected=salesIntent.lines.find(l=>l.salesOrderLineId===line.salesOrderLineId);if(!selected||selected.baseQuantity!==line.baseQuantity||selected.reservations.length!==line.reservations.length||line.reservations.some(m=>!selected.reservations.some(s=>s.inventoryReservationId===m.inventoryReservationId&&s.baseQuantity===m.baseQuantity)))conflict();}
  return {salesIntent,fulfillmentId:id(input.fulfillmentId),expectedVersion:input.expectedVersion,lines};
}
async function lockIds(tx,table,ids){
  const sorted=[...new Set(ids.map(String))].sort((a,b)=>Number(a)-Number(b)),rows=[];
  for(let start=0;start<sorted.length;start+=500){const batch=sorted.slice(start,start+500),[locked]=await tx.query(`SELECT * FROM ${table} WHERE id IN (${placeholders(batch)}) ORDER BY id FOR UPDATE`,batch);if(locked.length!==batch.length)conflict();rows.push(...locked);}
  return rows;
}
export class FulfillmentLockService {
  constructor({database,sales,inventoryLookup,itemLookup,time}){this.database=database;this.sales=sales;this.inventoryLookup=inventoryLookup;this.itemLookup=itemLookup;this.time=time;}
  // Returns validated owner DTOs under held roots. DRAFT callers persist exactly these requested quantities in the same transaction.
  // No Inventory allocation/post method may follow this CLAIM-only read; stock commands use their own full-set owner lock path.
  async lockClaimCapacityInTransaction(tx,input){
    const command=normalize(input);await requireFulfillmentActor(this.database,tx,"fulfillment.operation");
    const lockedSales=await this.sales.lockLinesForFulfillmentInTransaction(tx,command.salesIntent);
    if(lockedSales?.replay!==false||!lockedSales.order)conflict();
    const sales=lockedSales.order;
    const [rootIds]=await tx.query("SELECT id FROM fulfillments WHERE sales_order_id=? ORDER BY id",[sales.orderId]);
    const roots=await lockIds(tx,"fulfillments",rootIds.map(r=>r.id)),root=roots.find(r=>String(r.id)===command.fulfillmentId);
    if(!root||root.status!=="DRAFT"||String(root.sales_order_id)!==sales.orderId||String(root.customer_id)!==sales.customer.id||String(root.warehouse_id)!==sales.warehouse.id||Number(root.version)!==command.expectedVersion)throw fulfillmentError("VERSION_CONFLICT");
    const rootKeys=roots.map(r=>String(r.id));
    const [lineIds]=await tx.query(`SELECT id FROM fulfillment_lines WHERE fulfillment_id IN (${placeholders(rootKeys)}) ORDER BY id`,rootKeys),lines=await lockIds(tx,"fulfillment_lines",lineIds.map(r=>r.id));
    const [claimIds]=await tx.query(`SELECT id FROM fulfillment_line_reservation_claims WHERE fulfillment_id IN (${placeholders(rootKeys)}) ORDER BY id`,rootKeys),claims=await lockIds(tx,"fulfillment_line_reservation_claims",claimIds.map(r=>r.id));
    const own=lines.filter(l=>String(l.fulfillment_id)===command.fulfillmentId);
    if(own.length!==Number(root.line_count)||own.length!==command.lines.length)conflict();
    assertFulfillmentQuantities("DRAFT",own.map(l=>({planned:String(l.planned_base_quantity),allocated:String(l.allocated_base_quantity),released:"0",picked:String(l.picked_base_quantity),short:String(l.short_base_quantity),shipped:String(l.shipped_base_quantity),reversed:String(l.reversed_base_quantity)})));
    const desired=[];
    for(const line of command.lines){
      const persisted=own.find(l=>String(l.id)===line.fulfillmentLineId),source=sales.lines.find(l=>l.lineId===line.salesOrderLineId);
      if(!persisted||String(persisted.sales_order_line_id)!==line.salesOrderLineId||!source||String(persisted.sku_id)!==source.skuId||String(persisted.base_uom_id)!==source.baseUomId)conflict();
      for(const member of line.reservations){const mapping=source.reservationMappings.find(m=>m.inventoryReservationId===member.inventoryReservationId);if(!mapping)conflict();desired.push({...member,fulfillmentId:command.fulfillmentId,fulfillmentLineId:line.fulfillmentLineId,salesOrderLineId:line.salesOrderLineId,skuId:source.skuId,salesReservationMappingId:mapping.salesReservationMappingId});}
    }
    const profiles=await this.itemLookup.getFulfillmentInventoryProfilesInTransaction(tx,[...new Set(desired.map(m=>m.skuId))],{atMs:this.time.nowMs()});
    for(const line of own){const profile=profiles.find(p=>p.skuId===String(line.sku_id));if(!profile||profile.baseUom.uomId!==String(line.base_uom_id))conflict();}
    const current=await this.inventoryLookup.lockFulfillmentReservationStatesInTransaction(tx,{warehouseId:sales.warehouse.id,salesOrderId:sales.orderId,members:desired.map(m=>({inventoryReservationId:m.inventoryReservationId,salesOrderLineId:m.salesOrderLineId,skuId:m.skuId}))});
    const validated=desired.map(member=>{
      const state=current.find(s=>s.inventoryReservationId===member.inventoryReservationId);if(!state)conflict();
      const active=claims.filter(c=>String(c.inventory_reservation_id)===member.inventoryReservationId&&c.status==="ACTIVE");
      const total=active.reduce((sum,c)=>sum+fulfillmentInteger(String(c.active_claimed_quantity),{positive:false}),0n),others=active.filter(c=>String(c.fulfillment_id)!==command.fulfillmentId).reduce((sum,c)=>sum+BigInt(c.active_claimed_quantity),0n);
      const outstanding=BigInt(state.outstandingQuantity);if(total>outstanding)throw fulfillmentError("FULFILLABLE_QUANTITY_CHANGED");
      if(BigInt(member.baseQuantity)>outstanding-others)conflict();
      return Object.freeze({...member,inventoryVersion:state.version,outstandingBaseQuantity:state.outstandingQuantity,availableBaseQuantity:(outstanding-others).toString()});
    });
    return Object.freeze({fulfillmentId:command.fulfillmentId,version:command.expectedVersion,sales,claims:Object.freeze(validated)});
  }
}
