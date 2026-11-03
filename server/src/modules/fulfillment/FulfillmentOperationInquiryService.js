import { FulfillmentTransactionService } from "./FulfillmentTransactionService.js";
import { FulfillmentOperationService } from "./FulfillmentOperationService.js";
import { FULFILLMENT_OPERATION_TYPES } from "./fulfillmentConstants.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
const uuid=value=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
const unavailable=()=>{throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");};
const absent=()=>{throw fulfillmentError("FULFILLMENT_NOT_FOUND");};
export class FulfillmentOperationInquiryService {
 constructor({database,time}){this.transactions=new FulfillmentTransactionService({database});this.operations=new FulfillmentOperationService({database,time});}
 lookup(eventId){
  if(!uuid(eventId))throw fulfillmentError("FULFILLMENT_INPUT_INVALID");
  return this.transactions.withTransaction(async tx=>{
   const operation=await this.operations.getForActorInTransaction(tx,eventId);if(!operation)absent();
   const [[source]]=await tx.query("SELECT target_type,target_id,operation_type,is_document_archived FROM fulfillment_operation_requests WHERE event_id=?",[eventId]);
   if(!source)absent();if(Number(source.is_document_archived)===1)absent();
   if(Number(source.is_document_archived)!==0||!FULFILLMENT_OPERATION_TYPES.includes(source.operation_type)||!uuid(operation.correlationId)||operation.eventId!==eventId)unavailable();
   const shipmentType=["SHIPMENT_CREATE","SHIPMENT_UPDATE","SHIPMENT_CANCEL","SHIP","REVERSE"].includes(source.operation_type);
   if(source.target_type!==(source.operation_type==="EXPORT"?"EXPORT":shipmentType?"SHIPMENT":"FULFILLMENT"))unavailable();
   if(source.operation_type==="EXPORT")absent();
   if(source.target_id===null&&["CREATE","SHIPMENT_CREATE"].includes(source.operation_type))absent();
   fulfillmentInteger(String(source.target_id));
   let shipment=null,fulfillmentId=String(source.target_id);
   if(shipmentType){[[shipment]]=await tx.query("SELECT id,fulfillment_id,sales_order_id,customer_id,warehouse_id FROM shipments WHERE id=?",[source.target_id]);if(!shipment)absent();fulfillmentId=String(shipment.fulfillment_id);}
   const [[root]]=await tx.query("SELECT id,sales_order_id,customer_id,warehouse_id FROM fulfillments WHERE id=?",[fulfillmentId]);if(!root)absent();
   const [[order]]=await tx.query("SELECT id,customer_id,fulfillment_warehouse_id FROM sales_orders WHERE id=?",[root.sales_order_id]);
   if(!order||String(root.customer_id)!==String(order.customer_id)||String(root.warehouse_id)!==String(order.fulfillment_warehouse_id)||shipment&&["sales_order_id","customer_id","warehouse_id"].some(key=>String(shipment[key])!==String(root[key])))unavailable();
   const result=operation.status==="SUCCEEDED"?{id:operation.result.id,status:operation.result.status,version:operation.result.version,...(operation.result.number===undefined?{}:{number:operation.result.number})}:null;
   return {operationId:operation.operationId,eventId:operation.eventId,correlationId:operation.correlationId,status:operation.status,result,publicErrorCode:operation.status==="FAILED"?operation.publicErrorCode:null,publicErrorDetails:operation.status==="FAILED"?operation.publicErrorDetails:null};
  }).catch(error=>{if(error?.statusCode===403||error?.code==="FULFILLMENT_NOT_FOUND"&&error.statusCode===404)throw error;const failure=fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");failure.cause=error;throw failure;});
 }
}
