import { randomUUID } from "node:crypto";
import { FulfillmentTransactionService,assertFulfillmentTransaction } from "./FulfillmentTransactionService.js";
import { FulfillmentOperationService } from "./FulfillmentOperationService.js";
import { FulfillmentSequenceService } from "./FulfillmentSequenceService.js";
import { FulfillmentDownstreamMatterService } from "./FulfillmentDownstreamMatterService.js";
import { lockFulfillmentRowsInTransaction } from "./FulfillmentLockService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { normalizeShipmentReversal } from "./shipmentReversalCommand.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { fulfillmentOperationHash } from "./fulfillmentOperationHash.js";
import { getTransactionOutcome } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { readShipmentReversalSnapshot,readLockedShipmentReversalSnapshot } from "./shipmentReversalSnapshot.js";
import { mapShipmentReversalSources } from "./shipmentReversalMapping.js";
import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { normalizeSalesFulfillmentIntent,salesFulfillmentIntentHash } from "../sales/SalesFulfillmentService.js";
import { freezeShipmentIntent } from "./shipmentConfirmationScope.js";
import { assertShipmentLeaseBoundary,shipmentLeaseEntry,shipmentTransactionBudget } from "./shipmentOperationLease.js";
import { assertShipmentReversalSource,shipmentReversalProjection,assertReversedSalesProjection,saveShipmentReversalProjection } from "./shipmentReversalProjection.js";

