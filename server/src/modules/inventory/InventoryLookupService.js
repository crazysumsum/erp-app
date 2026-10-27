import { prepareFulfillmentAllocation,prepareFulfillmentReallocation,readFulfillmentReallocationStates,readFulfillmentAllocationScope,lockFulfillmentPickScope,normalizeFulfillmentAllocationScopeQuery } from "./inventoryFulfillmentAllocationPreparation.js";
import { readFulfillmentBatchCandidates } from "./inventoryFulfillmentCandidateAdvisory.js";
import { normalizeInventoryAllocationPreview,readFulfillmentAllocationPreview } from "./inventoryFulfillmentAllocationPreview.js";
import { normalizeReallocationAdvisoryQuery,readReallocationAdvisory } from "./inventoryFulfillmentReallocationAdvisory.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { InventoryFulfillmentService } from "./InventoryFulfillmentService.js";
import { loadInventoryCandidates } from "./InventoryPickSequenceService.js";
import { inventoryError } from "./inventoryErrors.js";
import { fulfillmentInventoryFields,fulfillmentInventoryId } from "./inventoryFulfillmentValidation.js";
import { number } from "./inventoryFulfillmentStock.js";
import { readOriginalFulfillmentIssueBatch } from "./inventoryFulfillmentReceipts.js";
import { InventoryPurchaseService } from "./InventoryPurchaseService.js";

