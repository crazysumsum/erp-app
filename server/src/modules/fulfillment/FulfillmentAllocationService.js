import { randomUUID } from "node:crypto";
import { normalizeFulfillmentReallocation } from "./fulfillmentReallocationCommand.js";
import { normalizeFulfillmentAllocation } from "./fulfillmentAllocationCommand.js";
import { allocationPreparationQuery,reallocationPreparationQuery,assertAllocationSourceFacts,assertPreparedFulfillmentAllocation,assertPreparedFulfillmentReallocation } from "./fulfillmentAllocationScope.js";
import { fulfillmentAllocationProjectionRows,fulfillmentReallocationProjectionRows,assertReallocationOwnerStates } from "./fulfillmentAllocationReceipt.js";
import { FulfillmentOperationService } from "./FulfillmentOperationService.js";
import { FulfillmentInquiryService } from "./FulfillmentInquiryService.js";
import { assertFulfillmentCandidateResult } from "./fulfillmentCandidateResult.js";
import { reallocationAdvisoryQuery,assertReallocationAdvisoryResult } from "./fulfillmentReallocationAdvisory.js";
import { normalizeFulfillmentAllocationPreview,fulfillmentAllocationPreviewScope,assertFulfillmentAllocationPreviewResult } from "./fulfillmentAllocationPreview.js";
import { FulfillmentTransactionService } from "./FulfillmentTransactionService.js";
import { FulfillmentLockService,lockFulfillmentRowsInTransaction } from "./FulfillmentLockService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { SalesFulfillmentService } from "../sales/SalesFulfillmentService.js";
import { InventoryLookupService } from "../inventory/InventoryLookupService.js";
import { ItemLookupService } from "../item/ItemLookupService.js";