const fail=code=>{throw fulfillmentError(code);};
function terminal(operation){if(operation.status==="FAILED")throw fulfillmentError(operation.publicErrorCode,operation.publicErrorDetails);return Object.freeze({outcome:"REVERSED",shipment:operation.result});}
function pending(operation,reversal,shipmentVersion){
 return Object.freeze({outcome:"REVERSING",operationId:operation.operationId,eventId:operation.eventId,correlationId:operation.correlationId,statusUrl:`/api/v1/fulfillment-operations/by-event/${operation.eventId}`,retryAfterSeconds:2,reversal:Object.freeze({id:String(reversal.id),number:reversal.reversal_number,version:Number(reversal.version)}),shipmentVersion});
}
export class ShipmentReversalService {
 #startedAttempts=new WeakMap();
 #leaseBoundaries=new WeakMap();
 #completing=new WeakSet();
 #completionAttempts=new WeakMap();
 constructor({database,time,downstreamRegistry,operationLeaseMs=60000,sales,inventoryLookup}){
  Object.assign(this,{database,time,sales,inventoryLookup});this.transactions=new FulfillmentTransactionService({database});this.operations=new FulfillmentOperationService({database,time,leaseMs:operationLeaseMs});this.sequence=new FulfillmentSequenceService({database,time});this.downstream=new FulfillmentDownstreamMatterService({database,registry:downstreamRegistry});
 }
 // null is no trusted terminal result, never proof of absence or permission to write.
 async readReversalTerminal(shipmentId,input){
  try{fulfillmentInteger(shipmentId);}catch{fail("FULFILLMENT_INPUT_INVALID");}
  const command=normalizeShipmentReversal(input);
  return this.transactions.withTransaction(async tx=>{
   const replay=await this.operations.getShipmentReversalReplayInTransaction(tx,{shipmentId,command});
   return replay?terminal(replay):null;
  });
 }
 // A successful observation is not a lease renewal or a substitute for the writer's locked fence check.
 async readStartedReversal(started){
  const binding=this.#startedAttempts.get(started);if(!binding)return null;
  const {request}=binding;
  return this.transactions.withTransaction(async tx=>{
   const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.reverse");
   if(String(actor.id)!==binding.initiatorId)return null;
   const replay=await this.operations.getShipmentReversalReplayInTransaction(tx,{shipmentId:request.target.id,command:request.payload});
   if(replay)return replay.operationId===binding.operationId&&replay.correlationId===binding.correlationId?terminal(replay):null;
   const [[row]]=await tx.query("SELECT o.*,CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS observed_now_ms FROM fulfillment_operation_requests o WHERE id=? AND event_id=?",[binding.operationId,request.eventId]);
   if(!row)return null;
   if(row.status!=="IN_PROGRESS"){
    const completed=await this.operations.getShipmentReversalReplayInTransaction(tx,{shipmentId:request.target.id,command:request.payload});
    return completed&&completed.operationId===binding.operationId&&completed.correlationId===binding.correlationId?terminal(completed):null;
   }
   if(String(row.id)!==binding.operationId||row.operation_type!=="REVERSE"||row.target_type!=="SHIPMENT"||String(row.target_id)!==request.target.id||row.event_id!==request.eventId||
      String(row.initiated_by)!==binding.initiatorId||row.payload_hash!==binding.payloadHash||row.correlation_id!==binding.correlationId||row.lease_owner!==binding.leaseOwner||
      String(row.is_document_archived)!=="0"||String(row.attempt_count)!==String(binding.attemptCount)||row.next_attempt_at!==null||row.result_json!==null||row.completed_at!==null||row.public_error_code!==""||row.public_error_details!==null)return null;
   let now,expires;try{now=fulfillmentInteger(String(row.observed_now_ms),{positive:false});expires=fulfillmentInteger(String(row.lease_expires_at));}catch{return null;}
   return expires>now?started:null;
  });
 }
 // Preparation is advisory data only; it never preclaims, renews or grants the writer entry.
 async prepareReversalReadOnly(shipmentId,input,started){
  try{fulfillmentInteger(shipmentId);}catch{fail("FULFILLMENT_INPUT_INVALID");}
  const command=normalizeShipmentReversal(input),binding=this.#startedAttempts.get(started);
  const replay=await this.readReversalTerminal(shipmentId,command);if(replay)return replay;
  if(!binding||binding.request.target.id!==shipmentId||binding.payloadHash!==fulfillmentOperationHash({operationType:"REVERSE",target:{type:"SHIPMENT",id:shipmentId},payload:command}))return null;
  const sales=this.sales,inventoryLookup=this.inventoryLookup;
  if(typeof sales?.getShipmentReversalScope!=="function"||typeof inventoryLookup?.getFulfillmentReversalPreparationInTransaction!=="function")return null;
  const observed=await this.readStartedReversal(started);if(observed!==started)return observed;
  try{
   const snapshot=await readShipmentReversalSnapshot(this.database,shipmentId);
   const salesScope=await sales.getShipmentReversalScope({salesOrderId:String(snapshot.root.sales_order_id),shipmentId,originalConfirmationEventId:snapshot.shipment.confirmation_event_id});
   if(!salesScope)fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
   const originalInventoryOperationIds=[...new Set(snapshot.issues.map(row=>String(row.inventory_operation_id)))];
   const inventoryScope=await this.transactions.withTransaction(tx=>inventoryLookup.getFulfillmentReversalPreparationInTransaction(tx,{shipmentId,originalInventoryOperationIds}));
   if(!inventoryScope)fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
   const preparation=mapShipmentReversalSources(snapshot,salesScope,inventoryScope);
   const current=await this.readStartedReversal(started);if(current!==started)return current;
   return Object.freeze({outcome:"REVERSING",operationId:binding.operationId,eventId:command.eventId,preparation});
  }catch(error){
   const completed=await this.readReversalTerminal(shipmentId,command);if(completed)return completed;
   if(!(error instanceof ApplicationError))throw error;
   let cause=error;const visited=new Set();
   while(cause instanceof ApplicationError){
    if(cause.statusCode===403)throw cause;
    if(visited.has(cause))throw error;
    visited.add(cause);
    if(!(cause.cause instanceof Error))return null;
    cause=cause.cause;
   }
   if(cause instanceof TypeError||cause instanceof SyntaxError||!cause.code||String(cause.code).startsWith("ERR_"))throw error;
   return null;
  }
 }
 async #lockReversalOperation(tx,binding,locked){
  assertFulfillmentTransaction(this.database,tx);
  const {request}=binding,[[row]]=await tx.query("SELECT * FROM fulfillment_operation_requests WHERE event_id=? FOR UPDATE",[request.eventId]);
  if(!row||String(row.id)!==binding.operationId||row.operation_type!=="REVERSE"||row.target_type!=="SHIPMENT"||String(row.target_id)!==request.target.id||String(row.initiated_by)!==binding.initiatorId||row.payload_hash!==binding.payloadHash||row.correlation_id!==binding.correlationId||row.status==="IN_PROGRESS"&&(row.lease_owner!==binding.leaseOwner||Number(row.attempt_count)!==binding.attemptCount))fail("CONCURRENT_OPERATION");
  locked?.();
  const replay=await this.operations.getShipmentReversalReplayInTransaction(tx,{shipmentId:request.target.id,command:request.payload});if(replay)return {replay};
  const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.reverse"),observedAtMono=performance.now(),[[clock]]=await tx.query("SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms"),now=Number(clock?.now_ms),expires=Number(row?.lease_expires_at);
  if(!row||String(row.id)!==binding.operationId||row.status!=="IN_PROGRESS"||row.operation_type!=="REVERSE"||row.target_type!=="SHIPMENT"||String(row.target_id)!==request.target.id||String(row.initiated_by)!==binding.initiatorId||String(actor.id)!==binding.initiatorId||row.payload_hash!==binding.payloadHash||row.correlation_id!==binding.correlationId||row.lease_owner!==binding.leaseOwner||Number(row.attempt_count)!==binding.attemptCount||Number(row.is_document_archived)!==0||row.next_attempt_at!==null||row.result_json!==null||row.completed_at!==null||row.public_error_code!==""||row.public_error_details!==null||!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(expires)||expires<=now)fail("CONCURRENT_OPERATION");
  return {row,actor,now,expires,observedAtMono};
 }
 // Internal normal path only. A retained attempt is never permission to retry; Recovery owns that decision.
 async completeReversalPhaseB(started,{signal}={}){
  const binding=this.#startedAttempts.get(started);if(!binding)fail("FULFILLMENT_SOURCE_CONFLICT");
  const context=this.database.context?.get(),callerSignal=signal===undefined?(context?.signal??undefined):signal;
  if(this.database.context?.get()?.databaseTransaction||callerSignal!==undefined&&!(callerSignal instanceof AbortSignal))throw new TypeError("New reversal caller transaction required");
  if(this.#completing.has(started))fail("CONCURRENT_OPERATION");
  this.#completing.add(started);
  try{return await this.database.context.storage.run({...context,databaseTransaction:null,signal:callerSignal},async()=>{
   const {request}=binding,replay=await this.readReversalTerminal(request.target.id,request.payload);if(replay)return replay;
   if(this.#completionAttempts.has(started))return started;
   const inventory=this.inventoryLookup?.fulfillment,sales=this.sales,budget=shipmentTransactionBudget(this.database),{acquireTimeoutMs:acquire,queryTimeoutMs:query}=this.database.config;
   if(!inventory||inventory.database!==this.database||sales?.database!==this.database||sales.inventoryFulfillment!==inventory||typeof sales.getShipmentReversalScope!=="function"||![acquire,query].every(value=>Number.isSafeInteger(value)&&value>0)||this.operations.leaseMs<budget+acquire)fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
   const attempt={request,tx:null,leaseTx:null,operationLocked:false,knownLockedAtMono:null,inventoryCommand:null,inventoryRequestHash:null,salesIntent:null,salesRequestHash:null,signal:callerSignal,outcome:null,error:null};
   this.#completionAttempts.set(started,attempt);let entry;
   try{
    const lease=await this.database.withTransaction(async tx=>{
     attempt.leaseTx=tx;const current=await this.#lockReversalOperation(tx,binding);if(current.replay)return current;
     assertShipmentLeaseBoundary(this.#leaseBoundaries.get(started),request,this.operations.leaseMs);
     const {row,now}=current,expiry=now+this.operations.leaseMs;
     const [changed]=await tx.execute("UPDATE fulfillment_operation_requests SET lease_expires_at=?,updated_at=? WHERE id=? AND event_id=? AND status='IN_PROGRESS' AND operation_type='REVERSE' AND lease_owner=? AND attempt_count=? AND payload_hash=? AND lease_expires_at=? AND lease_expires_at>CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)",[expiry,now,row.id,request.eventId,binding.leaseOwner,binding.attemptCount,binding.payloadHash,row.lease_expires_at]);if(changed.affectedRows!==1)fail("CONCURRENT_OPERATION");
     return {entryDeadlineMono:current.observedAtMono+Math.floor(this.operations.leaseMs/2),publishedExpiry:expiry};
    },{isolationLevel:"READ COMMITTED",signal:callerSignal});
    if(lease.replay)return terminal(lease.replay);
    if(getTransactionOutcome(attempt.leaseTx)?.state!=="COMMITTED")fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
    entry=shipmentLeaseEntry(Object.freeze(lease),callerSignal);
    return await this.database.context.storage.run({...context,databaseTransaction:null,signal:entry.signal},async()=>{
     const before=await readShipmentReversalSnapshot(this.database,request.target.id);
     const salesScope=await sales.getShipmentReversalScope({salesOrderId:String(before.root.sales_order_id),shipmentId:request.target.id,originalConfirmationEventId:before.shipment.confirmation_event_id});
     const inventoryScope=await this.transactions.withTransaction(tx=>this.inventoryLookup.getFulfillmentReversalPreparationInTransaction(tx,{shipmentId:request.target.id,originalInventoryOperationIds:[...new Set(before.issues.map(row=>String(row.inventory_operation_id)))]}));
     const prepared=mapShipmentReversalSources(before,salesScope,inventoryScope);
     return this.database.withTransaction(async(tx,{signal:transactionSignal})=>{
      attempt.tx=tx;attempt.signal=transactionSignal;
       const current=await this.#lockReversalOperation(tx,binding,()=>{entry.locked();attempt.operationLocked=true;attempt.knownLockedAtMono=performance.now();});if(current.replay)return terminal(current.replay);
       if(current.expires-current.now<budget)fail("CONCURRENT_OPERATION");
       const actor=current.actor,command=freezeShipmentIntent({actor:{userId:actor.id,serviceName:"",claimedRoles:[...actor.roles],claimedPermissions:[...actor.permissions]},source:{documentId:request.target.id,eventId:request.eventId},correlationId:request.correlationId,payload:prepared.inventoryPayload});
       attempt.inventoryCommand=command;
       const proof=await inventory.claimFulfillmentBatchInTransaction(tx,{action:"REVERSE",command});attempt.inventoryRequestHash=proof.requestHash;
       const intent=freezeShipmentIntent(normalizeSalesFulfillmentIntent({...prepared.salesIntentFields,actor:{...command.actor,userId:String(actor.id)},eventId:request.eventId,inventoryRequestHash:proof.requestHash}));
       attempt.salesIntent=intent;attempt.salesRequestHash=salesFulfillmentIntentHash(intent);
       const salesProof=await sales.lockLinesForFulfillmentInTransaction(tx,intent);if(salesProof.replay!==false||!salesProof.order)fail("FULFILLMENT_SOURCE_CONFLICT");
       const snapshot=await readLockedShipmentReversalSnapshot(this.database,tx,{request,reversalId:started.reversal.id,fulfillmentId:prepared.inventoryPayload.fulfillmentId,actorId:binding.initiatorId});
       assertShipmentReversalSource(snapshot,command.payload,intent,salesProof.order,salesScope);
       await this.downstream.assertShipmentReversibleInTransaction(tx,{shipmentId:request.target.id});
       const result=await inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction(tx,command,proof),projection=shipmentReversalProjection(result,command.payload,proof,snapshot,inventoryScope);
       const salesResult=await sales.applyFulfillmentResultInTransaction(tx,{intent,inventoryResult:result});assertReversedSalesProjection(salesResult,intent,salesProof.order);
       const output=await saveShipmentReversalProjection(tx,snapshot,projection,request,actor,this.time.nowMs());
       await this.operations.succeedInTransaction(tx,{request,result:output});
       return Object.freeze({outcome:"REVERSED",shipment:Object.freeze(output)});
     },{isolationLevel:"READ COMMITTED",signal:entry.signal});
    });
   }catch(error){attempt.error=error;throw error;}
   finally{entry?.close();attempt.outcome=getTransactionOutcome(attempt.tx)?.state??null;Object.freeze(attempt);}
  });}finally{this.#completing.delete(started);}
 }
 async startReversal(shipmentId,input){
  try{fulfillmentInteger(shipmentId);}catch{fail("FULFILLMENT_INPUT_INVALID");}
  const command=normalizeShipmentReversal(input),number=await this.sequence.reserveNumber({documentType:"REVERSAL"});
  const request=Object.freeze({eventId:command.eventId,operationType:"REVERSE",target:Object.freeze({type:"SHIPMENT",id:shipmentId}),payload:command,leaseOwner:randomUUID(),correlationId:randomUUID()});
  let created=null;
  const output=await this.transactions.withTransaction(async tx=>{
   const operation=await this.operations.claimInTransaction(tx,request);
   if(operation.replay)return terminal(operation);
   const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.reverse");
   if(!operation.created){
    const [[reversal]]=await tx.query("SELECT * FROM shipment_reversals WHERE event_id=?",[command.eventId]);
    const [[shipment]]=await tx.query("SELECT status,version,reversal_event_id,correlation_id FROM shipments WHERE id=?",[shipmentId]);
    if(!reversal||String(reversal.shipment_id)!==shipmentId||reversal.status!=="REVERSING"||reversal.reason!==command.reason||Number(reversal.goods_under_company_control)!==1||Number(reversal.goods_returned_to_original_bins)!==1||String(reversal.created_by)!==String(actor.id)||reversal.correlation_id!==operation.correlationId||!shipment||shipment.status!=="REVERSING"||shipment.reversal_event_id!==command.eventId||shipment.correlation_id!==operation.correlationId||Number(shipment.version)!==command.version+1)fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
    fulfillmentInteger(String(reversal.id));if(Number(reversal.version)!==1||typeof reversal.reversal_number!=="string"||!/^REV-[0-9]{6}-[0-9]{6,13}$/u.test(reversal.reversal_number)||reversal.reversal_number.length>24)fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
    const [history]=await tx.query("SELECT actor_user_id,from_status,to_status,version_after,reason FROM shipment_status_history WHERE shipment_id=? AND event_id=? AND action='REVERSE_START' LIMIT 2",[shipmentId,command.eventId]);
    if(history.length!==1||String(history[0].actor_user_id)!==String(actor.id)||history[0].from_status!=="SHIPPED"||history[0].to_status!=="REVERSING"||Number(history[0].version_after)!==command.version+1||history[0].reason!==command.reason)fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
    return pending(operation,reversal,Number(shipment.version));
   }
   if(command.version>4294967293)fail("VERSION_CONFLICT");
   const [[route]]=await tx.query("SELECT fulfillment_id FROM shipments WHERE id=?",[shipmentId]);if(!route)fail("SHIPMENT_NOT_FOUND");
   const [root]=await lockFulfillmentRowsInTransaction(tx,"fulfillments",[route.fulfillment_id]);
   const [shipment]=await lockFulfillmentRowsInTransaction(tx,"shipments",[shipmentId]);
   if(shipment.status==="REVERSED")fail("SHIPMENT_ALREADY_REVERSED");
   if(root.status!=="SHIPPED"||shipment.status!=="SHIPPED"||String(root.active_shipment_id)!==shipmentId)fail("SHIPMENT_STATE_CONFLICT");
   if(String(shipment.fulfillment_id)!==String(root.id)||["sales_order_id","customer_id","warehouse_id"].some(key=>String(shipment[key])!==String(root[key])))fail("FULFILLMENT_SOURCE_CONFLICT");
   if(Number(shipment.version)!==command.version)fail("VERSION_CONFLICT");
   const [archivedShipment]=await tx.query("SELECT id FROM shipments_archive WHERE id=? LIMIT 1",[shipmentId]);
   const [archivedRoot]=await tx.query("SELECT id FROM fulfillments_archive WHERE id=? LIMIT 1",[root.id]);
   if(archivedShipment.length||archivedRoot.length)fail("FULFILLMENT_SOURCE_CONFLICT");
   const [effective]=await tx.query("SELECT id FROM shipment_reversals WHERE effective_shipment_id=? ORDER BY id LIMIT 2",[shipmentId]);if(effective.length)fail("SHIPMENT_ALREADY_REVERSED");
   const downstream=await this.downstream.assertShipmentReversibleInTransaction(tx,{shipmentId});
   const at=this.time.nowMs(),before={shipmentId,fulfillmentId:String(root.id),version:command.version,status:"SHIPPED",registryVersion:downstream.registryVersion};
   const [inserted]=await tx.execute("INSERT INTO shipment_reversals (reversal_number,shipment_id,status,event_id,correlation_id,reason,goods_under_company_control,goods_returned_to_original_bins,before_summary,created_at,created_by) VALUES (?,?,'REVERSING',?,?,?,1,1,?,?,?)",[number,shipmentId,command.eventId,request.correlationId,command.reason,JSON.stringify(before),at,actor.id]);
   const reversalId=String(inserted.insertId);fulfillmentInteger(reversalId);
   const [changed]=await tx.execute("UPDATE shipments SET status='REVERSING',reversal_event_id=?,correlation_id=?,version=version+1,updated_at=?,last_business_updated_at=?,updated_by=? WHERE id=? AND fulfillment_id=? AND status='SHIPPED' AND version=?",[command.eventId,request.correlationId,at,at,actor.id,shipmentId,root.id,command.version]);if(changed.affectedRows!==1)fail("VERSION_CONFLICT");
   const [[history]]=await tx.query("SELECT COALESCE(MAX(sequence_no),0)+1 AS next_sequence FROM shipment_status_history WHERE shipment_id=?",[shipmentId]);
   await tx.execute("INSERT INTO shipment_status_history (shipment_id,sequence_no,from_status,to_status,action,reason,event_id,version_after,actor_user_id,actor_label,occurred_at) VALUES (?,?,'SHIPPED','REVERSING','REVERSE_START',?,?,?,?,?,?)",[shipmentId,history.next_sequence,command.reason,command.eventId,command.version+1,actor.id,actor.username,at]);
   await tx.execute("INSERT INTO fulfillment_audit_logs (target_type,target_id,action,event_id,correlation_id,actor_user_id,actor_label,after_summary,occurred_at) VALUES ('SHIPMENT',?,'REVERSE',?,?,?,?,?,?)",[shipmentId,command.eventId,request.correlationId,actor.id,actor.username,JSON.stringify({shipmentId,fulfillmentId:String(root.id),reversalId,status:"REVERSING",version:command.version+1}),at]);
   const result=pending(operation,{id:reversalId,reversal_number:number,version:1},command.version+1);
   created={executor:tx,result,knownLockedAtMono:performance.now(),facts:Object.freeze({request,initiatorId:String(actor.id),operationId:operation.operationId,correlationId:request.correlationId,leaseOwner:request.leaseOwner,attemptCount:1,payloadHash:fulfillmentOperationHash(request)})};
   return result;
  });
  const binding=created&&output===created.result&&getTransactionOutcome(created.executor)?.state==="COMMITTED"?created.facts:null;
  if(binding){this.#startedAttempts.set(output,binding);this.#leaseBoundaries.set(output,Object.freeze({tx:created.executor,request:binding.request,outcome:"COMMITTED",operationLocked:true,knownLockedAtMono:created.knownLockedAtMono}));}
  created=null;
  return output;
 }
}