export class InventoryLookupService {
  constructor(options={}) {
    this.fulfillment=options.fulfillment??new InventoryFulfillmentService(options);
    this.time=options.time;
    this.purchase=new InventoryPurchaseService(options);
  }
  findOperationsBySource(tx,query) { return this.purchase.findOperationsBySource(tx,query); }
  async #authorize(tx,permission="fulfillment.operation") {
    const current=this.fulfillment.assertTransaction(tx),claims=current.auth?.claims,actorId=Number(claims?.sub);
    if(!claims||!Number.isSafeInteger(actorId)||actorId<1||!Array.isArray(claims.roles)||!Array.isArray(claims.permissions))throw inventoryError("PERMISSION_STALE");
    const actor=await assertActorFresh(tx,{actorId,claimedRoles:claims.roles,claimedPermissions:claims.permissions});
    if(!actor.username||!["fulfillment.view",permission].every(p=>actor.permissions.includes(p)))throw inventoryError("PERMISSION_STALE");
    return actor;
  }
  async #lockReadAnchors(tx,warehouseId,inputSkuIds) {
    const skuIds=[...new Set(inputSkuIds)].sort((a,b)=>Number(a)-Number(b));
    const locked=await this.fulfillment.locks.lockForCommand(tx,{warehouseIds:[Number(warehouseId)]});
    if(locked.warehouses.length!==1||locked.warehouses[0].status!=="ACTIVE")throw inventoryError("WAREHOUSE_INVALID");
    // Read proofs must not use the writer's StockControl upsert, even as a no-op.
    const [rows]=await tx.query(`SELECT * FROM inventory_stock_controls WHERE warehouse_id=? AND sku_id IN (${skuIds.map(()=>"?").join(",")}) ORDER BY warehouse_id,sku_id FOR UPDATE`,[warehouseId,...skuIds]);
    const controls=new Map(rows.map(row=>[String(row.sku_id),row]));
    if(rows.length!==skuIds.length||controls.size!==skuIds.length||skuIds.some(skuId=>!controls.has(skuId)))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    return controls;
  }
  #assertReadControlCoverage(controls,reservations) {
    const totals=new Map();for(const row of reservations){const skuId=String(row.sku_id);totals.set(skuId,(totals.get(skuId)??0n)+BigInt(number(row.outstanding_quantity)));}
    for(const [skuId,total]of totals)if(!controls.has(skuId)||BigInt(number(controls.get(skuId).reserved_quantity))<total)throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
  }
  async hasFulfillmentAllocationHistoryInTransaction(tx,query) {
    await this.#authorize(tx);
    fulfillmentInventoryFields(query,["fulfillmentId"]);
    const fulfillmentId=fulfillmentInventoryId(query.fulfillmentId);
    let row;
    try { [[row]]=await tx.query("SELECT EXISTS(SELECT 1 FROM inventory_operation_requests o JOIN inventory_allocations a ON a.create_operation_id=o.id WHERE o.source_module='FULFILLMENT' AND o.source_document_type='PICK' AND o.source_document_id=?) AS present",[fulfillmentId]); }
    catch(error){if(["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error.cause?.code??error.code))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");throw error;}
    if(!row||![0,1].includes(Number(row.present)))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    return Number(row.present)===1;
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
    const controls=await this.#lockReadAnchors(tx,warehouseId,skuIds);
    if(!completeScope)await this.fulfillment.locks.lockForCommand(tx,{reservationIds:ids.map(Number)});
    const current=[];
    for(let start=0;start<members.length;start+=batchSize){
      const batch=members.slice(start,start+batchSize);
      if(completeScope)await this.fulfillment.locks.lockForCommand(tx,{reservationIds:batch.map(member=>number(member.inventoryReservationId)),now:this.time.nowMs()});
      const [rows]=await read(batch);validate(rows,batch);current.push(...rows);
    }
    this.#assertReadControlCoverage(controls,current);
    return Object.freeze(current.map(r=>Object.freeze({inventoryReservationId:String(r.id),warehouseId,skuId:String(r.sku_id),salesOrderId,salesOrderLineId:r.source_line_id,
      originalInventoryOperationId:String(r.create_operation_id),originalSourceEventId:r.source_event_id,originalQuantity:String(r.original_quantity),consumedQuantity:String(r.consumed_quantity),
      releasedQuantity:String(r.released_quantity),outstandingQuantity:String(r.outstanding_quantity),status:r.status,version:number(r.version),minimumRemainingDays:number(r.minimum_remaining_days)})));
  }
  // This read proof releases only local Claims; it authorizes no Inventory write.
  async lockFulfillmentCancellationReservationScopeInTransaction(tx,input) {
    fulfillmentInventoryFields(input,["warehouseId","salesOrderId","members"]);
    const warehouseId=fulfillmentInventoryId(input.warehouseId),salesOrderId=fulfillmentInventoryId(input.salesOrderId);
    if(!Array.isArray(input.members)||!input.members.length||input.members.length>5000)throw inventoryError("INVENTORY_INPUT_INVALID");
    const members=Object.freeze(input.members.map(member=>{
      fulfillmentInventoryFields(member,["inventoryReservationId","salesOrderLineId","skuId"]);
      return Object.freeze(Object.fromEntries(["inventoryReservationId","salesOrderLineId","skuId"].map(key=>[key,fulfillmentInventoryId(member[key])])));
    }).sort((a,b)=>Number(a.inventoryReservationId)-Number(b.inventoryReservationId)));
    if(new Set(members.map(row=>row.inventoryReservationId)).size!==members.length)throw inventoryError("INVENTORY_INPUT_INVALID");
    await this.#authorize(tx);
    try {
      const read=async batch=>{const [rows]=await tx.query(`SELECT r.id,r.warehouse_id,r.sku_id,r.create_operation_id,r.purpose,r.status,r.original_quantity,r.consumed_quantity,r.released_quantity,r.outstanding_quantity,r.version,o.source_module,o.source_document_type,o.source_document_id,o.source_line_id,o.source_event_id FROM inventory_reservations r JOIN inventory_operation_requests o ON o.id=r.create_operation_id WHERE r.id IN (${batch.map(()=>"?").join(",")}) ORDER BY r.id`,batch.map(row=>row.inventoryReservationId));return rows;};
      const validate=(rows,batch)=>{if(rows.length!==batch.length)throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
        for(const row of rows){const member=batch.find(value=>value.inventoryReservationId===String(row.id));if(!member||String(row.warehouse_id)!==warehouseId||String(row.sku_id)!==member.skuId||row.purpose!=="SALE"||row.source_module!=="SALES"||row.source_document_type!=="SALES_ORDER"||row.source_document_id!==salesOrderId||row.source_line_id!==member.salesOrderLineId)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
          for(const key of ["original_quantity","consumed_quantity","released_quantity","outstanding_quantity","version"])number(row[key]);if(!["ACTIVE","PARTIALLY_CONSUMED"].includes(row.status)||number(row.version)<1||number(row.version)>4294967295||number(row.outstanding_quantity)===0||BigInt(row.original_quantity)!==BigInt(row.consumed_quantity)+BigInt(row.released_quantity)+BigInt(row.outstanding_quantity))throw inventoryError("RESERVATION_STATE_CONFLICT");
        }};
      for(let start=0;start<members.length;start+=500){const batch=members.slice(start,start+500);validate(await read(batch),batch);}
      const skuIds=[...new Set(members.map(row=>row.skuId))].sort((a,b)=>Number(a)-Number(b)),profiles=await this.fulfillment.itemLookup.getFulfillmentInventoryProfilesInTransaction(tx,skuIds,{atMs:this.time.nowMs()});
      if(profiles.length!==skuIds.length)throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      const {warehouses}=await this.fulfillment.locks.lockForCommand(tx,{warehouseIds:[Number(warehouseId)]});if(warehouses.length!==1)throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      const [controls]=await tx.query(`SELECT id,warehouse_id,sku_id,reserved_quantity,version FROM inventory_stock_controls WHERE warehouse_id=? AND sku_id IN (${skuIds.map(()=>"?").join(",")}) ORDER BY warehouse_id,sku_id FOR UPDATE`,[warehouseId,...skuIds]);if(controls.length!==skuIds.length)throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      const current=[];
      for(let start=0;start<members.length;start+=500){const batch=members.slice(start,start+500),locked=await this.fulfillment.locks.lockForCommand(tx,{reservationIds:batch.map(row=>Number(row.inventoryReservationId))});if(locked.reservations.length!==batch.length)throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
        const rows=await read(batch);validate(rows,batch);current.push(...rows);
      }
      this.#assertReadControlCoverage(new Map(controls.map(row=>[String(row.sku_id),row])),current);
      return Object.freeze(current.map(row=>Object.freeze({inventoryReservationId:String(row.id),warehouseId,skuId:String(row.sku_id),salesOrderId,salesOrderLineId:row.source_line_id,originalInventoryOperationId:String(row.create_operation_id),originalSourceEventId:row.source_event_id,originalQuantity:String(row.original_quantity),consumedQuantity:String(row.consumed_quantity),releasedQuantity:String(row.released_quantity),outstandingQuantity:String(row.outstanding_quantity),version:number(row.version)})));
    }catch(error){if(["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error.cause?.code??error.code))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");throw error;}
  }
  async prepareFulfillmentAllocationInTransaction(tx,query) {
    const actor=await this.#authorize(tx);
    try{return await prepareFulfillmentAllocation(tx,query,{inventory:this.fulfillment,time:this.time,actor});}
    catch(error){if(["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error.cause?.code??error.code))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");throw error;}
  }
  async prepareFulfillmentReallocationInTransaction(tx,query) {
    const actor=await this.#authorize(tx);
    try{return await prepareFulfillmentReallocation(tx,query,{inventory:this.fulfillment,time:this.time,actor});}
    catch(error){if(["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error.cause?.code??error.code))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");throw error;}
  }
  async readFulfillmentReallocationStatesInTransaction(tx,query) {
    await this.#authorize(tx);
    try{return await readFulfillmentReallocationStates(tx,query);}
    catch(error){if(["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error.cause?.code??error.code))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");throw error;}
  }
  async readFulfillmentAllocationScopeInTransaction(tx,input) {
    const query=normalizeFulfillmentAllocationScopeQuery(input);await this.#authorize(tx);
    try{return await readFulfillmentAllocationScope(tx,query);}
    catch(error){if(["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error.cause?.code??error.code))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");throw error;}
  }
  async lockFulfillmentPickScopeInTransaction(tx,input) {
    const query=normalizeFulfillmentAllocationScopeQuery(input);await this.#authorize(tx);
    try{return await lockFulfillmentPickScope(tx,query,{inventory:this.fulfillment,time:this.time});}
    catch(error){if(["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error.cause?.code??error.code))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");throw error;}
  }
  async listFulfillmentBatchAllocationCandidates(tx,query) {
    await this.#authorize(tx);
    fulfillmentInventoryFields(query,["warehouseId","demands","asOf"]);
    const warehouseId=fulfillmentInventoryId(query.warehouseId);
    if(!Number.isSafeInteger(query.asOf)||query.asOf<0||!Array.isArray(query.demands)||!query.demands.length||query.demands.length>5000)throw inventoryError("INVENTORY_INPUT_INVALID");
    const seen=new Set(),claimIds=new Set(),lineCounts=new Map();
    const demands=query.demands.map(demand=>{
      fulfillmentInventoryFields(demand,["fulfillmentLineId","claimId","inventoryReservationId","skuId","requestedQuantity","page"]);
      const result=Object.fromEntries(["fulfillmentLineId","claimId","inventoryReservationId","skuId","requestedQuantity"].map(key=>[key,fulfillmentInventoryId(demand[key])]));
      const page=demand.page??1,count=(lineCounts.get(result.fulfillmentLineId)??0)+1;lineCounts.set(result.fulfillmentLineId,count);
      if(seen.has(result.inventoryReservationId)||claimIds.has(result.claimId)||count>50||lineCounts.size>100||!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(page*100))throw inventoryError("INVENTORY_INPUT_INVALID");
      seen.add(result.inventoryReservationId);claimIds.add(result.claimId);return {...result,page};
    }).sort((a,b)=>Number(a.fulfillmentLineId)-Number(b.fulfillmentLineId)||Number(a.inventoryReservationId)-Number(b.inventoryReservationId));
    const ids=[...seen].sort((a,b)=>Number(a)-Number(b)),[before]=await tx.query(`SELECT * FROM inventory_reservations WHERE id IN (${ids.map(()=>"?").join(",")}) ORDER BY id`,ids);
    if(before.length!==ids.length)throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const profiles=await this.fulfillment.itemLookup.getFulfillmentInventoryProfilesInTransaction(tx,[...new Set(demands.map(demand=>demand.skuId))],{atMs:this.time.nowMs()});
    const bySku=new Map(profiles.map(profile=>[profile.skuId,profile]));
    if(bySku.size!==profiles.length||bySku.size!==new Set(demands.map(demand=>demand.skuId)).size||demands.some(demand=>!bySku.has(demand.skuId))||profiles.some(profile=>!profile.usable||!profile.inventoryTracked||profile.trackingPolicy==="serial"))throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
    const controls=await this.#lockReadAnchors(tx,warehouseId,demands.map(demand=>demand.skuId));
    const locked=await this.fulfillment.locks.lockForCommand(tx,{reservationIds:ids.map(Number)});
    const reservations=new Map(locked.reservations.map(row=>[String(row.id),row]));
    if(reservations.size!==ids.length)throw inventoryError("CONCURRENT_OPERATION");
    for(const demand of demands){const row=reservations.get(demand.inventoryReservationId);if(!row||String(row.warehouse_id)!==warehouseId||String(row.sku_id)!==demand.skuId||row.purpose!=="SALE"||!["ACTIVE","PARTIALLY_CONSUMED"].includes(row.status)||BigInt(row.outstanding_quantity)<BigInt(demand.requestedQuantity)||!Number.isSafeInteger(Number(row.minimum_remaining_days))||Number(row.minimum_remaining_days)<0||Number(row.minimum_remaining_days)>36500)throw inventoryError("RESERVATION_STATE_CONFLICT");}
    this.#assertReadControlCoverage(controls,locked.reservations);
    return readFulfillmentBatchCandidates(tx,{warehouseId,demands,profiles:bySku,reservations,time:this.time});
  }
  async listFulfillmentReallocationCandidates(tx,input) {
    const query=normalizeReallocationAdvisoryQuery(input);await this.#authorize(tx);
    try{return await readReallocationAdvisory(tx,query,{inventory:this.fulfillment,time:this.time});}
    catch(error){if(["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error.cause?.code??error.code))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");throw error;}
  }
  async previewFulfillmentAllocationInTransaction(tx,input) {
    const query=normalizeInventoryAllocationPreview(input),actor=await this.#authorize(tx);
    try{
      const result=await readFulfillmentAllocationPreview(tx,query,{inventory:this.fulfillment,time:this.time,actor,readReservations:source=>this.lockFulfillmentReservationStatesInTransaction(tx,source)});
      await this.#authorize(tx);return result;
    }catch(error){if(["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error.cause?.code??error.code))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");throw error;}
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
