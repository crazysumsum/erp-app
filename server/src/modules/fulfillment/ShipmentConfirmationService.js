import { randomUUID } from "node:crypto";
import { FulfillmentTransactionService } from "./FulfillmentTransactionService.js";
import { FulfillmentOperationService } from "./FulfillmentOperationService.js";
import { lockFulfillmentRowsInTransaction } from "./FulfillmentLockService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentOperationHash } from "./fulfillmentOperationHash.js";
import { normalizeShipmentDraft } from "./shipmentDraftCommand.js";
import { assertShipmentConfirmationHistory } from "./shipmentConfirmationWitness.js";
import { fulfillmentError } from "./fulfillmentErrors.js";

const fail=code=>{throw fulfillmentError(code);};
const sourceColumns="id,shipment_number,fulfillment_id,sales_order_id,customer_id,warehouse_id,status,version,line_count,shipping_address_id,shipping_address_version,shipping_contact_id,shipping_contact_version,carrier_name,tracking_number,package_count,total_weight,weight_uom,notes,confirmation_event_id";
function command(input){
 if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.getOwnPropertySymbols(input).length||Object.keys(input).sort().join(",")!=="eventId,version"||typeof input.eventId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(input.eventId)||!Number.isSafeInteger(input.version)||input.version<1||input.version>4294967295)fail("FULFILLMENT_INPUT_INVALID");
 return Object.freeze({...input});
}
function payload(row,input){
 try{
  const refs=Object.fromEntries([['shipmentId','id'],['fulfillmentId','fulfillment_id'],['salesOrderId','sales_order_id'],['customerId','customer_id'],['warehouseId','warehouse_id']].map(([key,column])=>{const value=String(row[column]);fulfillmentInteger(value);return [key,value];}));
  const draft=normalizeShipmentDraft({...input,shippingAddressId:Number(row.shipping_address_id),shippingAddressVersion:Number(row.shipping_address_version),shippingContactId:row.shipping_contact_id===null?null:Number(row.shipping_contact_id),shippingContactVersion:row.shipping_contact_version===null?null:Number(row.shipping_contact_version),carrierName:row.carrier_name,trackingNumber:row.tracking_number,packageCount:row.package_count===null?null:Number(row.package_count),totalWeight:row.total_weight,weightUom:row.weight_uom,notes:row.notes},{update:true});
  return Object.freeze({...refs,...draft});
 }catch{fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");}
}
const digest=request=>fulfillmentOperationHash({operationType:"SHIP",target:request.target,payload:request.payload});
const pending=operation=>({outcome:"SHIPPING",operationId:operation.operationId,eventId:operation.eventId,correlationId:operation.correlationId,statusUrl:"/api/v1/fulfillment-operations/by-event/"+operation.eventId,retryAfterSeconds:2});
function terminal(operation){if(operation.status==="FAILED")throw fulfillmentError(operation.publicErrorCode,operation.publicErrorDetails);return {outcome:"SHIPPED",operationId:operation.operationId,eventId:operation.eventId,correlationId:operation.correlationId,result:operation.result};}
export class ShipmentConfirmationService {
 constructor({database,time,logger}){Object.assign(this,{database,time,logger});this.transactions=new FulfillmentTransactionService({database});this.operations=new FulfillmentOperationService({database,time});}
 async startConfirmation(shipmentId,input){
  try{fulfillmentInteger(shipmentId);}catch{fail("FULFILLMENT_INPUT_INVALID");}
  const intent=command(input);
  return this.transactions.withTransaction(async tx=>{
   const replay=await this.operations.getShipmentConfirmationReplayInTransaction(tx,{shipmentId,...intent});if(replay)return terminal(replay);
   const [[before]]=await tx.query(`SELECT ${sourceColumns} FROM shipments WHERE id=?`,[shipmentId]);if(!before)fail("SHIPMENT_NOT_FOUND");
   if(!["DRAFT","SHIPPING"].includes(before.status)||before.status==="SHIPPING"&&before.confirmation_event_id!==intent.eventId)fail("SHIPMENT_STATE_CONFLICT");
   if(Number(before.version)!==intent.version+(before.status==="SHIPPING"?1:0))fail("VERSION_CONFLICT");
   const request=Object.freeze({eventId:intent.eventId,operationType:"SHIP",target:Object.freeze({type:"SHIPMENT",id:shipmentId}),payload:payload(before,intent),leaseOwner:randomUUID(),correlationId:randomUUID()});
   const operation=await this.operations.claimInTransaction(tx,request);
   if(operation.replay)return terminal(operation);
   const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.operation");
   if(!operation.created){
    // Duplicate INSERT holds the source lock: read only, never upgrade or take over here.
    const [[current]]=await tx.query(`SELECT ${sourceColumns} FROM shipments WHERE id=?`,[shipmentId]);
    if(!current||current.status!=="SHIPPING"||current.confirmation_event_id!==intent.eventId||Number(current.version)!==intent.version+1||digest({...request,payload:payload(current,intent)})!==digest(request))fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
    const [history]=await tx.query("SELECT shipment_id,event_id,action,from_status,to_status,actor_user_id,version_after FROM shipment_status_history WHERE shipment_id=? AND event_id=? AND action='CONFIRM_START' LIMIT 2",[shipmentId,intent.eventId]);assertShipmentConfirmationHistory(history,{shipmentId,...intent,actorId:actor.id});return pending(operation);
   }
   if(intent.version>4294967293)fail("VERSION_CONFLICT");
   const [root]=await lockFulfillmentRowsInTransaction(tx,"fulfillments",[before.fulfillment_id]);
   if(root.status!=="PICKED"||String(root.active_shipment_id)!==shipmentId)fail("FULFILLMENT_STATE_CONFLICT");
   const [ids]=await tx.query("SELECT id FROM fulfillment_lines WHERE fulfillment_id=? ORDER BY id",[root.id]);
   if(!ids.length||ids.length>100||ids.length!==Number(root.line_count))fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
   const lines=await lockFulfillmentRowsInTransaction(tx,"fulfillment_lines",ids.map(row=>row.id));
   const [row]=await lockFulfillmentRowsInTransaction(tx,"shipments",[shipmentId]);
   if(row.status!=="DRAFT")fail("SHIPMENT_STATE_CONFLICT");if(Number(row.version)!==intent.version)fail("VERSION_CONFLICT");
   if(String(row.fulfillment_id)!==String(root.id)||String(row.sales_order_id)!==String(root.sales_order_id)||String(row.customer_id)!==String(root.customer_id)||String(row.warehouse_id)!==String(root.warehouse_id)||digest({...request,payload:payload(row,intent)})!==digest(request))fail("FULFILLMENT_SOURCE_CONFLICT");
   const [childIds]=await tx.query("SELECT id FROM shipment_lines WHERE shipment_id=? ORDER BY id",[shipmentId]);
   if(childIds.length!==lines.length||childIds.length!==Number(row.line_count))fail("FULFILLMENT_SOURCE_CONFLICT");
   const children=await lockFulfillmentRowsInTransaction(tx,"shipment_lines",childIds.map(row=>row.id)),seen=new Set();let picked=0n;
   for(const child of children){const id=String(child.fulfillment_line_id),line=lines.find(source=>String(source.id)===id);if(!line||seen.has(id)||String(child.fulfillment_id)!==String(root.id)||String(child.sales_order_line_id)!==String(line.sales_order_line_id)||String(child.sku_id)!==String(line.sku_id)||String(child.base_uom_id)!==String(line.base_uom_id)||String(child.shipped_base_quantity)!==String(line.picked_base_quantity)||String(child.reversed_base_quantity)!=="0")fail("FULFILLMENT_SOURCE_CONFLICT");seen.add(id);picked+=fulfillmentInteger(String(child.shipped_base_quantity),{positive:false});}
   if(picked===0n)fail("FULFILLMENT_SOURCE_CONFLICT");
   const at=this.time.nowMs(),[changed]=await tx.execute("UPDATE shipments SET status='SHIPPING',confirmation_event_id=?,correlation_id=?,version=version+1,updated_at=?,last_business_updated_at=?,updated_by=? WHERE id=? AND status='DRAFT' AND version=?",[intent.eventId,request.correlationId,at,at,actor.id,shipmentId,intent.version]);if(changed.affectedRows!==1)fail("VERSION_CONFLICT");
   const [[sequence]]=await tx.query("SELECT COALESCE(MAX(sequence_no),0)+1 AS next_sequence FROM shipment_status_history WHERE shipment_id=?",[shipmentId]);
   await tx.execute("INSERT INTO shipment_status_history (shipment_id,sequence_no,from_status,to_status,action,event_id,version_after,actor_user_id,actor_label,occurred_at) VALUES (?,?,'DRAFT','SHIPPING','CONFIRM_START',?,?,?,?,?)",[shipmentId,sequence.next_sequence,intent.eventId,intent.version+1,actor.id,actor.username,at]);
   await tx.execute("INSERT INTO fulfillment_audit_logs (target_type,target_id,action,event_id,correlation_id,actor_user_id,actor_label,after_summary,occurred_at) VALUES ('SHIPMENT',?,'SHIP',?,?,?,?,?,?)",[shipmentId,intent.eventId,request.correlationId,actor.id,actor.username,JSON.stringify({shipmentId,fulfillmentId:String(root.id),status:"SHIPPING",version:intent.version+1}),at]);
   return pending(operation);
  });
 }
}
