import { assertFulfillmentTransaction } from "./FulfillmentTransactionService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { fulfillmentOperationHash } from "./fulfillmentOperationHash.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { getTransactionOutcome } from "../../services/mysqldatabase/MySqlDatabaseService.js";

const fail=()=>{throw fulfillmentError("CONCURRENT_OPERATION");};
// The coordinator supplies this record from its private same-event registry, never from a command.
// The timestamp is taken while its actual source operation X lock is still known held, before commit/rollback.
export function assertShipmentLeaseBoundary(boundary,request,leaseMs){
 if(!boundary||!Object.isFrozen(boundary)||boundary.request!==request||boundary.operationLocked!==true||!["COMMITTED","ROLLED_BACK"].includes(boundary.outcome)||getTransactionOutcome(boundary.tx)?.state!==boundary.outcome||!Number.isFinite(boundary.knownLockedAtMono)||performance.now()>=boundary.knownLockedAtMono+Math.floor(leaseMs/2))fail();
}
export function shipmentTransactionBudget(database){
 const value=database.config?.transactionTimeoutMs;
 if(!Number.isSafeInteger(value)||value<1||value>20000)throw new TypeError("Shipment requires the existing bounded database transaction configuration");
 return value;
}

// Called only after the coordinator's original-event replay check, in its own short transaction.
// The returned data grants no business authority; every posting transaction rechecks the actual locked row.
export async function readOrRenewShipmentLease(database,tx,request,leaseMs){
 assertFulfillmentTransaction(database,tx);
 const budget=shipmentTransactionBudget(database),acquire=database.config.acquireTimeoutMs,query=database.config.queryTimeoutMs;
 if(!Number.isSafeInteger(leaseMs)||leaseMs<1||leaseMs>2147483647||![acquire,query].every(value=>Number.isSafeInteger(value)&&value>0))throw new TypeError("Actual Shipment lease budgets required");
 const actor=await requireFulfillmentActor(database,tx,"fulfillment.operation"),[[row]]=await tx.query("SELECT * FROM fulfillment_operation_requests WHERE event_id=? FOR UPDATE",[request.eventId]);
 const beforeClock=performance.now(),[[clock]]=await tx.query("SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms"),now=Number(clock?.now_ms),expires=Number(row?.lease_expires_at);
 const hash=fulfillmentOperationHash({operationType:"SHIP",target:request.target,payload:request.payload});
 if(!row||request.operationType!=="SHIP"||request.target.type!=="SHIPMENT"||row.operation_type!=="SHIP"||row.target_type!=="SHIPMENT"||String(row.target_id)!==request.target.id||row.event_id!==request.eventId||String(row.initiated_by)!==String(actor.id)||row.payload_hash!==hash||row.correlation_id!==request.correlationId||row.lease_owner!==request.leaseOwner||!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(expires)||expires<=now||row.status!=="IN_PROGRESS"||row.result_json!==null||row.completed_at!==null||row.public_error_code!==""||row.public_error_details!==null||row.next_attempt_at!==null||Number(row.is_document_archived)!==0)fail();
 let halfRemaining=expires-Math.ceil(leaseMs/2)-now,publishedExpiry=expires,renewed=false;
 if(expires-now<budget+acquire||halfRemaining<acquire+query){
  const [changed]=await tx.execute("UPDATE fulfillment_operation_requests SET lease_expires_at=?,updated_at=? WHERE id=? AND event_id=? AND operation_type='SHIP' AND target_type='SHIPMENT' AND target_id=? AND initiated_by=? AND payload_hash=? AND correlation_id=? AND lease_owner=? AND status='IN_PROGRESS' AND is_document_archived=0 AND lease_expires_at>CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)",[now+leaseMs,now,row.id,request.eventId,request.target.id,actor.id,hash,request.correlationId,request.leaseOwner]);
  if(changed.affectedRows!==1)fail();publishedExpiry=now+leaseMs;halfRemaining=Math.floor(leaseMs/2);renewed=true;
 }
 return Object.freeze({operationId:String(row.id),entryDeadlineMono:beforeClock+halfRemaining,publishedExpiry,renewed});
}

// Stop entry before half-lease if connection acquisition/locking cannot finish in time.
// HD027 A permits cancelling this timer only after the exact operation X row was actually acquired.
export function shipmentLeaseEntry(receipt,signal){
 if(!receipt||!Object.isFrozen(receipt)||!Number.isFinite(receipt.entryDeadlineMono)||signal!==undefined&&!(signal instanceof AbortSignal))throw new TypeError("Private published Shipment lease entry required");
 const controller=new AbortController(),remaining=Math.floor(receipt.entryDeadlineMono-performance.now());
 const abort=()=>controller.abort(fulfillmentError("CONCURRENT_OPERATION"));
 const timer=remaining>0?setTimeout(abort,remaining):null;if(timer)timer.unref?.();else abort();
 const close=()=>clearTimeout(timer);
 const locked=()=>{if(controller.signal.aborted||signal?.aborted||performance.now()>=receipt.entryDeadlineMono){abort();fail();}close();};
 return {signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,locked,close};
}
