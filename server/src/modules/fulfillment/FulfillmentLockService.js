import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { normalizeSalesFulfillmentIntent } from "../sales/SalesFulfillmentService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { assertClaimQuantities, assertFulfillmentQuantities } from "./fulfillmentQuantityMath.js";
const placeholders=ids=>ids.map(()=>"?").join(",");
const conflict=()=>{throw fulfillmentError("RESERVATION_CLAIM_CONFLICT");};
const id=value=>{fulfillmentInteger(value);return value;};
function normalize(input){
  if(!input||Object.keys(input).sort().join(",")!=="expectedVersion,fulfillmentId,lines,salesIntent"||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1||input.expectedVersion>4294967295||!Array.isArray(input.lines)||!input.lines.length||input.lines.length>100)throw new TypeError("Invalid Claim scope");
  const salesIntent=normalizeSalesFulfillmentIntent(input.salesIntent);if(salesIntent.purpose!=="CLAIM"||salesIntent.claimMode!==undefined)throw new TypeError("Persisted Claim purpose required");
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
const lockRanks=Object.freeze({fulfillments:1,fulfillment_lines:2,fulfillment_line_reservation_claims:3,fulfillment_allocations:4,shipments:5,shipment_lines:6,shipment_reversals:7});
const heldLocks=new WeakMap();
export function sortedFulfillmentIds(ids){
  if(!Array.isArray(ids))throw new TypeError("IDs required");
  return [...new Set(ids.map(value=>{const key=String(value);fulfillmentInteger(key);return key;}))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
}
export async function lockFulfillmentRowsInTransaction(tx,table,ids){
  if(tx?.context?.get()?.databaseTransaction!==tx||!Object.hasOwn(lockRanks,table)||!["READ COMMITTED","REPEATABLE READ"].includes(getActiveTransactionIsolation(tx)))throw new TypeError("Active transaction and fixed lock scope required");
  const sorted=sortedFulfillmentIds(ids),rank=lockRanks[table],state=heldLocks.get(tx)??{rank:0,last:new Map(),ids:new Map()};
  const prior=state.ids.get(table)??new Set(),last=state.last.get(table);
  if(rank<state.rank||sorted.some(key=>!prior.has(key)&&last&&BigInt(key)<BigInt(last)))throw new TypeError("Fulfillment lock order inversion");
  state.rank=rank;for(const key of sorted)prior.add(key);state.ids.set(table,prior);if(sorted.length&&(!last||BigInt(sorted.at(-1))>BigInt(last)))state.last.set(table,sorted.at(-1));heldLocks.set(tx,state);
  const rows=[];
  for(let start=0;start<sorted.length;start+=500){const batch=sorted.slice(start,start+500),[locked]=await tx.query(`SELECT * FROM ${table} FORCE INDEX (PRIMARY) WHERE id IN (${placeholders(batch)}) ORDER BY id FOR UPDATE`,batch);if(locked.length!==batch.length)conflict();rows.push(...locked);}
  return rows;
}
const lockIds=lockFulfillmentRowsInTransaction;
export class FulfillmentLockService {
  constructor({database,sales,inventoryLookup,itemLookup,time}){this.database=database;this.sales=sales;this.inventoryLookup=inventoryLookup;this.itemLookup=itemLookup;this.time=time;}
  // Pending requests bind Sales locks only. Final members are derived from its complete locked mapping projection.
  // No private Header/Line/Claim is inserted, and no Inventory stock-post may follow this Claim-only path.
  async lockPendingClaimCapacityInTransaction(tx,input){
    if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).join(",")!=="salesIntent")throw new TypeError("Invalid pending Claim scope");
    const intent=normalizeSalesFulfillmentIntent(input.salesIntent);
    if(intent.purpose!=="CLAIM"||intent.claimMode!=="PENDING_CREATE"||intent.lines.some(line=>line.baseQuantity==="0"))throw new TypeError("Pending CREATE Claim required");
    return this.#lockPendingCapacity(tx,intent,null);
  }
  async lockPendingUpdateCapacityInTransaction(tx,input){
    if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).sort().join(",")!=="expectedVersion,fulfillmentId,salesIntent"||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1||input.expectedVersion>4294967295)throw new TypeError("Invalid pending update scope");
    const intent=normalizeSalesFulfillmentIntent(input.salesIntent),fulfillmentId=id(input.fulfillmentId);
    if(intent.purpose!=="CLAIM"||intent.claimMode!=="PENDING_UPDATE")throw new TypeError("Pending UPDATE Claim required");
    return this.#lockPendingCapacity(tx,intent,{fulfillmentId,expectedVersion:input.expectedVersion});
  }
  async #lockPendingCapacity(tx,intent,target){
    await requireFulfillmentActor(this.database,tx,"fulfillment.operation");
    const locked=await this.sales.lockLinesForFulfillmentInTransaction(tx,intent);
    if(locked?.replay!==false||!locked.order)conflict();
    const sales=locked.order;
    const [rootIds]=await tx.query("SELECT id FROM fulfillments WHERE sales_order_id=? ORDER BY id",[sales.orderId]);
    const roots=await lockIds(tx,"fulfillments",rootIds.map(row=>row.id)),rootKeys=roots.map(row=>String(row.id));
    const [lineIds]=rootKeys.length?await tx.query(`SELECT id FROM fulfillment_lines WHERE fulfillment_id IN (${placeholders(rootKeys)}) ORDER BY id`,rootKeys):[[]];
    const persistedLines=await lockIds(tx,"fulfillment_lines",lineIds.map(row=>row.id));
    const [claimIds]=rootKeys.length?await tx.query(`SELECT id FROM fulfillment_line_reservation_claims WHERE fulfillment_id IN (${placeholders(rootKeys)}) ORDER BY id`,rootKeys):[[]];
    const claims=await lockIds(tx,"fulfillment_line_reservation_claims",claimIds.map(row=>row.id));
    let targetRoot=null,ownLines=[],ownClaims=[];
    if(target){
      targetRoot=roots.find(root=>String(root.id)===target.fulfillmentId);
      if(!targetRoot)throw fulfillmentError("FULFILLMENT_NOT_FOUND");
      if(targetRoot.status!=="DRAFT")throw fulfillmentError("FULFILLMENT_STATE_CONFLICT");
      if(Number(targetRoot.version)!==target.expectedVersion)throw fulfillmentError("VERSION_CONFLICT");
      if(String(targetRoot.sales_order_id)!==sales.orderId||String(targetRoot.customer_id)!==sales.customer.id||String(targetRoot.warehouse_id)!==sales.warehouse.id)conflict();
      ownLines=persistedLines.filter(line=>String(line.fulfillment_id)===target.fulfillmentId);
      ownClaims=claims.filter(claim=>String(claim.fulfillment_id)===target.fulfillmentId);
      if(ownLines.length!==Number(targetRoot.line_count)||ownLines.some(line=>!intent.lines.some(selected=>selected.salesOrderLineId===String(line.sales_order_line_id))))conflict();
      if(intent.lines.some(selected=>selected.baseQuantity==="0"&&!ownLines.some(line=>String(line.sales_order_line_id)===selected.salesOrderLineId)))conflict();
      assertFulfillmentQuantities("DRAFT",ownLines.map(line=>({planned:String(line.planned_base_quantity),allocated:String(line.allocated_base_quantity),released:"0",picked:String(line.picked_base_quantity),short:String(line.short_base_quantity),shipped:String(line.shipped_base_quantity),reversed:String(line.reversed_base_quantity)})));
      const [[effects]]=await tx.query("SELECT EXISTS(SELECT 1 FROM fulfillment_allocations WHERE fulfillment_id=?) AS allocations,EXISTS(SELECT 1 FROM shipments WHERE fulfillment_id=?) AS shipments,EXISTS(SELECT 1 FROM fulfillment_status_history WHERE fulfillment_id=? AND action<>'CREATE') AS history",[target.fulfillmentId,target.fulfillmentId,target.fulfillmentId]);
      if(Number(effects.allocations)||Number(effects.shipments)||Number(effects.history)||["allocated_at","picked_at","shipped_at","reversed_at","active_shipment_id"].some(key=>targetRoot[key]!==null))throw fulfillmentError("FULFILLMENT_STATE_CONFLICT");
      for(const claim of ownClaims){
        assertClaimQuantities({original:String(claim.original_claimed_quantity),active:String(claim.active_claimed_quantity),released:String(claim.released_quantity),consumed:String(claim.consumed_quantity),reversed:String(claim.reversed_quantity)});
        if(claim.status!=="ACTIVE"||BigInt(claim.released_quantity)!==0n||BigInt(claim.consumed_quantity)!==0n||BigInt(claim.reversed_quantity)!==0n)conflict();
      }
      for(const line of ownLines){
        const source=sales.lines.find(row=>row.lineId===String(line.sales_order_line_id));
        if(!source||source.skuId!==String(line.sku_id)||source.baseUomId!==String(line.base_uom_id)||ownClaims.filter(claim=>String(claim.fulfillment_line_id)===String(line.id)).reduce((sum,claim)=>sum+BigInt(claim.active_claimed_quantity),0n)!==BigInt(line.planned_base_quantity))conflict();
      }
    }
    const active=new Map(),ownActive=new Map();
    for(const claim of claims)if(claim.status==="ACTIVE"){
      const key=String(claim.inventory_reservation_id),quantity=fulfillmentInteger(String(claim.active_claimed_quantity));
      active.set(key,(active.get(key)??0n)+quantity);
      if(target&&String(claim.fulfillment_id)===target.fulfillmentId)ownActive.set(key,(ownActive.get(key)??0n)+quantity);
    }
    if(sales.lines.length!==intent.lines.length)conflict();
    const candidates=[],seen=new Set();
    for(const line of sales.lines){
      if(!intent.lines.some(selected=>selected.salesOrderLineId===line.lineId))conflict();
      for(const mapping of line.reservationMappings){
        const outstanding=fulfillmentInteger(mapping.outstandingBaseQuantity,{positive:false}),claimed=active.get(mapping.inventoryReservationId)??0n;
        if(claimed>outstanding)throw fulfillmentError("FULFILLABLE_QUANTITY_CHANGED");
        if(outstanding===0n&&claimed===0n)continue;
        if(seen.has(mapping.inventoryReservationId))conflict();seen.add(mapping.inventoryReservationId);
        candidates.push({line,mapping,claimed});
      }
    }
    // Source candidates may outnumber the selected command: prove the complete influence set in owner batches.
    if(!candidates.length)throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
    const skuIds=sortedFulfillmentIds(sales.lines.map(line=>line.skuId));
    const profiles=await this.itemLookup.getFulfillmentInventoryProfilesInTransaction(tx,skuIds,{atMs:this.time.nowMs()});
    const bySku=new Map(profiles.map(profile=>[profile.skuId,profile]));
    if(bySku.size!==skuIds.length)conflict();
    for(const line of sales.lines){
      const profile=bySku.get(line.skuId);
      if(!profile||!profile.usable||!profile.inventoryTracked||profile.baseUom.uomId!==line.baseUomId)conflict();
      if(profile.trackingPolicy==="serial"||line.trackingPolicy==="serial")throw fulfillmentError("SERIAL_TRACKING_UNSUPPORTED");
    }
    let current;
    try{current=await this.inventoryLookup.lockFulfillmentReservationScopeInTransaction(tx,{warehouseId:sales.warehouse.id,salesOrderId:sales.orderId,members:candidates.map(({line,mapping})=>({inventoryReservationId:mapping.inventoryReservationId,salesOrderLineId:line.lineId,skuId:line.skuId}))});}
    catch(error){if(["RESERVATION_STATE_CONFLICT","INVENTORY_SOURCE_CONFLICT"].includes(error.code))throw fulfillmentError("FULFILLABLE_QUANTITY_CHANGED");throw error;}
    const byReservation=new Map(current.map(state=>[state.inventoryReservationId,state]));
    if(current.length!==candidates.length||byReservation.size!==candidates.length)conflict();
    for(const {mapping,claimed} of candidates){
      const state=byReservation.get(mapping.inventoryReservationId);
      if(!state||state.originalQuantity!==mapping.originalBaseQuantity||state.consumedQuantity!==mapping.consumedBaseQuantity||state.releasedQuantity!==mapping.releasedBaseQuantity||state.outstandingQuantity!==mapping.outstandingBaseQuantity||state.originalSourceEventId!==mapping.sourceEventId||state.version<mapping.inventoryVersion||claimed>fulfillmentInteger(state.outstandingQuantity,{positive:false}))throw fulfillmentError("FULFILLABLE_QUANTITY_CHANGED");
    }
    for(const claim of ownClaims){
      const state=byReservation.get(String(claim.inventory_reservation_id));
      if(!state||state.version<Number(claim.inventory_version))throw fulfillmentError("FULFILLABLE_QUANTITY_CHANGED");
    }
    // Read actual owner history after current Warehouse/Reservation locks; a missing local projection is not absence of effects.
    if(target&&await this.inventoryLookup.hasFulfillmentAllocationHistoryInTransaction(tx,{fulfillmentId:target.fulfillmentId}))throw fulfillmentError("FULFILLMENT_STATE_CONFLICT");
    const lines=intent.lines.filter(selected=>selected.baseQuantity!=="0").map(selected=>{
      const source=sales.lines.find(line=>line.lineId===selected.salesOrderLineId);let remaining=fulfillmentInteger(selected.baseQuantity);
      const allocated=[];
      for(const {mapping,claimed} of candidates.filter(member=>member.line.lineId===source.lineId).sort((a,b)=>BigInt(a.mapping.salesReservationMappingId)<BigInt(b.mapping.salesReservationMappingId)?-1:1)){
        const state=byReservation.get(mapping.inventoryReservationId),others=claimed-(ownActive.get(mapping.inventoryReservationId)??0n),free=BigInt(state.outstandingQuantity)-others,quantity=free<remaining?free:remaining;
        if(quantity>0n){allocated.push(Object.freeze({salesReservationMappingId:mapping.salesReservationMappingId,inventoryReservationId:mapping.inventoryReservationId,inventoryVersion:state.version,baseQuantity:quantity.toString()}));remaining-=quantity;}
        if(remaining===0n)break;
      }
      if(remaining!==0n||allocated.length>50)throw fulfillmentError("RESERVATION_CLAIM_CONFLICT");
      return Object.freeze({salesOrderLineId:source.lineId,baseQuantity:selected.baseQuantity,claims:Object.freeze(allocated)});
    });
    return Object.freeze({sales,profiles,lines:Object.freeze(lines),...(target?{fulfillmentId:target.fulfillmentId,version:target.expectedVersion,number:targetRoot.fulfillment_number,notes:targetRoot.notes,previousLineCount:ownLines.length,previousClaimCount:ownClaims.length}:{})});
  }
  // Returns validated owner DTOs under held roots. DRAFT callers persist exactly these requested quantities in the same transaction.
  // No Inventory allocation/post method may follow this CLAIM-only read; stock commands use their own full-set owner lock path.
  async lockClaimCapacityInTransaction(tx,input){
    const command=normalize(input);await requireFulfillmentActor(this.database,tx,"fulfillment.operation");
    const lockedSales=await this.sales.lockLinesForFulfillmentInTransaction(tx,command.salesIntent);
    if(lockedSales?.replay!==false||!lockedSales.order)conflict();
    const sales=lockedSales.order;
    const sourceFacts=await this.sales.readLockedFulfillmentClaimSourceFactsInTransaction(tx,command.salesIntent);
    if(sourceFacts.orderId!==sales.orderId)conflict();
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
      const source=sourceFacts.lines.find(line=>line.salesOrderLineId===member.salesOrderLineId)?.reservations.find(row=>row.inventoryReservationId===member.inventoryReservationId);
      if(!source||source.originalBaseQuantity!==state.originalQuantity||source.consumedBaseQuantity!==state.consumedQuantity||source.releasedBaseQuantity!==state.releasedQuantity||source.outstandingBaseQuantity!==state.outstandingQuantity||source.sourceEventId!==state.originalSourceEventId||state.version<source.inventoryVersion)throw fulfillmentError("FULFILLABLE_QUANTITY_CHANGED");
      const active=claims.filter(c=>String(c.inventory_reservation_id)===member.inventoryReservationId&&c.status==="ACTIVE");
      const total=active.reduce((sum,c)=>sum+fulfillmentInteger(String(c.active_claimed_quantity),{positive:false}),0n),others=active.filter(c=>String(c.fulfillment_id)!==command.fulfillmentId).reduce((sum,c)=>sum+BigInt(c.active_claimed_quantity),0n);
      const outstanding=BigInt(state.outstandingQuantity);if(total>outstanding)throw fulfillmentError("FULFILLABLE_QUANTITY_CHANGED");
      if(BigInt(member.baseQuantity)>outstanding-others)conflict();
      return Object.freeze({...member,inventoryVersion:state.version,outstandingBaseQuantity:state.outstandingQuantity,availableBaseQuantity:(outstanding-others).toString()});
    });
    return Object.freeze({fulfillmentId:command.fulfillmentId,version:command.expectedVersion,sales,claims:Object.freeze(validated)});
  }
}
