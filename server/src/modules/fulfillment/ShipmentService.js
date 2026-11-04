import { randomUUID } from "node:crypto";
import { FulfillmentTransactionService } from "./FulfillmentTransactionService.js";
import { FulfillmentOperationService } from "./FulfillmentOperationService.js";
import { FulfillmentSequenceService } from "./FulfillmentSequenceService.js";
import { lockFulfillmentRowsInTransaction } from "./FulfillmentLockService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { CustomerLookupService } from "../customer/CustomerLookupService.js";
import { normalizeShipmentDraft, normalizeShipmentCancel } from "./shipmentDraftCommand.js";
import { normalizeShipmentWeight } from "./shipmentWeight.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { assertFulfillmentQuantities } from "./fulfillmentQuantityMath.js";
import { fulfillmentError } from "./fulfillmentErrors.js";

const fail=code=>{throw fulfillmentError(code);};
const logistics=command=>({shipping_address_id:command.shippingAddressId,shipping_address_version:command.shippingAddressVersion,shipping_contact_id:command.shippingContactId,shipping_contact_version:command.shippingContactVersion,carrier_name:command.carrierName,tracking_number:command.trackingNumber,package_count:command.packageCount,total_weight:command.totalWeight,weight_uom:command.weightUom,notes:command.notes});
async function insert(tx,table,row){const columns=Object.keys(row),[result]=await tx.execute(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`,Object.values(row));return String(result.insertId);}
function identifier(value){try{fulfillmentInteger(value);}catch{fail("FULFILLMENT_INPUT_INVALID");}return value;}
export class ShipmentService {
 constructor({database,time,logger}){Object.assign(this,{database,time,logger});this.transactions=new FulfillmentTransactionService({database});this.operations=new FulfillmentOperationService({database,time});this.sequence=new FulfillmentSequenceService({database,time});this.customers=new CustomerLookupService({database,time,logger});}
 authorizeWrite(){return this.transactions.withTransaction(tx=>requireFulfillmentActor(this.database,tx,"fulfillment.operation")).then(()=>true);}
 async #address(tx,root,command){
  const customerId=Number(root.customer_id);
  try {
  await this.customers.assertAddressUsableInTransaction(tx,customerId,command.shippingAddressId,{purpose:"shipping",expectedVersion:command.shippingAddressVersion,atMs:this.time.nowMs()});
  if(command.shippingContactId!==null)await this.customers.assertContactUsableInTransaction(tx,customerId,command.shippingContactId,{purpose:"shipping",expectedVersion:command.shippingContactVersion,atMs:this.time.nowMs()});
  } catch(error) {
   if(error.code==="VERSION_CONFLICT")fail("SHIPPING_ADDRESS_CHANGED");
   if(error.code==="CUSTOMER_PARTY_NOT_FOUND")fail("SHIPPING_ADDRESS_UNAVAILABLE");
   fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
  }
 }
 async #root(tx,id){
  const [[exists]]=await tx.query("SELECT id FROM fulfillments WHERE id=?",[id]);if(!exists)fail("FULFILLMENT_NOT_FOUND");
  const [root]=await lockFulfillmentRowsInTransaction(tx,"fulfillments",[id]);
  if(root.status!=="PICKED")fail("FULFILLMENT_STATE_CONFLICT");
  if(Number(root.version)>=4294967295)fail("VERSION_CONFLICT");return root;
 }
 async #record(tx,row,action,request,actor,fromStatus){
  const at=this.time.nowMs(),[[history]]=await tx.query("SELECT COALESCE(MAX(sequence_no),0)+1 AS next FROM shipment_status_history WHERE shipment_id=?",[row.id]);
  await insert(tx,"shipment_status_history",{shipment_id:row.id,sequence_no:Number(history.next),from_status:fromStatus,to_status:row.status,action,event_id:request.eventId,version_after:row.version,actor_user_id:actor.id,actor_label:actor.username,reason:request.payload.reason??"",occurred_at:at});
  await insert(tx,"fulfillment_audit_logs",{target_type:"SHIPMENT",target_id:row.id,action,event_id:request.eventId,correlation_id:request.correlationId,actor_user_id:actor.id,actor_label:actor.username,after_summary:JSON.stringify({shipmentId:row.id,fulfillmentId:String(row.fulfillment_id),status:row.status,version:row.version}),occurred_at:at});
 }
 async #pointer(tx,root,shipmentId,actor){
  const at=this.time.nowMs(),[result]=await tx.execute("UPDATE fulfillments SET active_shipment_id=?,version=version+1,updated_at=?,last_business_updated_at=?,updated_by=? WHERE id=? AND status='PICKED' AND version=? AND active_shipment_id<=>?",[shipmentId,at,at,actor.id,root.id,root.version,root.active_shipment_id]);if(result.affectedRows!==1)fail("VERSION_CONFLICT");
 }
 async #projection(outcome,request){
  try{return {outcome,shipment:await this.detail(outcome.id)};}
  catch(error){
   if(["FULFILLMENT_PERMISSION_DENIED","PERMISSION_STALE"].includes(error.code))throw error;
   await this.logger.error("shipment.projection_unavailable","Command succeeded but current projection is unavailable",{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE",correlationId:request.correlationId});
   throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE",{correlationId:request.correlationId});
  }
 }
 async createDraft(fulfillmentId,input){
  identifier(fulfillmentId);const command=normalizeShipmentDraft(input),number=await this.sequence.reserveNumber({documentType:"SHIPMENT"});
  const request={eventId:command.eventId,operationType:"SHIPMENT_CREATE",target:{type:"SHIPMENT",id:null},payload:{fulfillmentId,...command},leaseOwner:randomUUID(),correlationId:randomUUID()};
  const outcome=await this.transactions.withTransaction(async tx=>{
   const operation=await this.operations.claimInTransaction(tx,request);if(operation.replay){if(operation.status==="FAILED")fail(operation.publicErrorCode);return operation.result;}if(!operation.created)fail("CONCURRENT_OPERATION");
   const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.operation"),[[route]]=await tx.query("SELECT sales_order_id FROM fulfillments WHERE id=?",[fulfillmentId]);if(!route)fail("FULFILLMENT_NOT_FOUND");
   // Take the INSERT's Sales FK parent lock before Fulfillment and Customer locks.
   const [[salesParent]]=await tx.query("SELECT id FROM sales_orders WHERE id=? FOR SHARE",[route.sales_order_id]);if(!salesParent)fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
   const root=await this.#root(tx,fulfillmentId);if(String(root.sales_order_id)!==String(salesParent.id))fail("FULFILLMENT_SOURCE_CONFLICT");
   const [active]=await tx.query("SELECT id FROM shipments WHERE fulfillment_id=? AND status<>'CANCELLED' ORDER BY id LIMIT 2",[fulfillmentId]);
   if(root.active_shipment_id!==null||active.length)fail("SHIPMENT_ALREADY_EXISTS");
   const [ids]=await tx.query("SELECT id FROM fulfillment_lines WHERE fulfillment_id=? ORDER BY id",[fulfillmentId]);
   if(ids.length!==Number(root.line_count)||!ids.length||ids.length>100)fail("FULFILLMENT_SOURCE_CONFLICT");
   const lines=await lockFulfillmentRowsInTransaction(tx,"fulfillment_lines",ids.map(row=>row.id));
   const [totals]=await tx.query("SELECT fulfillment_line_id,SUM(allocated_base_quantity) AS allocated,SUM(released_base_quantity) AS released,SUM(picked_base_quantity) AS picked FROM fulfillment_allocations WHERE fulfillment_id=? GROUP BY fulfillment_line_id",[fulfillmentId]);
   if(totals.length!==lines.length)fail("FULFILLMENT_SOURCE_CONFLICT");
   assertFulfillmentQuantities("PICKED",lines.map(line=>{
    const total=totals.find(row=>String(row.fulfillment_line_id)===String(line.id));
    if(!total||String(total.allocated)!==String(line.allocated_base_quantity)||String(total.picked)!==String(line.picked_base_quantity))fail("FULFILLMENT_SOURCE_CONFLICT");
    return {planned:String(line.planned_base_quantity),allocated:String(line.allocated_base_quantity),released:String(total.released),picked:String(line.picked_base_quantity),short:String(line.short_base_quantity),shipped:String(line.shipped_base_quantity),reversed:String(line.reversed_base_quantity)};
   }));
   if(lines.reduce((sum,line)=>sum+BigInt(line.picked_base_quantity),0n)===0n)fail("FULFILLMENT_SOURCE_CONFLICT");
   await this.#address(tx,root,command);const at=this.time.nowMs();
   const id=await insert(tx,"shipments",{shipment_number:number,fulfillment_id:fulfillmentId,sales_order_id:root.sales_order_id,customer_id:root.customer_id,warehouse_id:root.warehouse_id,...logistics(command),line_count:lines.length,last_business_updated_at:at,created_at:at,updated_at:at,created_by:actor.id,updated_by:actor.id});
   for(const line of lines)await insert(tx,"shipment_lines",{shipment_id:id,fulfillment_id:fulfillmentId,fulfillment_line_id:line.id,line_no:line.line_no,sales_order_line_id:line.sales_order_line_id,sku_id:line.sku_id,base_uom_id:line.base_uom_id,sku_code_snapshot:"",sku_name_snapshot:"",base_uom_code_snapshot:"",shipped_base_quantity:line.picked_base_quantity,created_at:at,updated_at:at});
   await this.#pointer(tx,root,id,actor);await this.#record(tx,{id,fulfillment_id:fulfillmentId,status:"DRAFT",version:1},"CREATE",request,actor,null);
   const result={id,number,status:"DRAFT",version:1};await this.operations.succeedInTransaction(tx,{request,result});return result;
  });return this.#projection(outcome,request);
 }
 async #change(shipmentId,input,cancel){
  identifier(shipmentId);const command=cancel?normalizeShipmentCancel(input):normalizeShipmentDraft(input,{update:true});
  const request={eventId:command.eventId,operationType:cancel?"SHIPMENT_CANCEL":"SHIPMENT_UPDATE",target:{type:"SHIPMENT",id:shipmentId},payload:command,leaseOwner:randomUUID(),correlationId:randomUUID()};
  const outcome=await this.transactions.withTransaction(async tx=>{
   const operation=await this.operations.claimInTransaction(tx,request);if(operation.replay){if(operation.status==="FAILED")fail(operation.publicErrorCode);return operation.result;}if(!operation.created)fail("CONCURRENT_OPERATION");
   const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.operation"),[[route]]=await tx.query("SELECT fulfillment_id FROM shipments WHERE id=?",[shipmentId]);if(!route)fail("SHIPMENT_NOT_FOUND");
   const root=await this.#root(tx,String(route.fulfillment_id)),[row]=await lockFulfillmentRowsInTransaction(tx,"shipments",[shipmentId]);
   if(String(row.fulfillment_id)!==String(root.id)||String(root.active_shipment_id)!==shipmentId||row.status!=="DRAFT")fail("SHIPMENT_STATE_CONFLICT");
   if(Number(row.version)!==command.version||Number(row.version)>=4294967295)fail("VERSION_CONFLICT");
   if(!cancel)await this.#address(tx,root,command);
   const at=this.time.nowMs(),changes=cancel?{status:"CANCELLED",cancelled_at:at,cancelled_by:actor.id,cancel_reason:command.reason}:logistics(command),columns=Object.keys(changes);
   const [changed]=await tx.execute(`UPDATE shipments SET ${columns.map(key=>key+"=?").join(",")},version=version+1,updated_at=?,last_business_updated_at=?,updated_by=? WHERE id=? AND status='DRAFT' AND version=?`,[...Object.values(changes),at,at,actor.id,shipmentId,command.version]);if(changed.affectedRows!==1)fail("VERSION_CONFLICT");
   if(cancel)await this.#pointer(tx,root,null,actor);
   const result={id:shipmentId,number:row.shipment_number,status:cancel?"CANCELLED":"DRAFT",version:command.version+1};await this.#record(tx,{id:shipmentId,fulfillment_id:root.id,status:result.status,version:result.version},cancel?"CANCEL":"UPDATE",request,actor,"DRAFT");await this.operations.succeedInTransaction(tx,{request,result});return result;
  });return this.#projection(outcome,request);
 }
 updateDraft(id,input){return this.#change(id,input,false);}
 cancelDraft(id,input){return this.#change(id,input,true);}
 async detail(shipmentId){
  identifier(shipmentId);return this.transactions.withTransaction(async tx=>{
   await requireFulfillmentActor(this.database,tx,"fulfillment.view");
   const [[row]]=await tx.query("SELECT id,shipment_number,fulfillment_id,status,version,shipping_address_id,shipping_address_version,shipping_contact_id,shipping_contact_version,carrier_name,tracking_number,package_count,total_weight,weight_uom,notes,line_count FROM shipments WHERE id=?",[shipmentId]);if(!row)fail("SHIPMENT_NOT_FOUND");
   const [lines]=await tx.query("SELECT id,fulfillment_line_id,line_no,sku_code_snapshot,sku_name_snapshot,base_uom_code_snapshot,shipped_base_quantity FROM shipment_lines WHERE shipment_id=? ORDER BY line_no,id LIMIT 101",[shipmentId]);if(lines.length!==Number(row.line_count)||lines.length>100)fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
   return {id:String(row.id),number:row.shipment_number,fulfillmentId:String(row.fulfillment_id),status:row.status,version:Number(row.version),shippingAddressId:String(row.shipping_address_id),shippingAddressVersion:Number(row.shipping_address_version),shippingContactId:row.shipping_contact_id===null?null:String(row.shipping_contact_id),shippingContactVersion:row.shipping_contact_version===null?null:Number(row.shipping_contact_version),carrierName:row.carrier_name,trackingNumber:row.tracking_number,packageCount:row.package_count===null?null:Number(row.package_count),...normalizeShipmentWeight(row.total_weight,row.weight_uom),notes:row.notes,lines:lines.map(line=>({id:String(line.id),fulfillmentLineId:String(line.fulfillment_line_id),lineNo:Number(line.line_no),skuCode:line.sku_code_snapshot,skuName:line.sku_name_snapshot,baseUomCode:line.base_uom_code_snapshot,shippedBaseQuantity:String(line.shipped_base_quantity)}))};
  });
 }
}
