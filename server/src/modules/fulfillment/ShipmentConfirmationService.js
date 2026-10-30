import { randomUUID } from "node:crypto";
import { FulfillmentTransactionService,assertFulfillmentTransaction } from "./FulfillmentTransactionService.js";
import { FulfillmentOperationService } from "./FulfillmentOperationService.js";
import { lockFulfillmentRowsInTransaction } from "./FulfillmentLockService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentOperationHash } from "./fulfillmentOperationHash.js";
import { normalizeShipmentDraft } from "./shipmentDraftCommand.js";
import { assertShipmentConfirmationHistory } from "./shipmentConfirmationWitness.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { InventoryLookupService } from "../inventory/InventoryLookupService.js";
import { SalesFulfillmentService } from "../sales/SalesFulfillmentService.js";
import { CustomerLookupService } from "../customer/CustomerLookupService.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { freezeShipmentIntent,readShipmentConfirmationSnapshot,assertShipmentConfirmationSnapshot,shipmentConfirmationSnapshotIdentity,shipmentIssuePayload,shipmentSalesIntent } from "./shipmentConfirmationScope.js";
import { shipmentIssueProjection,assertShipmentSalesProjection,saveShipmentIssueProjection } from "./shipmentConfirmationProjection.js";

const fail=code=>{throw fulfillmentError(code);};
const sourceColumns="id,shipment_number,fulfillment_id,sales_order_id,customer_id,warehouse_id,status,version,line_count,shipping_address_id,shipping_address_version,shipping_contact_id,shipping_contact_version,carrier_name,tracking_number,package_count,total_weight,weight_uom,notes,confirmation_event_id";
function command(input){
 if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.getOwnPropertySymbols(input).length||Object.keys(input).sort().join(",")!=="eventId,version"||typeof input.eventId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(input.eventId)||!Number.isSafeInteger(input.version)||input.version<1||input.version>4294967295)fail("FULFILLMENT_INPUT_INVALID");
 return Object.freeze({...input});
}
function payload(row,input){
 try{
  const refs=Object.fromEntries([['shipmentId','id'],['fulfillmentId','fulfillment_id'],['salesOrderId','sales_order_id'],['customerId','customer_id'],['warehouseId','warehouse_id']].map(([key,column])=>{const value=String(row[column]);fulfillmentInteger(value);return [key,value];}));
  const draft=normalizeShipmentDraft({eventId:input.eventId,version:input.version,shippingAddressId:Number(row.shipping_address_id),shippingAddressVersion:Number(row.shipping_address_version),shippingContactId:row.shipping_contact_id===null?null:Number(row.shipping_contact_id),shippingContactVersion:row.shipping_contact_version===null?null:Number(row.shipping_contact_version),carrierName:row.carrier_name,trackingNumber:row.tracking_number,packageCount:row.package_count===null?null:Number(row.package_count),totalWeight:row.total_weight,weightUom:row.weight_uom,notes:row.notes},{update:true});
  return Object.freeze({...refs,...draft});
 }catch{fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");}
}
const digest=request=>fulfillmentOperationHash({operationType:"SHIP",target:request.target,payload:request.payload});
const pending=operation=>({outcome:"SHIPPING",operationId:operation.operationId,eventId:operation.eventId,correlationId:operation.correlationId,statusUrl:"/api/v1/fulfillment-operations/by-event/"+operation.eventId,retryAfterSeconds:2});
function terminal(operation){if(operation.status==="FAILED")throw fulfillmentError(operation.publicErrorCode,operation.publicErrorDetails);return {outcome:"SHIPPED",operationId:operation.operationId,eventId:operation.eventId,correlationId:operation.correlationId,result:operation.result};}
export class ShipmentConfirmationService {
 #pendingRequests=new WeakMap();
 constructor({database,time,logger}){Object.assign(this,{database,time,logger});this.transactions=new FulfillmentTransactionService({database});this.operations=new FulfillmentOperationService({database,time});this.inventoryLookup=new InventoryLookupService({database,time,logger});this.inventory=this.inventoryLookup.fulfillment;this.sales=new SalesFulfillmentService({database,time,logger,inventoryFulfillment:this.inventory});this.items=new ItemLookupService({database,time,logger});}
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
   const output=Object.freeze(pending(operation));this.#pendingRequests.set(output,request);return output;
  });
 }
 async completeConfirmation(started,{signal}={}){
  const request=this.#pendingRequests.get(started);if(!request)fail("FULFILLMENT_SOURCE_CONFLICT");
  if(signal!==undefined&&!(signal instanceof AbortSignal)||this.database.context?.get()?.databaseTransaction)throw new TypeError("New Shipment caller transaction required");
  return this.database.withTransaction(async tx=>{
   assertFulfillmentTransaction(this.database,tx);
   const input={eventId:request.eventId,shipmentId:request.target.id,version:request.payload.version},replay=await this.operations.getShipmentConfirmationReplayInTransaction(tx,input);if(replay)return terminal(replay);
   const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.operation"),[[operation]]=await tx.query("SELECT * FROM fulfillment_operation_requests WHERE event_id=?",[request.eventId]),[[clock]]=await tx.query("SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms");
   if(!operation||operation.status!=="IN_PROGRESS"||operation.operation_type!=="SHIP"||operation.target_type!=="SHIPMENT"||String(operation.target_id)!==request.target.id||String(operation.initiated_by)!==String(actor.id)||operation.payload_hash!==digest(request)||operation.correlation_id!==request.correlationId||operation.lease_owner!==request.leaseOwner||Number(operation.lease_expires_at)<=Number(clock.now_ms))fail("CONCURRENT_OPERATION");
   const before=assertShipmentConfirmationSnapshot(await readShipmentConfirmationSnapshot(tx,request.target.id),request.eventId),identity=shipmentConfirmationSnapshotIdentity(before);
   if(Number(before.shipment.version)!==input.version+1||digest({...request,payload:payload(before.shipment,input)})!==digest(request))fail("FULFILLMENT_SOURCE_CONFLICT");
   const owner=await this.inventoryLookup.readFulfillmentAllocationScopeInTransaction(tx,{fulfillmentId:String(before.root.id),inventoryAllocationIds:before.allocations.map(row=>String(row.inventory_allocation_id))});
   const inventoryCommand=freezeShipmentIntent({actor:{userId:actor.id,serviceName:"",claimedRoles:[...actor.roles],claimedPermissions:[...actor.permissions]},source:{documentId:request.target.id,eventId:request.eventId},correlationId:request.correlationId,payload:shipmentIssuePayload(before,owner)});
   const preparation=await this.inventory.claimFulfillmentBatchInTransaction(tx,{action:"ISSUE",command:inventoryCommand});
   const order=await this.sales.getOrderForFulfillment(String(before.root.sales_order_id),{atMs:this.time.nowMs()}),intent=shipmentSalesIntent(before,order,inventoryCommand,preparation),salesProof=await this.sales.lockLinesForFulfillmentInTransaction(tx,intent);if(salesProof.replay!==false||!salesProof.order)fail("FULFILLMENT_SOURCE_CONFLICT");
   const snapshot=assertShipmentConfirmationSnapshot(await readShipmentConfirmationSnapshot(tx,request.target.id,{locked:true,order:salesProof.order}),request.eventId);if(shipmentConfirmationSnapshotIdentity(snapshot)!==identity)fail("VERSION_CONFLICT");
   const activeByReservation=new Map();for(const claim of snapshot.allClaims){const id=String(claim.inventory_reservation_id);activeByReservation.set(id,(activeByReservation.get(id)??0n)+fulfillmentInteger(String(claim.active_claimed_quantity),{positive:false}));}
   for(const member of owner.reservationFacts)if((activeByReservation.get(member.inventoryReservationId)??0n)>BigInt(member.outstandingQuantity))fail("RESERVATION_CLAIM_CONFLICT");
   const customers=new CustomerLookupService({database:tx}),at=this.time.nowMs();let address,contact=null,customer;
   try{
    address=await customers.assertAddressUsableInTransaction(tx,Number(snapshot.root.customer_id),Number(snapshot.shipment.shipping_address_id),{purpose:"shipping",expectedVersion:Number(snapshot.shipment.shipping_address_version),atMs:at});
    if(snapshot.shipment.shipping_contact_id!==null)contact=await customers.assertContactUsableInTransaction(tx,Number(snapshot.root.customer_id),Number(snapshot.shipment.shipping_contact_id),{purpose:"shipping",expectedVersion:Number(snapshot.shipment.shipping_contact_version),atMs:at});
    customer=await customers.findById(Number(snapshot.root.customer_id),{purpose:"existing_order_fulfillment",atMs:at});
   }catch(error){if(error.code==="VERSION_CONFLICT")fail("SHIPPING_ADDRESS_CHANGED");if(error.code==="CUSTOMER_PARTY_NOT_FOUND")fail("SHIPPING_ADDRESS_UNAVAILABLE");fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");}
   if(!customer||String(customer.customerId)!==String(snapshot.root.customer_id)||address.customerId!==customer.customerId||contact&&contact.customerId!==customer.customerId)fail("FULFILLMENT_SOURCE_CONFLICT");
   const profiles=await this.items.getFulfillmentInventoryProfilesInTransaction(tx,[...new Set(snapshot.lines.map(row=>String(row.sku_id)))],{atMs:at});
   for(const line of snapshot.lines){const profile=profiles.find(row=>row.skuId===String(line.sku_id));if(!profile||!profile.usable||!profile.inventoryTracked||profile.baseUom.uomId!==String(line.base_uom_id))fail("FULFILLMENT_SOURCE_CONFLICT");if(profile.trackingPolicy==="serial")fail("SERIAL_TRACKING_UNSUPPORTED");}
   const result=await this.inventory.postFulfillmentIssueBatchInTransaction(tx,inventoryCommand,preparation);let projection;
   try{projection=shipmentIssueProjection(result,inventoryCommand.payload,preparation,snapshot,profiles,at);}catch{await this.logger.error("fulfillment.shipment.inventory_contract_mismatch","Critical Shipment Inventory contract mismatch",{code:"INVENTORY_CONTRACT_MISMATCH",correlationId:request.correlationId});fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");}
   const salesResult=await this.sales.applyFulfillmentResultInTransaction(tx,{intent,inventoryResult:result});
   try{assertShipmentSalesProjection(salesResult,intent,salesProof.order);}catch{await this.logger.error("fulfillment.shipment.sales_contract_mismatch","Critical Shipment Sales contract mismatch",{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH",correlationId:request.correlationId});fail("FULFILLMENT_DEPENDENCY_UNAVAILABLE");}
   await saveShipmentIssueProjection(tx,snapshot,projection,profiles,at);
   const shipmentVersion=Number(snapshot.shipment.version)+1,fulfillmentVersion=Number(snapshot.root.version)+1;
   if(shipmentVersion>4294967295||fulfillmentVersion>4294967295)fail("VERSION_CONFLICT");
   const fields={customer_code_snapshot:customer.customerCode,customer_name_snapshot:customer.legalName,address_name_snapshot:address.label??"",recipient_company_snapshot:address.recipientCompanyDepartment??"",recipient_name_snapshot:contact?.name??"",address_line1_snapshot:address.addressLine1??"",address_line2_snapshot:address.addressLine2??"",address_line3_snapshot:address.addressLine3??"",city_snapshot:address.city??"",region_snapshot:address.stateRegion??"",postal_code_snapshot:address.postalCode??"",country_code_snapshot:address.countryCode??"",contact_name_snapshot:contact?.name??"",contact_phone_snapshot:contact?.phone??"",contact_email_snapshot:contact?.email??""};
   const [shipmentChanged]=await tx.execute(`UPDATE shipments SET ${Object.keys(fields).map(column=>column+"=?").join(",")},status='SHIPPED',shipment_date=?,shipped_at=?,shipped_by=?,version=version+1,updated_at=?,last_business_updated_at=?,updated_by=? WHERE id=? AND status='SHIPPING' AND version=? AND confirmation_event_id=?`,[...Object.values(fields),this.time.fileDate(),at,actor.id,at,at,actor.id,snapshot.shipment.id,snapshot.shipment.version,request.eventId]);if(shipmentChanged.affectedRows!==1)fail("VERSION_CONFLICT");
   const [rootChanged]=await tx.execute("UPDATE fulfillments SET status='SHIPPED',shipped_at=?,shipped_by=?,version=version+1,updated_at=?,last_business_updated_at=?,updated_by=? WHERE id=? AND status='PICKED' AND version=? AND active_shipment_id=?",[at,actor.id,at,at,actor.id,snapshot.root.id,snapshot.root.version,snapshot.shipment.id]);if(rootChanged.affectedRows!==1)fail("VERSION_CONFLICT");
   for(const [table,parent,id,from,to,action,version]of [["fulfillment_status_history","fulfillment_id",snapshot.root.id,"PICKED","SHIPPED","SHIP",fulfillmentVersion],["shipment_status_history","shipment_id",snapshot.shipment.id,"SHIPPING","SHIPPED","CONFIRM",shipmentVersion]]){
    const [[sequence]]=await tx.query(`SELECT COALESCE(MAX(sequence_no),0)+1 AS next FROM ${table} WHERE ${parent}=?`,[id]);if(Number(sequence.next)>4294967295)fail("VERSION_CONFLICT");
    await tx.execute(`INSERT INTO ${table} (${parent},sequence_no,from_status,to_status,action,event_id,version_after,actor_user_id,actor_label,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,[id,sequence.next,from,to,action,request.eventId,version,actor.id,actor.username,at]);
   }
   for(const [type,id,version]of [["FULFILLMENT",snapshot.root.id,fulfillmentVersion],["SHIPMENT",snapshot.shipment.id,shipmentVersion]])await tx.execute("INSERT INTO fulfillment_audit_logs (target_type,target_id,action,event_id,correlation_id,actor_user_id,actor_label,after_summary,occurred_at) VALUES (?,?,'SHIP',?,?,?,?,?,?)",[type,id,request.eventId,request.correlationId,actor.id,actor.username,JSON.stringify({shipmentId:request.target.id,fulfillmentId:String(snapshot.root.id),status:"SHIPPED",version,rowCount:projection.issues.length}),at]);
   const output={id:request.target.id,number:snapshot.shipment.shipment_number,status:"SHIPPED",version:shipmentVersion};await this.operations.succeedInTransaction(tx,{request,result:output});
   return {outcome:"SHIPPED",operationId:String(operation.id),eventId:request.eventId,correlationId:request.correlationId,result:output};
  },{isolationLevel:"READ COMMITTED",signal});
 }
}
