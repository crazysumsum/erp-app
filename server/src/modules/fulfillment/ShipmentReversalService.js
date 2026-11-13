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
import { getTransactionOutcome,hasTransactionEventAdmission } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { readShipmentReversalSnapshot,readLockedShipmentReversalSnapshot,readCurrentShipmentReversalBootstrap } from "./shipmentReversalSnapshot.js";
import { mapShipmentReversalSources } from "./shipmentReversalMapping.js";
import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { normalizeSalesFulfillmentIntent,salesFulfillmentIntentHash } from "../sales/SalesFulfillmentService.js";
import { freezeShipmentIntent } from "./shipmentConfirmationScope.js";
import { assertShipmentLeaseBoundary,shipmentLeaseEntry,shipmentTransactionBudget } from "./shipmentOperationLease.js";
import { assertShipmentReversalSource,shipmentReversalProjection,assertReversedSalesProjection,saveShipmentReversalProjection } from "./shipmentReversalProjection.js";
import { InventoryLookupService } from "../inventory/InventoryLookupService.js";
import { SalesFulfillmentService } from "../sales/SalesFulfillmentService.js";
import { ShipmentEventAdmission } from "./shipmentEventAdmission.js";
import { readShipmentReversalRecoveryActor } from "./shipmentRecoveryActor.js";
import { readDurableShipmentReversal,shipmentReversalZeroEffectSource,assertLocalShipmentReversalZeroEffect } from "./shipmentReversalRecoverySource.js";
import { SHIPMENT_RECOVERY_MAX_ATTEMPTS,SHIPMENT_RECOVERY_MAX_DELAY_MS,shipmentRecoveryDelay } from "./shipmentRecoveryBackoff.js";

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
 #admission;
 #recoveryVerifier;
 #recoveryStarts=new WeakMap();
 #zeroSessions=new WeakMap();
 constructor({database,time,logger,downstreamRegistry,operationLeaseMs=60000,recoveryVerifier=null}){
  Object.assign(this,{database,time});this.transactions=new FulfillmentTransactionService({database});this.operations=new FulfillmentOperationService({database,time,leaseMs:operationLeaseMs});this.sequence=new FulfillmentSequenceService({database,time});this.downstream=new FulfillmentDownstreamMatterService({database,registry:downstreamRegistry});
  this.#admission=new ShipmentEventAdmission({database,readWriter:token=>this.#startedAttempts.get(token)});
  if(recoveryVerifier!==null&&typeof recoveryVerifier!=="function")throw new TypeError("Private reversal Recovery verifier required");
  this.#recoveryVerifier=recoveryVerifier;
  const eventAdmissionVerifier=(tx,input)=>this.#admission.verifyWriter(tx,input);
  const reconciliationVerifier=(tx,session,phase)=>this.#verifyZeroRead(tx,session,phase);
  this.inventoryLookup=new InventoryLookupService({database,time,logger,eventAdmissionVerifier,reconciliationVerifier});
  this.sales=new SalesFulfillmentService({database,time,logger,inventoryFulfillment:this.inventoryLookup.fulfillment,eventAdmissionVerifier,reconciliationVerifier});
 }
 async #verifyRecovery(tx,started){
  const token=this.#recoveryStarts.get(started);
  if(token){if(!this.#recoveryVerifier)fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");await this.#recoveryVerifier(tx,token);}
 }
 async #inspectionFence(tx,record){
  assertFulfillmentTransaction(this.database,tx);
  if(record.tx!==tx||record.signal.aborted||!hasTransactionEventAdmission(this.database,tx,record.durable.request.eventId))fail("CONCURRENT_OPERATION");
  await this.#recoveryVerifier(tx,record.token);
  const {operation:original,request}=record.durable;
  const [[row]]=await tx.query("SELECT *,CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms FROM fulfillment_operation_requests WHERE event_id=? FOR UPDATE",[request.eventId]);
  if(!row||["id","event_id","operation_type","target_type","target_id","payload_hash","initiated_by","correlation_id","lease_owner","attempt_count","lease_expires_at","next_attempt_at"].some(field=>String(row[field])!==String(original[field]))||
     row.status!=="IN_PROGRESS"||Number(row.is_document_archived)!==0||row.result_json!==null||row.completed_at!==null||row.public_error_code!==""||row.public_error_details!==null||
     !Number.isSafeInteger(Number(row.now_ms))||!Number.isSafeInteger(Number(row.lease_expires_at))||Number(row.lease_expires_at)>Number(row.now_ms)||row.next_attempt_at!==null&&(!Number.isSafeInteger(Number(row.next_attempt_at))||Number(row.next_attempt_at)>Number(row.now_ms)))fail("CONCURRENT_OPERATION");
  const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.reverse");if(String(actor.id)!==record.durable.actorId)fail("FULFILLMENT_PERMISSION_DENIED");
  return {row,actor,now:Number(row.now_ms)};
 }
 async #verifyZeroRead(tx,session,phase){
  const record=this.#zeroSessions.get(session);
  if(!record||record.phase!==phase)fail("FULFILLMENT_SOURCE_CONFLICT");
  await this.#inspectionFence(tx,record);return record.source;
 }
 async recoverExpiredReversal(eventId,token,{signal}={}){
  if(!this.#recoveryVerifier||!(signal instanceof AbortSignal)||signal.aborted||this.database.context.get()?.databaseTransaction)fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
  await this.#recoveryVerifier(null,token);
  const observed=await this.transactions.withTransaction(async tx=>{
   await this.#recoveryVerifier(tx,token);
   const durable=await readDurableShipmentReversal(this.database,tx,eventId);
   const identity=await readShipmentReversalRecoveryActor(this.database,tx,durable.actorId);
   return {durable,identity};
  });
  if(!observed.identity.eligible)return {state:"UNKNOWN"};
  const context=this.database.context,previous=context.get(),actor=observed.identity.actor;
  return context.storage.run({...previous,signal,databaseTransaction:null,auth:{claims:{sub:String(actor.id),roles:[...actor.roles],permissions:[...actor.permissions]}}},async()=>{
   const replay=await this.readReversalTerminal(observed.durable.request.target.id,observed.durable.request.payload);
   if(replay)return {state:"SUCCEEDED",result:replay};
   let executor,session;
   let prepared;
   try{prepared=await this.database.withTransaction(async(tx,{signal:transactionSignal})=>{
    executor=tx;await this.#recoveryVerifier(tx,token);
    const [[operation]]=await tx.query("SELECT * FROM fulfillment_operation_requests WHERE event_id=? FOR UPDATE",[eventId]);
    if(!operation)return {state:"UNKNOWN"};
    const durable=await readDurableShipmentReversal(this.database,tx,eventId,operation);
    if(durable.actorId!==observed.durable.actorId||fulfillmentOperationHash(durable.request)!==fulfillmentOperationHash(observed.durable.request)||durable.request.correlationId!==observed.durable.request.correlationId)return {state:"UNKNOWN"};
    const terminalResult=await this.operations.getShipmentReversalReplayInTransaction(tx,{shipmentId:durable.request.target.id,command:durable.request.payload});
    if(terminalResult)return {state:terminalResult.status==="SUCCEEDED"?"SUCCEEDED":"FAILED",result:terminalResult};
    const record={tx,token,signal:transactionSignal,durable,phase:null,source:null};
    const current=await this.#inspectionFence(tx,record),attemptCount=Number(current.row.attempt_count);
    if(!Number.isSafeInteger(attemptCount)||attemptCount<1||attemptCount>4294967295)return {state:"UNKNOWN"};
    const inventory=this.inventoryLookup,sales=this.sales;
    if(inventory?.fulfillment?.database!==this.database||sales?.database!==this.database||sales.inventoryFulfillment!==inventory.fulfillment||
       !["prepareShipmentReversalZeroEffectReadInTransaction","readShipmentReversalZeroEffectInTransaction","verifyShipmentReversalZeroEffectProofInTransaction"].every(method=>typeof inventory[method]==="function")||
       !["readShipmentReversalZeroEffectInTransaction","verifyShipmentReversalZeroEffectProofInTransaction"].every(method=>typeof sales[method]==="function"))return {state:"UNKNOWN"};
    const bootstrap=await readCurrentShipmentReversalBootstrap(this.database,tx,durable.request.target.id);
    record.source=shipmentReversalZeroEffectSource(bootstrap,durable);session=Object.freeze({});this.#zeroSessions.set(session,record);
    record.phase="reversal.zero.inventory.prepare";const inventoryContext=await inventory.prepareShipmentReversalZeroEffectReadInTransaction(tx,session);
    record.phase="reversal.zero.sales.read";const salesProof=await sales.readShipmentReversalZeroEffectInTransaction(tx,session);
    const locked=await readLockedShipmentReversalSnapshot(this.database,tx,{request:durable.request,reversalId:String(durable.reversal.id),fulfillmentId:record.source.fulfillmentId,actorId:durable.actorId});
    if(JSON.stringify(shipmentReversalZeroEffectSource(locked,durable))!==JSON.stringify(record.source))return {state:"UNKNOWN"};
    await assertLocalShipmentReversalZeroEffect(tx,locked,durable);
    await this.downstream.assertShipmentReversibleInTransaction(tx,{shipmentId:durable.request.target.id});
    record.phase="reversal.zero.inventory.finish";const inventoryProof=await inventory.readShipmentReversalZeroEffectInTransaction(tx,inventoryContext);
    record.phase="reversal.zero.inventory.verify";const inventoryResult=await inventory.verifyShipmentReversalZeroEffectProofInTransaction(tx,session,inventoryProof);
    record.phase="reversal.zero.sales.verify";const salesResult=await sales.verifyShipmentReversalZeroEffectProofInTransaction(tx,session,salesProof);
    // Absence and present write eligibility are independent owner attestations.
    if(inventoryResult?.state!=="ABSENT"||salesResult?.state!=="ABSENT"||inventoryResult.eligibility!=="ELIGIBLE"||salesResult.eligibility!=="ELIGIBLE")return {state:"UNKNOWN"};
    const final=await this.#inspectionFence(tx,record),row=final.row,now=final.now;
    if(attemptCount>=SHIPMENT_RECOVERY_MAX_ATTEMPTS){
     const [deferred]=await tx.execute("UPDATE fulfillment_operation_requests SET next_attempt_at=GREATEST(COALESCE(next_attempt_at,0),?),updated_at=? WHERE id=? AND event_id=? AND operation_type='REVERSE' AND target_type='SHIPMENT' AND target_id=? AND initiated_by=? AND payload_hash=? AND correlation_id=? AND status='IN_PROGRESS' AND result_json IS NULL AND completed_at IS NULL AND public_error_code='' AND public_error_details IS NULL AND is_document_archived=0 AND lease_owner=? AND attempt_count=? AND lease_expires_at=? AND next_attempt_at<=>?",[now+SHIPMENT_RECOVERY_MAX_DELAY_MS,now,row.id,eventId,durable.request.target.id,durable.actorId,row.payload_hash,durable.request.correlationId,row.lease_owner,attemptCount,row.lease_expires_at,row.next_attempt_at]);
     if(deferred.affectedRows!==1)fail("CONCURRENT_OPERATION");
     return {state:"EXHAUSTED",attemptCount,correlationId:durable.request.correlationId};
    }
    const request=freezeShipmentIntent({...durable.request,leaseOwner:randomUUID()});
    const [changed]=await tx.execute("UPDATE fulfillment_operation_requests SET lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1,next_attempt_at=NULL,updated_at=? WHERE id=? AND event_id=? AND operation_type='REVERSE' AND target_type='SHIPMENT' AND target_id=? AND initiated_by=? AND payload_hash=? AND correlation_id=? AND status='IN_PROGRESS' AND result_json IS NULL AND completed_at IS NULL AND public_error_code='' AND public_error_details IS NULL AND is_document_archived=0 AND lease_owner=? AND attempt_count=? AND lease_expires_at=? AND lease_expires_at<=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AND next_attempt_at<=>? AND (next_attempt_at IS NULL OR next_attempt_at<=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)) AND attempt_count<?",[request.leaseOwner,now+this.operations.leaseMs,now,row.id,eventId,request.target.id,durable.actorId,row.payload_hash,request.correlationId,row.lease_owner,attemptCount,row.lease_expires_at,row.next_attempt_at,SHIPMENT_RECOVERY_MAX_ATTEMPTS]);
    if(changed.affectedRows!==1)fail("CONCURRENT_OPERATION");
    const started=pending({operationId:String(row.id),eventId,correlationId:request.correlationId},durable.reversal,request.payload.version+1);
    return {state:"PREPARED",started,binding:Object.freeze({request,initiatorId:durable.actorId,operationId:String(row.id),correlationId:request.correlationId,leaseOwner:request.leaseOwner,attemptCount:attemptCount+1,payloadHash:row.payload_hash}),knownLockedAtMono:performance.now()};
   },{isolationLevel:"READ COMMITTED",signal,eventAdmissionId:eventId});}
   finally{if(session)this.#zeroSessions.delete(session);}
   if(getTransactionOutcome(executor)?.state!=="COMMITTED")return {state:"UNKNOWN"};
   if(prepared.state!=="PREPARED")return prepared;
   const {started,binding}=prepared;
   this.#startedAttempts.set(started,binding);this.#recoveryStarts.set(started,token);
   this.#leaseBoundaries.set(started,Object.freeze({tx:executor,request:binding.request,outcome:"COMMITTED",operationLocked:true,knownLockedAtMono:prepared.knownLockedAtMono}));
   try{
    await this.#recoveryVerifier(null,token);
    const result=await this.completeReversalPhaseB(started,{signal});
    return {state:result.outcome==="REVERSED"?"SUCCEEDED":"UNKNOWN",result};
   }catch(error){
    if(signal.aborted||error.statusCode===403||error instanceof TypeError||error instanceof SyntaxError)throw error;
    // One original-event attempt only; a fresh terminal read is the sole acknowledgement-loss recovery.
    const completed=await this.readReversalTerminal(binding.request.target.id,binding.request.payload);
    if(completed)return {state:"SUCCEEDED",result:completed};
    await this.#deferRecoveryAttempt(started,token,signal);
    return {state:"UNKNOWN"};
   }finally{this.#recoveryStarts.delete(started);}
  });
 }
 async #deferRecoveryAttempt(started,token,signal){
  const binding=this.#startedAttempts.get(started),request=binding.request;
  await this.database.withTransaction(async tx=>{
   await this.#recoveryVerifier(tx,token);await this.#lockReversalOperation(tx,binding);
   const delay=shipmentRecoveryDelay(binding.attemptCount);
   const [changed]=await tx.execute("UPDATE fulfillment_operation_requests SET next_attempt_at=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)+?,updated_at=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) WHERE id=? AND event_id=? AND operation_type='REVERSE' AND target_type='SHIPMENT' AND target_id=? AND status='IN_PROGRESS' AND payload_hash=? AND initiated_by=? AND correlation_id=? AND lease_owner=? AND attempt_count=? AND is_document_archived=0 AND result_json IS NULL AND completed_at IS NULL AND public_error_code='' AND public_error_details IS NULL",[delay,binding.operationId,request.eventId,request.target.id,binding.payloadHash,binding.initiatorId,binding.correlationId,binding.leaseOwner,binding.attemptCount]);
   if(changed.affectedRows!==1)fail("CONCURRENT_OPERATION");
  },{isolationLevel:"READ COMMITTED",signal,eventAdmissionId:request.eventId});
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
   await this.#verifyRecovery(null,started);
   const {request}=binding,replay=await this.readReversalTerminal(request.target.id,request.payload);if(replay)return replay;
   if(this.#completionAttempts.has(started))return started;
   const inventory=this.inventoryLookup?.fulfillment,sales=this.sales,budget=shipmentTransactionBudget(this.database),{acquireTimeoutMs:acquire,queryTimeoutMs:query}=this.database.config;
   if(!inventory||inventory.database!==this.database||sales?.database!==this.database||sales.inventoryFulfillment!==inventory||typeof sales.getShipmentReversalScope!=="function"||![acquire,query].every(value=>Number.isSafeInteger(value)&&value>0)||this.operations.leaseMs<budget+acquire)fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
   const attempt={request,tx:null,leaseTx:null,operationLocked:false,knownLockedAtMono:null,inventoryCommand:null,inventoryRequestHash:null,salesIntent:null,salesRequestHash:null,signal:callerSignal,outcome:null,error:null};
   this.#completionAttempts.set(started,attempt);let entry;
   try{
    const lease=await this.database.withTransaction(async tx=>{
     await this.#verifyRecovery(tx,started);
     attempt.leaseTx=tx;const current=await this.#lockReversalOperation(tx,binding);if(current.replay)return current;
     assertShipmentLeaseBoundary(this.#leaseBoundaries.get(started),request,this.operations.leaseMs);
     const {row,now}=current,expiry=now+this.operations.leaseMs;
     const [changed]=await tx.execute("UPDATE fulfillment_operation_requests SET lease_expires_at=?,updated_at=? WHERE id=? AND event_id=? AND status='IN_PROGRESS' AND operation_type='REVERSE' AND lease_owner=? AND attempt_count=? AND payload_hash=? AND lease_expires_at=? AND lease_expires_at>CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)",[expiry,now,row.id,request.eventId,binding.leaseOwner,binding.attemptCount,binding.payloadHash,row.lease_expires_at]);if(changed.affectedRows!==1)fail("CONCURRENT_OPERATION");
     return {entryDeadlineMono:current.observedAtMono+Math.floor(this.operations.leaseMs/2),publishedExpiry:expiry};
    },{isolationLevel:"READ COMMITTED",signal:callerSignal,eventAdmissionId:request.eventId});
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
       await this.#verifyRecovery(tx,started);
       const current=await this.#lockReversalOperation(tx,binding,()=>{entry.locked();attempt.operationLocked=true;attempt.knownLockedAtMono=performance.now();});if(current.replay)return terminal(current.replay);
       if(current.expires-current.now<budget)fail("CONCURRENT_OPERATION");
       await this.#admission.enterWriter(tx,started);
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
       await this.#verifyRecovery(tx,started);
       await this.operations.succeedInTransaction(tx,{request,result:output});
       return Object.freeze({outcome:"REVERSED",shipment:Object.freeze(output)});
     },{isolationLevel:"READ COMMITTED",signal:entry.signal,eventAdmissionId:request.eventId});
    });
   }catch(error){attempt.error=error;throw error;}
   finally{this.#admission.close(attempt.tx);entry?.close();attempt.outcome=getTransactionOutcome(attempt.tx)?.state??null;Object.freeze(attempt);}
  });}finally{this.#completing.delete(started);}
 }
 async startReversal(shipmentId,input){
  try{fulfillmentInteger(shipmentId);}catch{fail("FULFILLMENT_INPUT_INVALID");}
  const command=normalizeShipmentReversal(input),number=await this.sequence.reserveNumber({documentType:"REVERSAL"});
  const request=Object.freeze({eventId:command.eventId,operationType:"REVERSE",target:Object.freeze({type:"SHIPMENT",id:shipmentId}),payload:command,leaseOwner:randomUUID(),correlationId:randomUUID()});
  let created=null;
  const output=await this.transactions.withTransaction(async tx=>{
   const [[existing]]=await tx.query("SELECT id FROM fulfillment_operation_requests WHERE event_id=? FOR UPDATE",[command.eventId]);
   if(!existing){
    if(typeof this.inventoryLookup.readShipmentEventAdmissionInTransaction!=="function"||typeof this.sales.readShipmentEventAdmissionInTransaction!=="function")fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
    const source={eventId:command.eventId,shipmentId};
    const inventory=await this.inventoryLookup.readShipmentEventAdmissionInTransaction(tx,source),sales=await this.sales.readShipmentEventAdmissionInTransaction(tx,source);
    if(inventory?.state!=="CLEAR"||sales?.state!=="CLEAR")fail("FULFILLMENT_SOURCE_CONFLICT");
   }
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
  },{eventAdmissionId:command.eventId});
  const binding=created&&output===created.result&&getTransactionOutcome(created.executor)?.state==="COMMITTED"?created.facts:null;
  if(binding){this.#startedAttempts.set(output,binding);this.#leaseBoundaries.set(output,Object.freeze({tx:created.executor,request:binding.request,outcome:"COMMITTED",operationLocked:true,knownLockedAtMono:created.knownLockedAtMono}));}
  created=null;
  return output;
 }
}
