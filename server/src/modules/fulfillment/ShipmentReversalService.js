import { randomUUID } from "node:crypto";
import { FulfillmentTransactionService } from "./FulfillmentTransactionService.js";
import { FulfillmentOperationService } from "./FulfillmentOperationService.js";
import { FulfillmentSequenceService } from "./FulfillmentSequenceService.js";
import { FulfillmentDownstreamMatterService } from "./FulfillmentDownstreamMatterService.js";
import { lockFulfillmentRowsInTransaction } from "./FulfillmentLockService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { normalizeShipmentReversal } from "./shipmentReversalCommand.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";

const fail=code=>{throw fulfillmentError(code);};
function pending(operation,reversal,shipmentVersion){
 return Object.freeze({outcome:"REVERSING",operationId:operation.operationId,eventId:operation.eventId,correlationId:operation.correlationId,statusUrl:`/api/v1/fulfillment-operations/by-event/${operation.eventId}`,retryAfterSeconds:2,reversal:Object.freeze({id:String(reversal.id),number:reversal.reversal_number,version:Number(reversal.version)}),shipmentVersion});
}
export class ShipmentReversalService {
 constructor({database,time,downstreamRegistry,operationLeaseMs=60000}){
  Object.assign(this,{database,time});this.transactions=new FulfillmentTransactionService({database});this.operations=new FulfillmentOperationService({database,time,leaseMs:operationLeaseMs});this.sequence=new FulfillmentSequenceService({database,time});this.downstream=new FulfillmentDownstreamMatterService({database,registry:downstreamRegistry});
 }
 async startReversal(shipmentId,input){
  try{fulfillmentInteger(shipmentId);}catch{fail("FULFILLMENT_INPUT_INVALID");}
  const command=normalizeShipmentReversal(input),number=await this.sequence.reserveNumber({documentType:"REVERSAL"});
  const request={eventId:command.eventId,operationType:"REVERSE",target:{type:"SHIPMENT",id:shipmentId},payload:command,leaseOwner:randomUUID(),correlationId:randomUUID()};
  return this.transactions.withTransaction(async tx=>{
   const operation=await this.operations.claimInTransaction(tx,request);
   if(operation.replay){if(operation.status==="FAILED")fail(operation.publicErrorCode);return Object.freeze({outcome:"REVERSED",shipment:operation.result});}
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
   return pending(operation,{id:reversalId,reversal_number:number,version:1},command.version+1);
  });
 }
}
