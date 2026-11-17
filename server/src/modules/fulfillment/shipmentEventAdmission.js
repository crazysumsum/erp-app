import { hasTransactionEventAdmission } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { assertFulfillmentTransaction } from "./FulfillmentTransactionService.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { fulfillmentOperationHash } from "./fulfillmentOperationHash.js";

const unavailable=()=>{throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");};

async function eventRow(database,tx,eventId){
 if(!hasTransactionEventAdmission(database,tx,eventId))unavailable();
 // A locking journal read is current even for unrelated callers retaining RR.
 const [rows]=await tx.query("SELECT * FROM fulfillment_operation_requests WHERE event_id=? LIMIT 2 FOR SHARE",[eventId]);
 if(rows.length>1)unavailable();
 return rows[0]??null;
}

// The public assertion never creates a managed-writer capability.
export async function assertShipmentEventAdmissionInTransaction(database,tx,{eventId}){
 const row=await eventRow(database,tx,eventId);
 if(row?.operation_type==="REVERSE")unavailable();
 return Object.freeze({state:"UNMANAGED"});
}

export class ShipmentEventAdmission {
 #writers=new WeakMap();
 #readWriter;
 constructor({database,readWriter}){this.database=database;this.#readWriter=readWriter;}
 async enterWriter(tx,token){
  assertFulfillmentTransaction(this.database,tx);
  const binding=this.#readWriter(token);if(!binding)unavailable();
  const {request}=binding,row=await eventRow(this.database,tx,request.eventId);
  if(!row||row.status!=="IN_PROGRESS"||row.operation_type!=="REVERSE"||row.target_type!=="SHIPMENT"||String(row.target_id)!==request.target.id||
     String(row.id)!==binding.operationId||String(row.initiated_by)!==binding.initiatorId||row.payload_hash!==fulfillmentOperationHash(request)||row.correlation_id!==binding.correlationId||
     row.lease_owner!==binding.leaseOwner||Number(row.attempt_count)!==binding.attemptCount||Number(row.is_document_archived)!==0)unavailable();
  const [[shipment]]=await tx.query("SELECT id,fulfillment_id,sales_order_id,customer_id,warehouse_id,reversal_event_id,correlation_id FROM shipments WHERE id=?",[request.target.id]);
  if(!shipment||String(shipment.id)!==request.target.id||shipment.reversal_event_id!==request.eventId||shipment.correlation_id!==request.correlationId)unavailable();
  this.#writers.set(tx,{token,binding,shipment});
 }
 async verifyWriter(tx,{eventId,shipmentId,action}){
  const granted=this.#writers.get(tx);
  if(!granted)return assertShipmentEventAdmissionInTransaction(this.database,tx,{eventId});
  const {token,binding,shipment}=granted,{request}=binding;
  if(this.#readWriter(token)!==binding||request.eventId!==eventId||shipmentId!==undefined&&shipmentId!==null&&String(shipmentId)!==request.target.id||action!==undefined&&action!==null&&!["REVERSE","SHIPMENT_REVERSE"].includes(action))unavailable();
  await this.enterWriter(tx,token);
  if(String(this.database.context.get()?.auth?.claims?.sub)!==binding.initiatorId)unavailable();
  return Object.freeze({state:"MANAGED",eventId,shipmentId:request.target.id,fulfillmentId:String(shipment.fulfillment_id),salesOrderId:String(shipment.sales_order_id),customerId:String(shipment.customer_id),warehouseId:String(shipment.warehouse_id),actorId:binding.initiatorId});
 }
 close(tx){this.#writers.delete(tx);}
}
