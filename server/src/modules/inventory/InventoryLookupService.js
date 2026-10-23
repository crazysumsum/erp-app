import { assertActorFresh } from "../authorization/directoryLookups.js";
import { InventoryFulfillmentService } from "./InventoryFulfillmentService.js";
import { loadInventoryCandidates } from "./InventoryPickSequenceService.js";
import { inventoryError } from "./inventoryErrors.js";
import { fulfillmentInventoryFields,fulfillmentInventoryId } from "./inventoryFulfillmentValidation.js";
import { number } from "./inventoryFulfillmentStock.js";
import { readOriginalFulfillmentIssueBatch } from "./inventoryFulfillmentReceipts.js";

export class InventoryLookupService {
  constructor(options={}) {
    this.fulfillment=options.fulfillment??new InventoryFulfillmentService(options);
    this.time=options.time;
  }
  async #authorize(tx,permission="fulfillment.operation") {
    const current=this.fulfillment.assertTransaction(tx),claims=current.auth?.claims,actorId=Number(claims?.sub);
    if(!claims||!Number.isSafeInteger(actorId)||actorId<1||!Array.isArray(claims.roles)||!Array.isArray(claims.permissions))throw inventoryError("PERMISSION_STALE");
    const actor=await assertActorFresh(tx,{actorId,claimedRoles:claims.roles,claimedPermissions:claims.permissions});
    if(!actor.username||!["fulfillment.view",permission].every(p=>actor.permissions.includes(p)))throw inventoryError("PERMISSION_STALE");
    return actor;
  }
  async getFulfillmentReversalPreparationInTransaction(tx,query) {
    await this.#authorize(tx,"fulfillment.reverse");
    fulfillmentInventoryFields(query,["shipmentId","originalInventoryOperationIds"]);
    const shipmentId=fulfillmentInventoryId(query.shipmentId),ids=query.originalInventoryOperationIds;
    if(!Array.isArray(ids)||ids.length<1||ids.length>5000)throw inventoryError("INVENTORY_INPUT_INVALID");
    const operations=ids.map(id=>fulfillmentInventoryId(id));
    if(new Set(operations).size!==operations.length)throw inventoryError("INVENTORY_INPUT_INVALID");
    const original=await readOriginalFulfillmentIssueBatch(tx,{shipmentId,members:operations.map(originalInventoryOperationId=>({originalInventoryOperationId}))});
    const members=original.result.lines.flatMap(line=>line.reservations),expected=new Set(operations);
    if(members.length!==expected.size||members.some(m=>!expected.has(m.inventoryOperationId)))throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    const reservationIds=members.map(m=>m.inventoryReservationId),balanceIds=[...new Set(members.flatMap(m=>m.allocations.map(a=>a.inventoryBalanceId)))];
    const [reservations]=await tx.query(`SELECT * FROM inventory_reservations WHERE id IN (${reservationIds.map(()=>"?").join(",")}) ORDER BY id`,reservationIds);
    const [balances]=await tx.query(`SELECT * FROM inventory_stock_balances WHERE id IN (${balanceIds.map(()=>"?").join(",")}) ORDER BY id`,balanceIds);
    const byReservation=new Map(reservations.map(r=>[String(r.id),r])),byBalance=new Map(balances.map(b=>[String(b.id),b]));
    if(reservations.length!==reservationIds.length||balances.length!==balanceIds.length)throw inventoryError("REVERSAL_NOT_ALLOWED");
    // Advisory current CAS only: no preclaim/domain locks; the actual reverse must revalidate under its owner locks.
    const lines=original.result.lines.map(line=>({fulfillmentLineId:line.fulfillmentLineId,salesOrderLineId:line.salesOrderLineId,baseQuantity:line.baseQuantity,reservations:line.reservations.map(member=>{
      const r=byReservation.get(member.inventoryReservationId),currentState={originalQuantity:String(number(r.original_quantity)),consumedQuantity:String(number(r.consumed_quantity)),releasedQuantity:String(number(r.released_quantity)),outstandingQuantity:String(number(r.outstanding_quantity)),status:r.status,version:number(r.version)};
      if(!["CONSUMED","PARTIALLY_CONSUMED"].includes(r.status)||BigInt(currentState.originalQuantity)!==BigInt(currentState.consumedQuantity)+BigInt(currentState.releasedQuantity)+BigInt(currentState.outstandingQuantity)||BigInt(currentState.consumedQuantity)<BigInt(member.baseQuantity))throw inventoryError("REVERSAL_NOT_ALLOWED");
      return {claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,baseQuantity:member.baseQuantity,originalInventoryOperationId:member.inventoryOperationId,expectedVersion:currentState.version,currentState,
        allocations:member.allocations.map(a=>{const b=byBalance.get(a.inventoryBalanceId),bucket=a.bucketSnapshot;
          if(String(r.warehouse_id)!==bucket.warehouseId||String(r.sku_id)!==bucket.skuId||String(b.warehouse_id)!==bucket.warehouseId||String(b.bin_id)!==bucket.binId||(b.lot_id===null?null:String(b.lot_id))!==bucket.lotId||String(b.sku_id)!==bucket.skuId||b.stock_status!==bucket.stockStatus)throw inventoryError("REVERSAL_NOT_ALLOWED");
          return {inventoryAllocationId:a.inventoryAllocationId,originalMovementId:a.movementId,baseQuantity:a.baseQuantity,expectedBalanceVersion:number(b.version),bucketSnapshot:bucket};})};
    })}));
    return {fulfillmentId:original.fulfillmentId,shipmentId,originalOperationId:original.result.operationId,lines};
  }
  async lockFulfillmentReservationStatesInTransaction(tx,query) {
    return this.#lockFulfillmentReservationStates(tx,query,false);
  }
  // A source influence set can exceed the 5000 selected-command limit. All master/control anchors precede PK-ordered batches.
  // This read/lock proof does not authorize any later Inventory allocation or posting in the same transaction.
  async lockFulfillmentReservationScopeInTransaction(tx,query) {
    return this.#lockFulfillmentReservationStates(tx,query,true);
  }
  async #lockFulfillmentReservationStates(tx,query,completeScope) {
    await this.#authorize(tx);
    fulfillmentInventoryFields(query,["warehouseId","salesOrderId","members"]);
    const warehouseId=fulfillmentInventoryId(query.warehouseId),salesOrderId=fulfillmentInventoryId(query.salesOrderId);
    if(!Array.isArray(query.members)||query.members.length<1||!completeScope&&query.members.length>5000)throw inventoryError("INVENTORY_INPUT_INVALID");
    const seen=new Set(),members=query.members.map(member=>{
      fulfillmentInventoryFields(member,["inventoryReservationId","salesOrderLineId","skuId"]);
      const value={inventoryReservationId:fulfillmentInventoryId(member.inventoryReservationId),salesOrderLineId:fulfillmentInventoryId(member.salesOrderLineId),skuId:fulfillmentInventoryId(member.skuId)};
      if(seen.has(value.inventoryReservationId))throw inventoryError("INVENTORY_INPUT_INVALID");seen.add(value.inventoryReservationId);return value;
    }).sort((a,b)=>Number(a.inventoryReservationId)-Number(b.inventoryReservationId));
    const ids=members.map(m=>m.inventoryReservationId),read=batch=>tx.query(`SELECT r.*,o.source_module,o.source_document_type,o.source_document_id,o.source_line_id,o.source_event_id
      FROM inventory_reservations r JOIN inventory_operation_requests o ON o.id=r.create_operation_id
      WHERE r.id IN (${batch.map(()=>"?").join(",")}) ORDER BY r.id`,batch.map(member=>member.inventoryReservationId));
    const validate=(rows,batch)=>{
      if(rows.length!==batch.length)throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
      const byId=new Map(rows.map(row=>[String(row.id),row]));
      for(const member of batch) {
        const r=byId.get(member.inventoryReservationId);
        if(!r||String(r.warehouse_id)!==warehouseId||String(r.sku_id)!==member.skuId||r.purpose!=="SALE"||r.source_module!=="SALES"||r.source_document_type!=="SALES_ORDER"||r.source_document_id!==salesOrderId||r.source_line_id!==member.salesOrderLineId)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
        for(const key of ["original_quantity","consumed_quantity","released_quantity","outstanding_quantity"])number(r[key]);
        if(!["ACTIVE","PARTIALLY_CONSUMED"].includes(r.status)||number(r.outstanding_quantity)===0||BigInt(r.original_quantity)!==BigInt(r.consumed_quantity)+BigInt(r.released_quantity)+BigInt(r.outstanding_quantity))throw inventoryError("RESERVATION_STATE_CONFLICT");
      }
    };
    const batchSize=completeScope?500:members.length;
    for(let start=0;start<members.length;start+=batchSize){const batch=members.slice(start,start+batchSize),[before]=await read(batch);validate(before,batch);}
    const skuIds=[...new Set(members.map(m=>m.skuId))];
    const profiles=await this.fulfillment.itemLookup.getFulfillmentInventoryProfilesInTransaction(tx,skuIds,{atMs:this.time.nowMs()});
    if(profiles.some(p=>!p.usable||!p.inventoryTracked||p.trackingPolicy==="serial"))throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const locked=await this.fulfillment.locks.lockForCommand(tx,{warehouseIds:[number(warehouseId)],stockControls:skuIds.map(skuId=>({warehouseId:number(warehouseId),skuId:number(skuId)})),reservationIds:completeScope?[]:ids.map(Number),now:this.time.nowMs()});
    if(locked.warehouses.length!==1||locked.warehouses[0].status!=="ACTIVE")throw inventoryError("WAREHOUSE_INVALID");
    const current=[];
    for(let start=0;start<members.length;start+=batchSize){
      const batch=members.slice(start,start+batchSize);
      if(completeScope)await this.fulfillment.locks.lockForCommand(tx,{reservationIds:batch.map(member=>number(member.inventoryReservationId)),now:this.time.nowMs()});
      const [rows]=await read(batch);validate(rows,batch);current.push(...rows);
    }
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
