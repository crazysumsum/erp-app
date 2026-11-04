import { SHIPMENT_RECOVERY_MAX_ATTEMPTS,SHIPMENT_RECOVERY_MAX_DELAY_MS } from "./shipmentRecoveryBackoff.js";
import { randomUUID } from "node:crypto";
import { readShipmentRecoveryActor } from "./shipmentRecoveryActor.js";
import { assertFulfillmentTransaction } from "./FulfillmentTransactionService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { fulfillmentOperationHash } from "./fulfillmentOperationHash.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { getTransactionOutcome } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { assertShipmentConfirmationHistory } from "./shipmentConfirmationWitness.js";
import { freezeShipmentIntent,shipmentConfirmationPayload,readShipmentConfirmationSnapshot,assertShipmentConfirmationSnapshot,shipmentConfirmationSnapshotIdentity,shipmentIssuePayload } from "./shipmentConfirmationScope.js";
import { assertAllocationSourceFacts } from "./fulfillmentAllocationScope.js";
import { assertShipmentLeaseBoundary,readOrRenewShipmentLease,shipmentLeaseEntry,shipmentTransactionBudget } from "./shipmentOperationLease.js";

const key=value=>String(value),digest=request=>fulfillmentOperationHash({operationType:"SHIP",target:request.target,payload:request.payload});
const conflict=()=>{throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");};
const permanent=new Map([
 ["SHIPPING_ADDRESS_CHANGED","SHIPPING_ADDRESS_CHANGED"],["SHIPPING_ADDRESS_UNAVAILABLE","SHIPPING_ADDRESS_UNAVAILABLE"],["SERIAL_TRACKING_UNSUPPORTED","SERIAL_TRACKING_UNSUPPORTED"],["VERSION_CONFLICT","VERSION_CONFLICT"],["FULFILLMENT_SOURCE_CONFLICT","FULFILLMENT_SOURCE_CONFLICT"],
 ...["WAREHOUSE_INVALID","BIN_INVALID","BIN_LOCKED_BY_STOCKTAKE","LOT_MINIMUM_LIFE_FAILED","SKU_NOT_INVENTORY_TRACKED"].map(code=>[code,"FULFILLMENT_STATE_CONFLICT"])
]);
function pickedLines(snapshot){
 return snapshot.lines.map(line=>({fulfillmentLineId:key(line.id),salesOrderLineId:key(line.sales_order_line_id),skuId:key(line.sku_id),baseQuantity:key(line.picked_base_quantity),reservations:snapshot.claims.filter(claim=>key(claim.fulfillment_line_id)===key(line.id)&&BigInt(claim.active_claimed_quantity)>0n).map(claim=>({claimId:key(claim.id),inventoryReservationId:key(claim.inventory_reservation_id),baseQuantity:key(claim.active_claimed_quantity),allocations:snapshot.allocations.filter(row=>key(row.claim_id)===key(claim.id)).map(row=>({inventoryAllocationId:key(row.inventory_allocation_id),inventoryBalanceId:key(row.inventory_balance_id),baseQuantity:key(row.picked_base_quantity)}))})).sort((a,b)=>Number(a.inventoryReservationId)-Number(b.inventoryReservationId))})).sort((a,b)=>Number(a.salesOrderLineId)-Number(b.salesOrderLineId));
}
export function shipmentPermanentFailureCode(error){return permanent.get(error?.code)??null;}

export class ShipmentFailureReconciliation {
 #sessions=new WeakMap();
 #inspections=new WeakMap();
 #readAttempt;
 #inventory;
 #sales;
 #leaseMs;
 #readRecovery;
 constructor({database,time,logger,inventory,sales,readAttempt,leaseMs=60000,readRecovery=null}){if(typeof readAttempt!=="function")throw new TypeError("Private actual-attempt reader required");Object.assign(this,{database,time,logger});this.#readAttempt=readAttempt;this.#inventory=inventory;this.#sales=sales;this.#leaseMs=leaseMs;this.#readRecovery=readRecovery;}
 async #operation(tx,record,{admit=false}={}){
  const {request,actor}=record,[[row]]=await tx.query("SELECT * FROM fulfillment_operation_requests WHERE event_id=?",[request.eventId]),[[clock]]=await tx.query("SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms");
  const now=Number(clock?.now_ms),expires=Number(row?.lease_expires_at);
  if(!row||!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(expires)||(record.inspectExpired?expires>now:expires<=now)||admit&&expires-now<shipmentTransactionBudget(this.database)||row.status!=="IN_PROGRESS"||row.result_json!==null||row.completed_at!==null||row.public_error_code!==""||row.public_error_details!==null||(row.next_attempt_at!==null&&(!record.inspectExpired||!Number.isSafeInteger(Number(row.next_attempt_at))||Number(row.next_attempt_at)>now))||Number(row.is_document_archived)!==0||row.operation_type!=="SHIP"||row.target_type!=="SHIPMENT"||key(row.target_id)!==request.target.id||row.payload_hash!==digest(request)||key(row.initiated_by)!==key(actor.id)||row.correlation_id!==request.correlationId||row.lease_owner!==request.leaseOwner)conflict();return row;
 }
 async #assertLocalAbsence(tx,snapshot,record){
  const {request,actor}=record,{shipment,root,shipmentLines}=snapshot;
  if(shipment.correlation_id!==request.correlationId||shipment.cancel_reason!==""||root.cancel_reason!==""||["shipment_date","shipped_at","shipped_by","cancelled_at","cancelled_by","reversed_at","reversed_by","reversal_event_id"].some(column=>shipment[column]!==null)||["shipped_at","shipped_by","cancelled_at","cancelled_by","reversed_at","reversed_by"].some(column=>root[column]!==null)||Object.entries(shipment).some(([column,value])=>column.endsWith("_snapshot")&&value!=="")||shipmentLines.some(line=>["sku_code_snapshot","sku_name_snapshot","base_uom_code_snapshot"].some(column=>line[column]!=="")))conflict();
  // The held parents fence all local business writers; read current facts without inventing absence from owner results.
  const [issues]=await tx.query("SELECT id FROM shipment_issue_details WHERE shipment_id=? LIMIT 1",[shipment.id]);
  const [reversals]=await tx.query("SELECT id FROM shipment_reversals WHERE shipment_id=? LIMIT 1",[shipment.id]);
  const [history]=await tx.query("SELECT shipment_id,event_id,action,from_status,to_status,actor_user_id,version_after FROM shipment_status_history WHERE shipment_id=? AND event_id=? LIMIT 2",[shipment.id,request.eventId]);
  const [rootHistory]=await tx.query("SELECT id FROM fulfillment_status_history WHERE fulfillment_id=? AND event_id=? LIMIT 1",[root.id,request.eventId]);
  const [rootAudit]=await tx.query("SELECT id FROM fulfillment_audit_logs WHERE target_type='FULFILLMENT' AND target_id=? AND event_id=? LIMIT 1",[root.id,request.eventId]);
  const [audit]=await tx.query("SELECT action,correlation_id,actor_user_id,before_summary,after_summary FROM fulfillment_audit_logs WHERE target_type='SHIPMENT' AND target_id=? AND event_id=? LIMIT 2",[shipment.id,request.eventId]);
  if(issues.length||reversals.length||rootHistory.length||rootAudit.length||audit.length!==1)conflict();
  assertShipmentConfirmationHistory(history,{shipmentId:request.target.id,eventId:request.eventId,version:request.payload.version,actorId:actor.id});
  const row=audit[0];let summary;try{summary=typeof row.after_summary==="string"?JSON.parse(row.after_summary):row.after_summary;}catch{conflict();}
  if(row.action!=="SHIP"||row.correlation_id!==request.correlationId||key(row.actor_user_id)!==key(actor.id)||row.before_summary!==null||!summary||Object.keys(summary).sort().join(",")!=="fulfillmentId,shipmentId,status,version"||summary.shipmentId!==request.target.id||summary.fulfillmentId!==key(root.id)||summary.status!=="SHIPPING"||summary.version!==request.payload.version+1)conflict();
 }
 async verifyReadInTransaction(tx,session,phase){
  assertFulfillmentTransaction(this.database,tx);const record=this.#sessions.get(session);
  if(!record||record.tx!==tx||record.signal.aborted||record.phase!==phase)conflict();
  if(record.recoveryToken){if(!this.#readRecovery)conflict();await this.#readRecovery(tx,record.recoveryToken);}else{if(record.attempt.signal?.aborted||this.#readAttempt(record.token)!==record.attempt||getTransactionOutcome(record.attempt.tx)?.state!=="ROLLED_BACK")conflict();if(record.attempt.recoveryToken)await this.#readRecovery(tx,record.attempt.recoveryToken);}
  await this.#operation(tx,record);return record.source;
 }
 async #proveAbsence(tx,record){
  const {request,actor}=record;
  const [history]=await tx.query("SELECT shipment_id,event_id,action,from_status,to_status,actor_user_id,version_after FROM shipment_status_history WHERE shipment_id=? AND event_id=? AND action='CONFIRM_START' LIMIT 2",[request.target.id,request.eventId]);
   assertShipmentConfirmationHistory(history,{shipmentId:request.target.id,eventId:request.eventId,version:request.payload.version,actorId:actor.id});
   const before=assertShipmentConfirmationSnapshot(await readShipmentConfirmationSnapshot(tx,request.target.id),request.eventId);
   if(Number(before.shipment.version)!==request.payload.version+1||digest({...request,payload:shipmentConfirmationPayload(before.shipment,{eventId:request.eventId,version:request.payload.version})})!==digest(request))conflict();
   const source=freezeShipmentIntent({fulfillmentId:key(before.root.id),shipmentId:request.target.id,salesOrderId:key(before.root.sales_order_id),customerId:key(before.root.customer_id),warehouseId:key(before.root.warehouse_id),eventId:request.eventId,actorId:key(actor.id),scopeHash:digest(request),correlationId:request.correlationId,inventoryRequestHash:record.attempt?.inventoryRequestHash??null,salesRequestHash:record.attempt?.salesRequestHash??null,pickedLines:pickedLines(before)}),session=Object.freeze({});
   Object.assign(record,{tx,source,phase:"inventory.prepare"});
   this.#sessions.set(session,record);
   try{
    const inventoryRead=await this.#inventory.prepareShipmentIssueOutcomeReadInTransaction(tx,session);
    record.phase="sales.read";const salesProof=await this.#sales.readShipmentOutcomeInTransaction(tx,session);
    const snapshot=assertShipmentConfirmationSnapshot(await readShipmentConfirmationSnapshot(tx,request.target.id,{locked:true,order:{orderId:source.salesOrderId}}),request.eventId);
    if(shipmentConfirmationSnapshotIdentity(snapshot)!==shipmentConfirmationSnapshotIdentity(before)||JSON.stringify(pickedLines(snapshot))!==JSON.stringify(source.pickedLines))conflict();
    record.phase="inventory.finish";const inventoryProof=await this.#inventory.readShipmentIssueOutcomeInTransaction(tx,inventoryRead);
    record.phase="inventory.verify";const inventory=await this.#inventory.verifyShipmentIssueOutcomeProofInTransaction(tx,session,inventoryProof);
    record.phase="sales.verify";const sales=await this.#sales.verifyShipmentOutcomeProofInTransaction(tx,session,salesProof);
    if(inventory.state!=="ABSENT"||sales.state!=="ABSENT"){await this.logger?.error?.("shipment.reconciliation.unproven","Original Shipment owner outcome is not proven absent",{severity:inventory.state==="SUCCEEDED"||sales.state==="SUCCEEDED"?"critical":"error",code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE",correlationId:request.correlationId});return null;}
    await this.#assertLocalAbsence(tx,snapshot,record);
    shipmentIssuePayload(snapshot,inventory.facts);
    const activeClaims=snapshot.claims.filter(row=>BigInt(row.active_claimed_quantity)>0n),activeLines=new Set(activeClaims.map(row=>key(row.fulfillment_line_id))),sourceFacts={orderId:sales.sourceFacts.orderId,lines:sales.sourceFacts.lines.filter(line=>snapshot.lines.some(row=>activeLines.has(key(row.id))&&key(row.sales_order_line_id)===line.salesOrderLineId))};
    assertAllocationSourceFacts({header:snapshot.root,lines:snapshot.lines,claims:activeClaims},snapshot.allClaims,sourceFacts,inventory.facts.reservationFacts);
    return {source,snapshot};
   }finally{this.#sessions.delete(session);}
 }
 async inspectExpiredInTransaction(tx,token,eventId,signal){
  assertFulfillmentTransaction(this.database,tx);if(!this.#readRecovery||!(signal instanceof AbortSignal)||signal.aborted)conflict();
  await this.#readRecovery(tx,token);
  const [[operation]]=await tx.query("SELECT * FROM fulfillment_operation_requests WHERE event_id=? FOR UPDATE",[eventId]);
  if(!operation||operation.status!=="IN_PROGRESS"||operation.operation_type!=="SHIP"||operation.target_type!=="SHIPMENT"||operation.initiated_by===null)conflict();
  const [[shipment]]=await tx.query("SELECT * FROM shipments WHERE id=?",[operation.target_id]);
  if(!shipment||shipment.status!=="SHIPPING"||shipment.confirmation_event_id!==eventId||!Number.isSafeInteger(Number(shipment.version))||Number(shipment.version)<2)conflict();
  const request=freezeShipmentIntent({eventId,operationType:"SHIP",target:{type:"SHIPMENT",id:key(operation.target_id)},payload:shipmentConfirmationPayload(shipment,{eventId,version:Number(shipment.version)-1}),leaseOwner:operation.lease_owner,correlationId:operation.correlation_id}),identity=await readShipmentRecoveryActor(this.database,tx,key(operation.initiated_by));
  const record={request,actor:identity.actor,tx,signal,recoveryToken:token,inspectExpired:true};
  await this.#operation(tx,record);
  const proven=await this.#proveAbsence(tx,record);if(!proven)return {state:"UNKNOWN"};
  await this.#readRecovery(tx,token);await this.#operation(tx,record);
  const fresh=await readShipmentRecoveryActor(this.database,tx,key(operation.initiated_by));
  const inspection=Object.freeze({state:"ABSENT",request,actor:fresh.actor,eligible:fresh.eligible,operationId:key(operation.id),attemptCount:Number(operation.attempt_count)});
  this.#inspections.set(inspection,{record,proven});return inspection;
 }
 async #writeFailed(tx,record,{source,snapshot},code){
  const {request,actor}=record;
    const at=this.time.nowMs(),details={correlationId:request.correlationId,statusUrl:"/api/v1/fulfillment-operations/by-event/"+request.eventId};
    const [changed]=await tx.execute("UPDATE shipments SET status='DRAFT',confirmation_event_id=NULL,version=version+1,updated_at=?,last_business_updated_at=?,updated_by=? WHERE id=? AND status='SHIPPING' AND version=? AND confirmation_event_id=?",[at,at,actor.id,request.target.id,snapshot.shipment.version,request.eventId]);if(changed.affectedRows!==1)conflict();
    const [[sequence]]=await tx.query("SELECT COALESCE(MAX(sequence_no),0)+1 AS next FROM shipment_status_history WHERE shipment_id=?",[request.target.id]);if(Number(sequence.next)>4294967295)conflict();
    await tx.execute("INSERT INTO shipment_status_history (shipment_id,sequence_no,from_status,to_status,action,event_id,version_after,actor_user_id,actor_label,reason,occurred_at) VALUES (?,?,'SHIPPING','DRAFT','CONFIRM_FAIL',?,?,?,?,?,?)",[request.target.id,sequence.next,request.eventId,Number(snapshot.shipment.version)+1,actor.id,actor.username,code,at]);
    await tx.execute("INSERT INTO fulfillment_audit_logs (target_type,target_id,action,event_id,correlation_id,actor_user_id,actor_label,after_summary,occurred_at) VALUES ('SHIPMENT',?,'FAILED',?,?,?,?,?,?)",[request.target.id,request.eventId,request.correlationId,actor.id,actor.username,JSON.stringify({status:"DRAFT",version:Number(snapshot.shipment.version)+1,code,outcome:"FAILED"}),at]);
    const [failed]=await tx.execute("UPDATE fulfillment_operation_requests SET status='FAILED',result_json=NULL,public_error_code=?,public_error_details=?,lease_owner='',lease_expires_at=NULL,next_attempt_at=NULL,completed_at=?,updated_at=? WHERE id=? AND status='IN_PROGRESS' AND operation_type='SHIP' AND target_type='SHIPMENT' AND target_id=? AND event_id=? AND payload_hash=? AND initiated_by=? AND correlation_id=? AND lease_owner=? AND lease_expires_at>CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)",[code,JSON.stringify(details),at,at,(await this.#operation(tx,record)).id,request.target.id,request.eventId,source.scopeHash,actor.id,request.correlationId,request.leaseOwner]);if(failed.affectedRows!==1)conflict();
    return {state:"FAILED",code,details};
 }
 async deferExhaustedInTransaction(tx,token,inspection){
  assertFulfillmentTransaction(this.database,tx);const proof=this.#inspections.get(inspection);
  if(!proof||proof.record.tx!==tx||proof.record.recoveryToken!==token||proof.record.signal.aborted||!this.#readRecovery||inspection.eligible!==true||!Number.isSafeInteger(inspection.attemptCount)||inspection.attemptCount<SHIPMENT_RECOVERY_MAX_ATTEMPTS)conflict();
  this.#inspections.delete(inspection);const {record}=proof,{request}=record;
  await this.#readRecovery(tx,token);await this.#operation(tx,record);
  const identity=await readShipmentRecoveryActor(this.database,tx,key(record.actor.id));if(!identity.eligible)conflict();
  await this.#readRecovery(tx,token);
  // This consumed read proof grants only a fixed technical delay, never a nonce, attempt or business write.
  const [changed]=await tx.execute("UPDATE fulfillment_operation_requests SET next_attempt_at=GREATEST(COALESCE(next_attempt_at,0),CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)+?),updated_at=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) WHERE id=? AND event_id=? AND operation_type='SHIP' AND target_type='SHIPMENT' AND target_id=? AND initiated_by=? AND payload_hash=? AND correlation_id=? AND status='IN_PROGRESS' AND result_json IS NULL AND completed_at IS NULL AND public_error_code='' AND public_error_details IS NULL AND is_document_archived=0 AND lease_owner=? AND lease_expires_at<=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AND (next_attempt_at IS NULL OR next_attempt_at<=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)) AND attempt_count>=?",[SHIPMENT_RECOVERY_MAX_DELAY_MS,inspection.operationId,request.eventId,request.target.id,identity.actor.id,digest(request),request.correlationId,request.leaseOwner,SHIPMENT_RECOVERY_MAX_ATTEMPTS]);
  if(changed.affectedRows!==1)conflict();await this.#readRecovery(tx,token);
  return {state:"EXHAUSTED",correlationId:request.correlationId,attemptCount:inspection.attemptCount};
 }
 async finalizeRevokedInTransaction(tx,token,inspection){
  assertFulfillmentTransaction(this.database,tx);const proof=this.#inspections.get(inspection);
  if(!proof||proof.record.tx!==tx||proof.record.recoveryToken!==token||proof.record.signal.aborted||!this.#readRecovery)conflict();
  this.#inspections.delete(inspection);
  const {record,proven}=proof,{request:original}=record;
  await this.#readRecovery(tx,token);await this.#operation(tx,record);
  const identity=await readShipmentRecoveryActor(this.database,tx,key(record.actor.id));if(identity.eligible)conflict();
  const request=freezeShipmentIntent({...original,leaseOwner:randomUUID()}),[[clock]]=await tx.query("SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms"),now=Number(clock?.now_ms);
  if(!Number.isSafeInteger(now)||now<0)conflict();
  // Only the actual original expired nonce and complete same-transaction zero-effect proof permit this failure-only fence.
  const [changed]=await tx.execute("UPDATE fulfillment_operation_requests SET lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1,next_attempt_at=NULL,updated_at=? WHERE id=? AND event_id=? AND operation_type='SHIP' AND target_type='SHIPMENT' AND target_id=? AND initiated_by=? AND payload_hash=? AND correlation_id=? AND status='IN_PROGRESS' AND result_json IS NULL AND completed_at IS NULL AND public_error_code='' AND public_error_details IS NULL AND is_document_archived=0 AND lease_owner=? AND lease_expires_at<=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AND (next_attempt_at IS NULL OR next_attempt_at<=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)) AND attempt_count<4294967295",[request.leaseOwner,now+this.#leaseMs,now,inspection.operationId,request.eventId,request.target.id,identity.actor.id,digest(request),request.correlationId,original.leaseOwner]);
  if(changed.affectedRows!==1)conflict();
  const fenced={...record,request,actor:identity.actor,inspectExpired:false};
  await this.#readRecovery(tx,token);await this.#operation(tx,fenced,{admit:true});
  const finalIdentity=await readShipmentRecoveryActor(this.database,tx,key(identity.actor.id));if(finalIdentity.eligible)conflict();
  return this.#writeFailed(tx,fenced,proven,"FULFILLMENT_PERMISSION_DENIED");
 }
 async finalize(token){
  const attempt=this.#readAttempt(token),code=permanent.get(attempt?.errorCode)??null;
  if(!attempt||!code||attempt.signal?.aborted||getTransactionOutcome(attempt.tx)?.state!=="ROLLED_BACK")return {state:"UNKNOWN"};
  const request=attempt.request,actor=attempt.actor;
  if(!actor||!Object.isFrozen(actor)||!Object.isFrozen(request)||this.database.context?.get()?.databaseTransaction)conflict();
  if(attempt.recoveryToken)await this.#readRecovery(null,attempt.recoveryToken);
  const lease=await this.database.withTransaction(async tx=>{
   assertFulfillmentTransaction(this.database,tx);if(attempt.recoveryToken)await this.#readRecovery(tx,attempt.recoveryToken);
   await tx.query("SELECT id FROM fulfillment_operation_requests WHERE event_id=? FOR UPDATE",[request.eventId]);assertShipmentLeaseBoundary(attempt,request,this.#leaseMs);await this.#operation(tx,{request,actor});
   return readOrRenewShipmentLease(this.database,tx,request,this.#leaseMs);
  },{isolationLevel:"READ COMMITTED",signal:attempt.signal}),entry=shipmentLeaseEntry(lease,attempt.signal);
  try{if(attempt.recoveryToken)await this.#readRecovery(null,attempt.recoveryToken);return await this.database.withTransaction(async(tx,{signal})=>{
   assertFulfillmentTransaction(this.database,tx);if(attempt.recoveryToken)await this.#readRecovery(tx,attempt.recoveryToken);
   const [locks]=await tx.query("SELECT id FROM fulfillment_operation_requests WHERE event_id=? FOR UPDATE",[request.eventId]);if(locks.length!==1)conflict();entry.locked();
   const initial={request,actor};await this.#operation(tx,initial,{admit:true});
   const currentActor=await requireFulfillmentActor(this.database,tx,"fulfillment.operation");if(key(currentActor.id)!==key(actor.id))conflict();
   const record={token,attempt,request,actor,tx,signal},proven=await this.#proveAbsence(tx,record);if(!proven)return {state:"UNKNOWN"};
   const {source,snapshot}=proven;
    if(attempt.recoveryToken)await this.#readRecovery(tx,attempt.recoveryToken);await this.#operation(tx,record);const finalActor=await requireFulfillmentActor(this.database,tx,"fulfillment.operation");if(key(finalActor.id)!==source.actorId)conflict();
    return this.#writeFailed(tx,record,{source,snapshot},code);
  },{isolationLevel:"READ COMMITTED",signal:entry.signal});}finally{entry.close();}
 }
}
