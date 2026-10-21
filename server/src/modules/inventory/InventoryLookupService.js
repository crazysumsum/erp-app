import { assertActorFresh } from "../authorization/directoryLookups.js";
import { InventoryFulfillmentService } from "./InventoryFulfillmentService.js";
import { loadInventoryCandidates } from "./InventoryPickSequenceService.js";
import { inventoryError } from "./inventoryErrors.js";
import { fulfillmentInventoryFields,fulfillmentInventoryId } from "./inventoryFulfillmentValidation.js";
import { number } from "./inventoryFulfillmentStock.js";

export class InventoryLookupService {
  constructor(options={}) {
    this.fulfillment=options.fulfillment??new InventoryFulfillmentService(options);
    this.time=options.time;
  }
  async #authorize(tx) {
    const current=this.fulfillment.assertTransaction(tx),claims=current.auth?.claims,actorId=Number(claims?.sub);
    if(!claims||!Number.isSafeInteger(actorId)||actorId<1||!Array.isArray(claims.roles)||!Array.isArray(claims.permissions))throw inventoryError("PERMISSION_STALE");
    const actor=await assertActorFresh(tx,{actorId,claimedRoles:claims.roles,claimedPermissions:claims.permissions});
    if(!actor.username||!["fulfillment.view","fulfillment.operation"].every(p=>actor.permissions.includes(p)))throw inventoryError("PERMISSION_STALE");
    return actor;
  }
  async lockFulfillmentReservationStatesInTransaction(tx,query) {
    await this.#authorize(tx);
    fulfillmentInventoryFields(query,["warehouseId","salesOrderId","members"]);
    const warehouseId=fulfillmentInventoryId(query.warehouseId),salesOrderId=fulfillmentInventoryId(query.salesOrderId);
    if(!Array.isArray(query.members)||query.members.length<1||query.members.length>5000)throw inventoryError("INVENTORY_INPUT_INVALID");
    const seen=new Set(),members=query.members.map(member=>{
      fulfillmentInventoryFields(member,["inventoryReservationId","salesOrderLineId","skuId"]);
      const value={inventoryReservationId:fulfillmentInventoryId(member.inventoryReservationId),salesOrderLineId:fulfillmentInventoryId(member.salesOrderLineId),skuId:fulfillmentInventoryId(member.skuId)};
      if(seen.has(value.inventoryReservationId))throw inventoryError("INVENTORY_INPUT_INVALID");seen.add(value.inventoryReservationId);return value;
    }).sort((a,b)=>Number(a.inventoryReservationId)-Number(b.inventoryReservationId));
    const ids=members.map(m=>m.inventoryReservationId),read=()=>tx.query(`SELECT r.*,o.source_module,o.source_document_type,o.source_document_id,o.source_line_id,o.source_event_id
      FROM inventory_reservations r JOIN inventory_operation_requests o ON o.id=r.create_operation_id
      WHERE r.id IN (${ids.map(()=>"?").join(",")}) ORDER BY r.id`,ids);
    const validate=rows=>{
      if(rows.length!==members.length)throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
      const byId=new Map(rows.map(row=>[String(row.id),row]));
      for(const member of members) {
        const r=byId.get(member.inventoryReservationId);
        if(!r||String(r.warehouse_id)!==warehouseId||String(r.sku_id)!==member.skuId||r.purpose!=="SALE"||r.source_module!=="SALES"||r.source_document_type!=="SALES_ORDER"||r.source_document_id!==salesOrderId||r.source_line_id!==member.salesOrderLineId)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
        for(const key of ["original_quantity","consumed_quantity","released_quantity","outstanding_quantity"])number(r[key]);
        if(!["ACTIVE","PARTIALLY_CONSUMED"].includes(r.status)||number(r.outstanding_quantity)===0||BigInt(r.original_quantity)!==BigInt(r.consumed_quantity)+BigInt(r.released_quantity)+BigInt(r.outstanding_quantity))throw inventoryError("RESERVATION_STATE_CONFLICT");
      }
    };
    const [before]=await read();validate(before);
    const skuIds=[...new Set(members.map(m=>m.skuId))];
    const profiles=await this.fulfillment.itemLookup.getFulfillmentInventoryProfilesInTransaction(tx,skuIds,{atMs:this.time.nowMs()});
    if(profiles.some(p=>!p.usable||!p.inventoryTracked||p.trackingPolicy==="serial"))throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const locked=await this.fulfillment.locks.lockForCommand(tx,{warehouseIds:[number(warehouseId)],stockControls:skuIds.map(skuId=>({warehouseId:number(warehouseId),skuId:number(skuId)})),reservationIds:ids.map(Number),now:this.time.nowMs()});
    if(locked.warehouses.length!==1||locked.warehouses[0].status!=="ACTIVE")throw inventoryError("WAREHOUSE_INVALID");
    const [current]=await read();validate(current);
    return Object.freeze(current.map(r=>Object.freeze({inventoryReservationId:String(r.id),warehouseId,skuId:String(r.sku_id),salesOrderId,salesOrderLineId:r.source_line_id,
      originalInventoryOperationId:String(r.create_operation_id),originalSourceEventId:r.source_event_id,originalQuantity:String(r.original_quantity),consumedQuantity:String(r.consumed_quantity),
      releasedQuantity:String(r.released_quantity),outstandingQuantity:String(r.outstanding_quantity),status:r.status,version:number(r.version),minimumRemainingDays:number(r.minimum_remaining_days)})));
  }
  async listAllocationCandidates(tx,query) {
    await this.#authorize(tx);
    fulfillmentInventoryFields(query,["warehouseId","demands","asOf"]);
    const warehouseId=fulfillmentInventoryId(query.warehouseId);
    if(!Number.isSafeInteger(query.asOf)||query.asOf<0||!Array.isArray(query.demands)||query.demands.length<1||query.demands.length>5000)throw inventoryError("INVENTORY_INPUT_INVALID");
    const seen=new Set();
    const demands=query.demands.map(demand=>{
      fulfillmentInventoryFields(demand,["inventoryReservationId","skuId","minimumRemainingDays","requestedQuantity","page"]);
      const inventoryReservationId=fulfillmentInventoryId(demand.inventoryReservationId),skuId=fulfillmentInventoryId(demand.skuId),requestedQuantity=fulfillmentInventoryId(demand.requestedQuantity);
      const page=demand.page??1;
      if(seen.has(inventoryReservationId)||!Number.isSafeInteger(demand.minimumRemainingDays)||demand.minimumRemainingDays<0||demand.minimumRemainingDays>36500||!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger((page-1)*100))throw inventoryError("INVENTORY_INPUT_INVALID");
      seen.add(inventoryReservationId);return {inventoryReservationId,skuId,requestedQuantity,minimumRemainingDays:demand.minimumRemainingDays,page};
    }).sort((a,b)=>Number(a.inventoryReservationId)-Number(b.inventoryReservationId));
    const ids=demands.map(d=>d.inventoryReservationId);
    const [reservations]=await tx.query(`SELECT * FROM inventory_reservations WHERE id IN (${ids.map(()=>"?").join(",")}) ORDER BY id`,ids);
    if(reservations.length!==ids.length)throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    for(const demand of demands) {
      const r=reservations.find(r=>String(r.id)===demand.inventoryReservationId);
      if(String(r.warehouse_id)!==warehouseId||String(r.sku_id)!==demand.skuId||number(r.minimum_remaining_days)!==demand.minimumRemainingDays||r.purpose!=="SALE"||!["ACTIVE","PARTIALLY_CONSUMED"].includes(r.status))throw inventoryError("RESERVATION_STATE_CONFLICT");
    }
    const profiles=await this.fulfillment.itemLookup.getFulfillmentInventoryProfilesInTransaction(tx,[...new Set(demands.map(d=>d.skuId))],{atMs:this.time.nowMs()});
    if(profiles.some(p=>!p.usable||!p.inventoryTracked||p.trackingPolicy==="serial"))throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const locked=await this.fulfillment.locks.lockForCommand(tx,{warehouseIds:[number(warehouseId)],stockControls:demands.map(d=>({warehouseId:number(warehouseId),skuId:number(d.skuId)})),reservationIds:ids.map(Number),now:this.time.nowMs()});
    if(locked.warehouses.length!==1||locked.warehouses[0].status!=="ACTIVE")throw inventoryError("WAREHOUSE_INVALID");
    if(locked.reservations.length!==ids.length)throw inventoryError("CONCURRENT_OPERATION");
    for(const demand of demands){const r=locked.reservations.find(r=>String(r.id)===demand.inventoryReservationId);if(String(r.warehouse_id)!==warehouseId||String(r.sku_id)!==demand.skuId||number(r.minimum_remaining_days)!==demand.minimumRemainingDays||r.purpose!=="SALE"||!["ACTIVE","PARTIALLY_CONSUMED"].includes(r.status))throw inventoryError("RESERVATION_STATE_CONFLICT");}
    const result=[],pages=new Map();
    for(const demand of demands) {
      const profile=profiles.find(p=>p.skuId===demand.skuId);let remaining=number(demand.requestedQuantity),rows=[];
      for(let page=1;page<=demand.page;page++) {
        const key=`${demand.skuId}:${demand.minimumRemainingDays}:${page}`;
        rows=pages.get(key);
        if(!rows){rows=await loadInventoryCandidates(tx,{warehouseId:number(warehouseId),skuId:number(demand.skuId),currentDate:this.time.fileDate(),minimumRemainingDays:demand.minimumRemainingDays,
          trackingPolicy:profile.trackingPolicy,limit:101,offset:(page-1)*100});pages.set(key,rows);}
        if(page<demand.page)for(const candidate of rows.slice(0,100))remaining=Math.max(0,remaining-candidate.freeQuantity);
        if(page<demand.page&&rows.length<=100){rows=[];break;}
      }
      const candidates=rows.slice(0,100).map((candidate,index)=>{
        const recommendedQuantity=Math.min(remaining,candidate.freeQuantity);remaining-=recommendedQuantity;
        return {inventoryBalanceId:String(candidate.id),binId:String(candidate.binId),binCode:candidate.binCode,lotId:candidate.lotId===null?null:String(candidate.lotId),expiryDate:candidate.expiryDate,
          firstReceiptDate:candidate.firstReceiptDate,fifoAnchorDate:candidate.fifoAnchorDate,freeQuantity:String(candidate.freeQuantity),expectedBalanceVersion:candidate.version,
          selectionStrategy:candidate.expiryDate?"FEFO":"FIFO",rank:(demand.page-1)*100+index+1,eligible:true,recommendedQuantity:String(recommendedQuantity)};
      });
      result.push({inventoryReservationId:demand.inventoryReservationId,skuId:demand.skuId,expectedReservationVersion:number(locked.reservations.find(r=>String(r.id)===demand.inventoryReservationId).version),
        requestedQuantity:demand.requestedQuantity,minimumRemainingDays:demand.minimumRemainingDays,baseUom:profile.baseUom,page:demand.page,hasMore:rows.length>100,candidates});
    }
    return {warehouseId,asOf:this.time.nowMs(),demands:result};
  }
}