export function normalizeFulfillmentCandidateQuery(input) {
  if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).some(key=>!["version","page"].includes(key))||!Number.isSafeInteger(input.version)||input.version<1||input.version>4294967295||input.page!==undefined&&(!Number.isSafeInteger(input.page)||input.page<1||!Number.isSafeInteger(input.page*100)))throw fulfillmentError("FULFILLMENT_INPUT_INVALID");
  return {version:input.version,page:input.page??1};
}
export class FulfillmentAllocationService {
  constructor({database,time,logger}) {
    Object.assign(this,{database,time,logger});this.transactions=new FulfillmentTransactionService({database});
    this.operations=new FulfillmentOperationService({database,time});this.inquiry=new FulfillmentInquiryService({database});
    this.sales=new SalesFulfillmentService({database,time,logger});this.inventoryLookup=new InventoryLookupService({database,time,logger});
    this.inventory=this.inventoryLookup.fulfillment;
    this.locks=new FulfillmentLockService({database,time,sales:this.sales,inventoryLookup:this.inventoryLookup,itemLookup:new ItemLookupService({database,time,logger})});
  }
  async candidates(fulfillmentId,input) {
    const query=normalizeFulfillmentCandidateQuery(input);fulfillmentInteger(fulfillmentId);
    return this.transactions.withTransaction(async tx=>{
      const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.operation");
      const [[header]]=await tx.query("SELECT sales_order_id FROM fulfillments WHERE id=?",[fulfillmentId]);
      if(!header)throw fulfillmentError("FULFILLMENT_NOT_FOUND");
      const order=await this.sales.getOrderForFulfillment(String(header.sales_order_id),{atMs:this.time.nowMs()});
      const [lines]=await tx.query("SELECT * FROM fulfillment_lines WHERE fulfillment_id=? ORDER BY id",[fulfillmentId]);
      const [claims]=await tx.query("SELECT * FROM fulfillment_line_reservation_claims WHERE fulfillment_id=? ORDER BY id",[fulfillmentId]);
      if(!lines.length||lines.length>100||!claims.length||claims.length>5000)throw fulfillmentError("RESERVATION_CLAIM_CONFLICT");
      const scope=lines.map(line=>{
        const members=claims.filter(claim=>String(claim.fulfillment_line_id)===String(line.id));
        if(!members.length||members.length>50||members.some(claim=>claim.status!=="ACTIVE"||String(claim.original_claimed_quantity)!==String(claim.active_claimed_quantity)||BigInt(claim.released_quantity)!==0n||BigInt(claim.consumed_quantity)!==0n||BigInt(claim.reversed_quantity)!==0n)||members.reduce((sum,claim)=>sum+fulfillmentInteger(String(claim.active_claimed_quantity)),0n)!==BigInt(line.planned_base_quantity))throw fulfillmentError("RESERVATION_CLAIM_CONFLICT");
        return {fulfillmentLineId:String(line.id),salesOrderLineId:String(line.sales_order_line_id),baseQuantity:String(line.planned_base_quantity),reservations:members.map(claim=>({inventoryReservationId:String(claim.inventory_reservation_id),baseQuantity:String(claim.active_claimed_quantity)}))};
      });
      if(claims.some(claim=>!lines.some(line=>String(line.id)===String(claim.fulfillment_line_id))))throw fulfillmentError("RESERVATION_CLAIM_CONFLICT");
      const intent={actor:{userId:String(actor.id),serviceName:"",claimedRoles:actor.roles,claimedPermissions:actor.permissions},purpose:"CLAIM",salesOrderId:order.orderId,expectedOrderVersion:order.version,lines:scope.map(line=>{
        const source=order.lines.find(row=>row.lineId===line.salesOrderLineId);if(!source)throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
        return {salesOrderLineId:source.lineId,expectedVersion:source.version,baseQuantity:line.baseQuantity,reservations:line.reservations.map(member=>{
          const mapping=source.reservationMappings.find(row=>row.inventoryReservationId===member.inventoryReservationId),claim=claims.find(row=>String(row.inventory_reservation_id)===member.inventoryReservationId);if(!mapping||!claim)throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
          return {...member,claimId:String(claim.id),expectedVersion:mapping.inventoryVersion};
        })};
      })};
      intent.lines.sort((a,b)=>BigInt(a.salesOrderLineId)<BigInt(b.salesOrderLineId)?-1:1);
      for(const line of intent.lines)line.reservations.sort((a,b)=>BigInt(a.inventoryReservationId)<BigInt(b.inventoryReservationId)?-1:1);
      const proof=await this.locks.lockClaimCapacityInTransaction(tx,{salesIntent:intent,fulfillmentId,expectedVersion:query.version,lines:scope});
      const demands=proof.claims.map(member=>({fulfillmentLineId:member.fulfillmentLineId,claimId:String(claims.find(claim=>String(claim.inventory_reservation_id)===member.inventoryReservationId).id),inventoryReservationId:member.inventoryReservationId,skuId:member.skuId,requestedQuantity:member.baseQuantity,page:query.page}));
      let result;
      try{result=await this.inventoryLookup.listFulfillmentBatchAllocationCandidates(tx,{warehouseId:proof.sales.warehouse.id,demands,asOf:this.time.nowMs()});}
      catch(error){if(["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error.cause?.code??error.code))throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");throw error;}
      assertFulfillmentCandidateResult(result,demands,proof.claims,proof.sales.warehouse.id,new Map(lines.map(line=>[String(line.id),String(line.base_uom_id)])));
      return {fulfillmentId,version:query.version,...result};
    });
  }
  authorizeWrite(){return this.transactions.withTransaction(tx=>requireFulfillmentActor(this.database,tx,"fulfillment.operation")).then(()=>true);}
  preview(fulfillmentId,input){
    fulfillmentInteger(fulfillmentId);const request=normalizeFulfillmentAllocationPreview(input),correlationId=randomUUID();
    return this.transactions.withTransaction(async tx=>{
      const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.operation"),preflight=await this.#readAllocationSnapshot(tx,fulfillmentId,true),requested=fulfillmentAllocationPreviewScope(preflight,request,this.time.nowMs()),reallocate=requested.purpose==="REALLOCATE",order=await this.sales.getOrderForFulfillment(requested.salesOrderId,{atMs:requested.asOf}),intent=this.#allocationSalesIntent(actor,order,requested);
      intent.lines.sort((a,b)=>Number(a.salesOrderLineId)-Number(b.salesOrderLineId));
      const proof=await this.sales.lockLinesForFulfillmentInTransaction(tx,intent);
      if(proof.replay!==false||!proof.order)throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
      const snapshot=await this.#lockAllocationSnapshot(tx,proof.order,fulfillmentId,reallocate),[[history]]=await tx.query("SELECT COALESCE(MAX(sequence_no),0) AS sequence FROM fulfillment_status_history WHERE fulfillment_id=?",[fulfillmentId]);snapshot.historySequence=Number(history.sequence);
      const locked=fulfillmentAllocationPreviewScope(snapshot,request,requested.asOf);
      if(JSON.stringify(locked)!==JSON.stringify(requested))throw fulfillmentError("VERSION_CONFLICT");
      const source=await this.sales.readLockedFulfillmentClaimSourceFactsInTransaction(tx,intent);let result;
      try{result=await this.inventoryLookup.previewFulfillmentAllocationInTransaction(tx,locked);}catch(error){
        if(["ALLOCATION_STATE_CONFLICT","INVENTORY_SOURCE_CONFLICT","INVENTORY_QUANTITY_INVALID"].includes(error.code))await this.#validateInventoryContract(()=>{throw error;},correlationId);
        if(error.code==="INVENTORY_DEPENDENCY_UNAVAILABLE")throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");throw error;
      }
      const projection=await this.#validateInventoryContract(()=>assertFulfillmentAllocationPreviewResult(result,snapshot,locked,source,actor),correlationId);
      assertAllocationSourceFacts(snapshot,snapshot.allClaims,source,result.reservationFacts);
      await requireFulfillmentActor(this.database,tx,"fulfillment.operation");return projection;
    });
  }
  reallocationCandidates(fulfillmentId,input){
    fulfillmentInteger(fulfillmentId);const query=normalizeFulfillmentCandidateQuery(input),correlationId=randomUUID();
    return this.transactions.withTransaction(async tx=>{
      const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.operation"),preflight=await this.#readAllocationSnapshot(tx,fulfillmentId,true),requested=reallocationAdvisoryQuery(preflight,query,this.time.nowMs()),order=await this.sales.getOrderForFulfillment(requested.salesOrderId,{atMs:this.time.nowMs()}),intent=this.#allocationSalesIntent(actor,order,requested),salesProof=await this.sales.lockLinesForFulfillmentInTransaction(tx,intent);
      if(salesProof.replay!==false||!salesProof.order)throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
      const snapshot=await this.#lockAllocationSnapshot(tx,salesProof.order,fulfillmentId,true),locked=reallocationAdvisoryQuery(snapshot,query,requested.asOf);
      if(JSON.stringify(locked)!==JSON.stringify(requested))throw fulfillmentError("VERSION_CONFLICT");
      const source=await this.sales.readLockedFulfillmentClaimSourceFactsInTransaction(tx,intent);let result;
      try{result=await this.inventoryLookup.listFulfillmentReallocationCandidates(tx,locked);}catch(error){
        if(["ALLOCATION_STATE_CONFLICT","INVENTORY_SOURCE_CONFLICT","INVENTORY_QUANTITY_INVALID"].includes(error.code))await this.#validateInventoryContract(()=>{throw error;},correlationId);
        if(error.code==="INVENTORY_DEPENDENCY_UNAVAILABLE")throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");throw error;
      }
      const projection=await this.#validateInventoryContract(()=>assertReallocationAdvisoryResult(result,snapshot,locked,source),correlationId);
      assertAllocationSourceFacts(snapshot,snapshot.allClaims,source,result.scope.reservationFacts);
      await requireFulfillmentActor(this.database,tx,"fulfillment.operation");
      return {fulfillmentId,version:query.version,...projection};
    });
  }
  async #readAllocationSnapshot(tx,id,reallocate=false){
    const [[header]]=await tx.query("SELECT * FROM fulfillments WHERE id=?",[id]);
    if(!header)throw fulfillmentError("FULFILLMENT_NOT_FOUND");
    const [lines]=await tx.query("SELECT * FROM fulfillment_lines WHERE fulfillment_id=? ORDER BY id",[id]),[claims]=await tx.query("SELECT * FROM fulfillment_line_reservation_claims WHERE fulfillment_id=? ORDER BY id",[id]);
    return {header,lines,claims,...(reallocate?await this.#allocationEffects(tx,id):{})};
  }
  async #allocationEffects(tx,id,locking=false){
    const [rows]=await tx.query("SELECT * FROM fulfillment_allocations WHERE fulfillment_id=? AND allocated_base_quantity>released_base_quantity ORDER BY id LIMIT 5001",[id]);if(rows.length>5000)throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
    const allocations=locking?await lockFulfillmentRowsInTransaction(tx,"fulfillment_allocations",rows.map(row=>row.id)):rows;
    const [allocationTotals]=await tx.query("SELECT fulfillment_line_id,SUM(allocated_base_quantity) AS allocated,SUM(released_base_quantity) AS released,SUM(picked_base_quantity) AS picked FROM fulfillment_allocations WHERE fulfillment_id=? GROUP BY fulfillment_line_id ORDER BY fulfillment_line_id",[id]);
    return {allocations,allocationTotals};
  }
  #allocationSalesIntent(actor,order,payload){
    return {actor:{userId:String(actor.id),serviceName:"",claimedRoles:actor.roles,claimedPermissions:actor.permissions},purpose:"CLAIM",salesOrderId:order.orderId,expectedOrderVersion:order.version,lines:payload.lines.map(line=>{
      const source=order.lines.find(row=>row.lineId===line.salesOrderLineId);if(!source)throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
      return {salesOrderLineId:line.salesOrderLineId,expectedVersion:source.version,baseQuantity:line.baseQuantity,reservations:line.reservations.map(member=>{const mapping=source.reservationMappings.find(row=>row.inventoryReservationId===member.inventoryReservationId);if(!mapping)throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");return {claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,expectedVersion:mapping.inventoryVersion,baseQuantity:member.baseQuantity};})};
    })};
  }
  async #lockAllocationSnapshot(tx,order,id,reallocate=false){
    const [ids]=await tx.query("SELECT id FROM fulfillments WHERE sales_order_id=? ORDER BY id",[order.orderId]),roots=await lockFulfillmentRowsInTransaction(tx,"fulfillments",ids.map(row=>row.id)),header=roots.find(row=>String(row.id)===id);
    if(!header)throw fulfillmentError("FULFILLMENT_NOT_FOUND");
    if(String(header.customer_id)!==order.customer.id||String(header.warehouse_id)!==order.warehouse.id)throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
    const rootIds=roots.map(row=>String(row.id)),marks=rootIds.map(()=>"?").join(","),[lineIds]=await tx.query(`SELECT id FROM fulfillment_lines WHERE fulfillment_id IN (${marks}) ORDER BY id`,rootIds),allLines=await lockFulfillmentRowsInTransaction(tx,"fulfillment_lines",lineIds.map(row=>row.id)),[claimIds]=await tx.query(`SELECT id FROM fulfillment_line_reservation_claims WHERE fulfillment_id IN (${marks}) ORDER BY id`,rootIds),allClaims=await lockFulfillmentRowsInTransaction(tx,"fulfillment_line_reservation_claims",claimIds.map(row=>row.id));
    const [[effects]]=await tx.query("SELECT EXISTS(SELECT 1 FROM fulfillment_allocations WHERE fulfillment_id=?) AS allocations,EXISTS(SELECT 1 FROM shipments WHERE fulfillment_id=?) AS shipments,EXISTS(SELECT 1 FROM fulfillment_status_history WHERE fulfillment_id=? AND action<>'CREATE') AS history",[id,id,id]);
    if(reallocate){
      const [[invalid]]=await tx.query("SELECT EXISTS(SELECT 1 FROM fulfillment_status_history WHERE fulfillment_id=? AND action NOT IN ('CREATE','UPDATE','ALLOCATE')) AS present",[id]);if(Number(effects.shipments)||Number(invalid.present))throw fulfillmentError("FULFILLMENT_STATE_CONFLICT");
    }else if(Number(effects.allocations)||Number(effects.shipments)||Number(effects.history)||await this.inventoryLookup.hasFulfillmentAllocationHistoryInTransaction(tx,{fulfillmentId:id}))throw fulfillmentError("FULFILLMENT_STATE_CONFLICT");
    return {header,lines:allLines.filter(row=>String(row.fulfillment_id)===id),claims:allClaims.filter(row=>String(row.fulfillment_id)===id),allClaims,...(reallocate?await this.#allocationEffects(tx,id,true):{})};
  }
  async #saveAllocationProjections(tx,rows,snapshot,result,at,reallocate=false){
    const columns=Object.keys(rows[0]);
    for(let start=0;start<rows.length;start+=100){const batch=rows.slice(start,start+100);await tx.execute(`INSERT INTO fulfillment_allocations (${columns.join(",")}) VALUES ${batch.map(()=>`(${columns.map(()=>"?").join(",")})`).join(",")}`,batch.flatMap(row=>columns.map(column=>row[column])));}
    const versions=new Map(result.lines.flatMap(line=>line.reservations.map(member=>[member.claimId,member.version])));
    for(let start=0;start<snapshot.claims.length;start+=100){
      const batch=snapshot.claims.slice(start,start+100),[updated]=await tx.execute(`UPDATE fulfillment_line_reservation_claims SET inventory_version=CASE id ${batch.map(()=>"WHEN ? THEN ?").join(" ")} END,updated_at=? WHERE fulfillment_id=? AND (${batch.map(()=>"(id=? AND inventory_version=?)").join(" OR ")})`,[...batch.flatMap(row=>[row.id,versions.get(String(row.id))]),at,snapshot.header.id,...batch.flatMap(row=>[row.id,row.inventory_version])]);if(updated.affectedRows!==batch.length)throw fulfillmentError("VERSION_CONFLICT");
    }
    for(const line of snapshot.lines){const [updated]=await tx.execute(`UPDATE fulfillment_lines SET allocated_base_quantity=${reallocate?"allocated_base_quantity+planned_base_quantity":"planned_base_quantity"},version=version+1,updated_at=? WHERE id=? AND version=? AND allocated_base_quantity=?`,[at,line.id,line.version,line.allocated_base_quantity]);if(updated.affectedRows!==1)throw fulfillmentError("VERSION_CONFLICT");}
  }
  async #saveReleasedProjections(tx,updates,snapshot,at){
    const prior=new Map(snapshot.allocations.map(row=>[String(row.id),row]));
    for(let start=0;start<updates.length;start+=100){const batch=updates.slice(start,start+100),cases=()=>`CASE id ${batch.map(()=>"WHEN ? THEN ?").join(" ")} END`,[changed]=await tx.execute(`UPDATE fulfillment_allocations SET released_base_quantity=allocated_base_quantity,status='RELEASED',inventory_version=${cases()},balance_version=${cases()},updated_at=? WHERE fulfillment_id=? AND (${batch.map(()=>"(id=? AND inventory_version=? AND released_base_quantity=? AND picked_base_quantity=0)").join(" OR ")})`,[...batch.flatMap(row=>[row.id,row.inventoryVersion]),...batch.flatMap(row=>[row.id,row.balanceVersion]),at,snapshot.header.id,...batch.flatMap(row=>[row.id,row.priorVersion,prior.get(row.id).released_base_quantity])]);if(changed.affectedRows!==batch.length)throw fulfillmentError("VERSION_CONFLICT");}
  }
  async #saveSequenceAudits(tx,projections,actor,request,requestHash,at){
    const rows=projections.filter(row=>row.is_sequence_override===1).map(row=>{
      const recommendation=JSON.parse(row.recommended_summary);
      return {target_type:"FULFILLMENT",target_id:row.fulfillment_id,action:"SEQUENCE_OVERRIDE",event_id:request.eventId,correlation_id:request.correlationId,actor_user_id:actor.id,actor_label:actor.username,before_summary:JSON.stringify({inventoryBalanceId:recommendation.recommendedBalanceId,recommendedRank:1,selectionStrategy:recommendation.recommendedExpiryDate?"FEFO":"FIFO"}),after_summary:JSON.stringify({claimId:row.claim_id,inventoryReservationId:row.inventory_reservation_id,inventoryAllocationId:row.inventory_allocation_id,inventoryBalanceId:row.inventory_balance_id,actualRank:row.recommended_rank_snapshot,selectionStrategy:row.selection_strategy,isSequenceOverride:true,allocatedQuantity:row.allocated_base_quantity}),details:JSON.stringify({fulfillmentId:row.fulfillment_id,requestHash}),occurred_at:at};
    });
    if(!rows.length)return;const columns=Object.keys(rows[0]);
    for(let start=0;start<rows.length;start+=100){const batch=rows.slice(start,start+100);await tx.execute(`INSERT INTO fulfillment_audit_logs (${columns.join(",")}) VALUES ${batch.map(()=>`(${columns.map(()=>"?").join(",")})`).join(",")}`,batch.flatMap(row=>columns.map(column=>row[column])));}
  }
  async #validateInventoryContract(validate,correlationId){
    try{return validate();}catch{
      // One low-cardinality critical event per mismatch supports the existing log-based metrics convention.
      await this.logger.error("fulfillment.inventory_contract_mismatch","Critical Inventory owner contract mismatch",{severity:"critical",code:"INVENTORY_CONTRACT_MISMATCH",correlationId});
      throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE",{correlationId});
    }
  }
  allocate(fulfillmentId,input){return this.#writeAllocation(fulfillmentId,input,false);}
  reallocate(fulfillmentId,input){return this.#writeAllocation(fulfillmentId,input,true);}
  async #writeAllocation(fulfillmentId,input,reallocate){
    const action=reallocate?"REALLOCATE":"ALLOCATE",scope=reallocate?reallocationPreparationQuery:allocationPreparationQuery;
    fulfillmentInteger(fulfillmentId);const command=(reallocate?normalizeFulfillmentReallocation:normalizeFulfillmentAllocation)(input),request={eventId:command.eventId,operationType:action,target:{type:"FULFILLMENT",id:fulfillmentId},payload:command,leaseOwner:randomUUID(),correlationId:randomUUID()};
    const outcome=await this.transactions.withTransaction(async tx=>{
      const operation=await this.operations.claimInTransaction(tx,request);
      if(operation.replay){if(operation.status==="FAILED")throw fulfillmentError(operation.publicErrorCode,operation.publicErrorDetails);return operation.result;}
      if(!operation.created)throw fulfillmentError("CONCURRENT_OPERATION");
      const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.operation"),preflight=await this.#readAllocationSnapshot(tx,fulfillmentId,reallocate),query=scope(preflight,command);
      let prepared;try{prepared=await this.inventoryLookup[reallocate?"prepareFulfillmentReallocationInTransaction":"prepareFulfillmentAllocationInTransaction"](tx,query);}
      catch(error){if(error.code==="INVENTORY_DEPENDENCY_UNAVAILABLE")throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");throw error;}
      await this.#validateInventoryContract(()=>reallocate?assertPreparedFulfillmentReallocation(prepared,query,preflight):assertPreparedFulfillmentAllocation(prepared,query),request.correlationId);
      const inventoryCommand={actor:{userId:actor.id,serviceName:"",claimedRoles:actor.roles,claimedPermissions:actor.permissions},source:{documentId:fulfillmentId,eventId:command.eventId},correlationId:request.correlationId,payload:prepared.payload},inventoryProof=await this.inventory.claimFulfillmentBatchInTransaction(tx,{action,command:inventoryCommand});
      const order=await this.sales.getOrderForFulfillment(query.salesOrderId,{atMs:this.time.nowMs()}),salesIntent=this.#allocationSalesIntent(actor,order,prepared.payload),salesProof=await this.sales.lockLinesForFulfillmentInTransaction(tx,salesIntent);
      if(salesProof.replay!==false||!salesProof.order)throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
      const snapshot=await this.#lockAllocationSnapshot(tx,salesProof.order,fulfillmentId,reallocate);
      if(JSON.stringify(scope(snapshot,command))!==JSON.stringify(query))throw fulfillmentError("VERSION_CONFLICT");
      const sourceFacts=await this.sales.readLockedFulfillmentClaimSourceFactsInTransaction(tx,salesIntent);assertAllocationSourceFacts(snapshot,snapshot.allClaims,sourceFacts,prepared.reservationFacts);
      const profiles=await this.locks.itemLookup.getFulfillmentInventoryProfilesInTransaction(tx,[...new Set(snapshot.lines.map(row=>String(row.sku_id)))],{atMs:this.time.nowMs()});
      for(const line of snapshot.lines){const profile=profiles.find(row=>row.skuId===String(line.sku_id));if(!profile||!profile.usable||!profile.inventoryTracked||profile.baseUom.uomId!==String(line.base_uom_id))throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");if(profile.trackingPolicy==="serial")throw fulfillmentError("SERIAL_TRACKING_UNSUPPORTED");}
      let result;
      try{result=await this.inventory[reallocate?"reallocateFulfillmentBatchInTransaction":"allocateForFulfillmentBatchInTransaction"](tx,inventoryCommand,inventoryProof);}
      catch(error){if(["VERSION_CONFLICT","INVENTORY_INPUT_INVALID","PICK_SEQUENCE_REASON_REQUIRED","FEFO_OVERRIDE_REQUIRED"].includes(error.code))throw fulfillmentError("ALLOCATION_CANDIDATE_CHANGED");throw error;}
      const at=this.time.nowMs(),projection=await this.#validateInventoryContract(()=>reallocate?fulfillmentReallocationProjectionRows(result,prepared.payload,inventoryProof,snapshot,at):{newRows:fulfillmentAllocationProjectionRows(result,prepared.payload,inventoryProof,snapshot,at)},request.correlationId),rows=projection.newRows;
      const current=await this.inventoryLookup.lockFulfillmentReservationStatesInTransaction(tx,{warehouseId:query.warehouseId,salesOrderId:query.salesOrderId,members:query.lines.flatMap(line=>line.reservations.map(member=>({inventoryReservationId:member.inventoryReservationId,salesOrderLineId:line.salesOrderLineId,skuId:line.skuId})))});
      assertAllocationSourceFacts(snapshot,snapshot.allClaims,sourceFacts,current);
      const versions=new Map(result.lines.flatMap(line=>line.reservations.map(member=>[member.inventoryReservationId,member.version])));if(current.some(row=>versions.get(row.inventoryReservationId)!==row.version))throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
      if(reallocate){
        let currentAllocations;
        try{currentAllocations=await this.inventoryLookup.readFulfillmentReallocationStatesInTransaction(tx,{fulfillmentId,previousAllocationIds:snapshot.allocations.map(row=>String(row.inventory_allocation_id))});}
        catch(error){
          // Posting already holds the complete owner set: a contradictory proof is a contract failure, not a new business conflict.
          if(["ALLOCATION_STATE_CONFLICT","INVENTORY_SOURCE_CONFLICT","INVENTORY_QUANTITY_INVALID"].includes(error.code))await this.#validateInventoryContract(()=>{throw error;},request.correlationId);
          if(error.code==="INVENTORY_DEPENDENCY_UNAVAILABLE")throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
          throw error;
        }
        await this.#validateInventoryContract(()=>assertReallocationOwnerStates(currentAllocations,projection,snapshot),request.correlationId);
        await this.#saveReleasedProjections(tx,projection.oldRows,snapshot,at);
      }
      await this.#saveAllocationProjections(tx,rows,snapshot,result,at,reallocate);
      const version=command.version+1,[changed]=await tx.execute(`UPDATE fulfillments SET status='PICKING',${reallocate?"":"allocated_at=?,"}version=version+1,last_business_updated_at=?,updated_at=?,updated_by=? WHERE id=? AND status=? AND version=?`,[...(reallocate?[]:[at]),at,at,actor.id,fulfillmentId,reallocate?"PICKING":"DRAFT",command.version]);if(changed.affectedRows!==1)throw fulfillmentError("VERSION_CONFLICT");
      const [[history]]=await tx.query("SELECT COALESCE(MAX(sequence_no),0) AS sequence FROM fulfillment_status_history WHERE fulfillment_id=?",[fulfillmentId]);if(Number(history.sequence)>=4294967295)throw fulfillmentError("VERSION_CONFLICT");
      await tx.execute("INSERT INTO fulfillment_status_history (fulfillment_id,sequence_no,from_status,to_status,action,event_id,version_after,actor_user_id,actor_label,occurred_at) VALUES (?,?,?,'PICKING','ALLOCATE',?,?,?,?,?)",[fulfillmentId,Number(history.sequence)+1,reallocate?"PICKING":"DRAFT",command.eventId,version,actor.id,actor.username,at]);
      await this.#saveSequenceAudits(tx,rows,actor,request,inventoryProof.requestHash,at);
      await tx.execute("INSERT INTO fulfillment_audit_logs (target_type,target_id,action,event_id,correlation_id,actor_user_id,actor_label,before_summary,after_summary,occurred_at) VALUES ('FULFILLMENT',?,?,?,?,?,?,?,?,?)",[fulfillmentId,action,command.eventId,request.correlationId,actor.id,actor.username,JSON.stringify({status:reallocate?"PICKING":"DRAFT",version:command.version}),JSON.stringify({fulfillmentId,status:"PICKING",version,lineCount:snapshot.lines.length,createdCount:rows.length,...(reallocate?{updatedCount:projection.oldRows.length}:{}),requestHash:inventoryProof.requestHash}),at]);
      const output={id:fulfillmentId,number:snapshot.header.fulfillment_number,status:"PICKING",version};await this.operations.succeedInTransaction(tx,{request,result:output});return output;
    }).catch(error=>{
      // InnoDB confirms rollback of a deadlock victim; never classify an indeterminate commit as a retryable conflict.
      if(error.code==="DATABASE_OPERATION_FAILED"&&error.cause?.code==="ER_LOCK_DEADLOCK")throw fulfillmentError("CONCURRENT_OPERATION");
      throw error;
    });
    try{return {outcome,...await this.inquiry.detail(fulfillmentId)};}catch(error){if(["FULFILLMENT_PERMISSION_DENIED","PERMISSION_STALE"].includes(error.code))throw error;await this.logger.error(`fulfillment.${action.toLowerCase()}.projection_unavailable`,"Command succeeded but its current projection is unavailable",{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE",correlationId:request.correlationId});throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE",{correlationId:request.correlationId});}
  }

}
