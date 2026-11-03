import { randomUUID } from "node:crypto";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { CustomerLookupService } from "../customer/CustomerLookupService.js";
import { FulfillmentTransactionService } from "./FulfillmentTransactionService.js";
import { FulfillmentInquiryService } from "./FulfillmentInquiryService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { normalizeShipmentWeight } from "./shipmentWeight.js";
import { SHIPMENT_SORTS,shipmentListQuery,shipmentDetailQuery } from "./shipmentInquiryQuery.js";

const unavailable=()=>{throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");};
const identifier=value=>{const result=String(value);fulfillmentInteger(result);return result;};
const quantity=value=>fulfillmentInteger(String(value),{positive:false}).toString();
const number=value=>value===null?null:Number(value);
const historic=row=>["SHIPPED","REVERSING","REVERSED"].includes(row.status);
const headerColumns="s.*,DATE_FORMAT(s.shipment_date,'%Y-%m-%d') AS shipment_date";
function parents(row,root){
 if(String(row.fulfillment_id)!==String(root.id)||["sales_order_id","customer_id","warehouse_id"].some(key=>String(row[key])!==String(root[key])))unavailable();
 return {fulfillment:{id:identifier(root.id),number:root.fulfillment_number},salesOrder:{id:identifier(row.sales_order_id),number:root.sales_order_number_snapshot},customer:{id:identifier(row.customer_id),code:historic(row)?row.customer_code_snapshot:root.customer_code_snapshot,name:historic(row)?row.customer_name_snapshot:root.customer_name_snapshot},warehouse:{id:identifier(row.warehouse_id),code:root.warehouse_code_snapshot,name:root.warehouse_name_snapshot}};
}
function basic(row,root){return {id:identifier(row.id),number:row.shipment_number,fulfillmentId:identifier(row.fulfillment_id),...parents(row,root),status:row.status,version:Number(row.version),shippingAddressId:identifier(row.shipping_address_id),shippingAddressVersion:Number(row.shipping_address_version),shippingContactId:row.shipping_contact_id===null?null:identifier(row.shipping_contact_id),shippingContactVersion:number(row.shipping_contact_version),carrierName:row.carrier_name,trackingNumber:row.tracking_number,packageCount:number(row.package_count),...normalizeShipmentWeight(row.total_weight,row.weight_uom),notes:row.notes,shipmentDate:row.shipment_date,confirmationEventId:row.confirmation_event_id,createdAt:Number(row.created_at),updatedAt:Number(row.updated_at),shippedAt:number(row.shipped_at),lastBusinessUpdatedAt:Number(row.last_business_updated_at)};}
function addressSnapshot(row){return {name:row.address_name_snapshot,recipientCompany:row.recipient_company_snapshot,recipientName:row.recipient_name_snapshot,line1:row.address_line1_snapshot,line2:row.address_line2_snapshot,line3:row.address_line3_snapshot,city:row.city_snapshot,region:row.region_snapshot,postalCode:row.postal_code_snapshot,countryCode:row.country_code_snapshot};}
function contactSnapshot(row){return {name:row.contact_name_snapshot,phone:row.contact_phone_snapshot,email:row.contact_email_snapshot};}
function lineProjection(line,source,confirmed){
 if(!source||["fulfillment_id","sales_order_line_id","sku_id","base_uom_id"].some(key=>String(line[key])!==String(source[key]))||String(line.fulfillment_line_id)!==String(source.id)||Number(line.line_no)!==Number(source.line_no))unavailable();
 return {id:identifier(line.id),fulfillmentLineId:identifier(source.id),salesOrderLineId:identifier(line.sales_order_line_id),lineNo:Number(line.line_no),skuId:identifier(line.sku_id),skuCode:confirmed?line.sku_code_snapshot:source.sku_code_snapshot,skuName:confirmed?line.sku_name_snapshot:source.sku_name_snapshot,baseUomCode:confirmed?line.base_uom_code_snapshot:source.base_uom_code_snapshot,shippedBaseQuantity:quantity(line.shipped_base_quantity),reversedBaseQuantity:quantity(line.reversed_base_quantity)};
}
function issueProjection(row){return {id:identifier(row.id),shipmentLineId:identifier(row.shipment_line_id),fulfillmentAllocationId:identifier(row.fulfillment_allocation_id),inventoryOperationId:identifier(row.inventory_operation_id),inventoryMovementId:identifier(row.inventory_movement_id),inventoryReservationId:identifier(row.inventory_reservation_id),inventoryAllocationId:identifier(row.inventory_allocation_id),inventoryBalanceId:identifier(row.inventory_balance_id),warehouseId:identifier(row.warehouse_id),warehouseCode:row.warehouse_code_snapshot,binId:identifier(row.bin_id),binCode:row.bin_code_snapshot,lotId:row.lot_id===null?null:identifier(row.lot_id),lotNumber:row.lot_number_snapshot,expiryDate:row.expiry_date_snapshot,stockStatus:row.stock_status_snapshot,skuCode:row.sku_code_snapshot,baseUomCode:row.base_uom_code_snapshot,issuedBaseQuantity:quantity(row.issued_base_quantity),reversalMovementId:row.reversal_movement_id===null?null:identifier(row.reversal_movement_id)};}
const issueColumns="*,DATE_FORMAT(expiry_date_snapshot,'%Y-%m-%d') AS expiry_date_snapshot";

export class ShipmentInquiryService {
 constructor({database,time,logger}){Object.assign(this,{database,time,logger});this.transactions=new FulfillmentTransactionService({database});}
 async #actor(tx){
  if(this.database.context?.get()?.databaseTransaction!==tx||!["READ COMMITTED","REPEATABLE READ"].includes(getActiveTransactionIsolation(tx)))throw new TypeError("Current Shipment read transaction required");
  const claims=this.database.context.get()?.auth?.claims;
  if(typeof claims?.sub!=="string"||!/^[1-9][0-9]*$/u.test(claims.sub)||!Number.isSafeInteger(Number(claims.sub)))throw fulfillmentError("FULFILLMENT_PERMISSION_DENIED");
  const actor=await assertActorFresh(tx,{actorId:Number(claims.sub),claimedRoles:claims.roles,claimedPermissions:claims.permissions});
  if(!actor.permissions.includes("fulfillment.view"))throw fulfillmentError("FULFILLMENT_PERMISSION_DENIED");return actor;
 }
 #read(work){if(this.database.context?.get()?.databaseTransaction)throw new TypeError("Shipment inquiry requires a fresh read transaction");return this.database.withTransaction(work,{isolationLevel:"REPEATABLE READ"});}
 list(input={}){
  const query=shipmentListQuery(input);
  return this.#read(async tx=>{
   await this.#actor(tx);const where=[],values=[];
   for(const [key,column]of [["salesOrderId","sales_order_id"],["customerId","customer_id"],["warehouseId","warehouse_id"],["carrier","carrier_name"],["trackingNumber","tracking_number"]])if(query[key]!==undefined){where.push(`s.${column}=?`);values.push(query[key]);}
   if(query.status){where.push(`s.status IN (${query.status.map(()=>"?").join(",")})`);values.push(...query.status);}
   if(query.q){const [[order]]=await tx.query("SELECT id FROM sales_orders WHERE sales_order_number=?",[query.q]);where.push(order?"(s.shipment_number=? OR s.sales_order_id=?)":"s.shipment_number=?");values.push(query.q);if(order)values.push(order.id);}
   for(const [key,operator]of [["shipmentDateFrom",">="],["shipmentDateTo","<="]])if(query[key]){where.push(`s.shipment_date${operator}?`);values.push(query[key]);}
   const filter=where.length?" WHERE "+where.join(" AND "):"",[[count]]=await tx.query("SELECT COUNT(*) AS total FROM shipments s"+filter,values),direction=query.descending?"DESC":"ASC",column=SHIPMENT_SORTS[query.sortBy];
   const [rows]=await tx.query(`SELECT ${headerColumns},f.fulfillment_number,f.sales_order_id AS source_sales_order_id,f.customer_id AS source_customer_id,f.warehouse_id AS source_warehouse_id,f.sales_order_number_snapshot,f.customer_code_snapshot AS source_customer_code,f.customer_name_snapshot AS source_customer_name,f.warehouse_code_snapshot,f.warehouse_name_snapshot FROM shipments s JOIN fulfillments f ON f.id=s.fulfillment_id${filter} ORDER BY s.${column} ${direction}${column==="id"?"":`,s.id ${direction}`} LIMIT ? OFFSET ?`,[...values,query.pageSize,(query.page-1)*query.pageSize]);
   const total=Number(count.total);if(!Number.isSafeInteger(total)||total<0)unavailable();
   return {items:rows.map(row=>{const root={...row,id:row.fulfillment_id,sales_order_id:row.source_sales_order_id,customer_id:row.source_customer_id,warehouse_id:row.source_warehouse_id,customer_code_snapshot:row.source_customer_code,customer_name_snapshot:row.source_customer_name};return {...basic(row,root),lineCount:Number(row.line_count)};}),total,page:query.page,pageSize:query.pageSize,hasMore:query.page*query.pageSize<total};
  });
 }
 async #family(tx,id,{locked=false}={}){
  const [[row]]=await tx.query(`SELECT ${headerColumns} FROM shipments s WHERE s.id=?${locked?" FOR SHARE":""}`,[id]);if(!row)throw fulfillmentError("SHIPMENT_NOT_FOUND");
  const [[root]]=await tx.query("SELECT * FROM fulfillments WHERE id=?",[row.fulfillment_id]);if(!root)unavailable();parents(row,root);
  const [lines]=await tx.query("SELECT * FROM shipment_lines WHERE shipment_id=? ORDER BY line_no,id LIMIT 101",[id]),[sources]=await tx.query("SELECT * FROM fulfillment_lines WHERE fulfillment_id=? ORDER BY line_no,id LIMIT 101",[row.fulfillment_id]);
  if(!lines.length||lines.length!==Number(row.line_count)||sources.length!==lines.length||sources.length!==Number(root.line_count)||lines.length>100)unavailable();
  const projected=lines.map(line=>lineProjection(line,sources.find(source=>String(source.id)===String(line.fulfillment_line_id)),historic(row)));
  if(new Set(projected.map(line=>line.fulfillmentLineId)).size!==lines.length)unavailable();
  return {row,root,lines:projected};
 }
 async #selection(tx,row){
  if(historic(row))return {address:addressSnapshot(row),contact:contactSnapshot(row)};
  const customer=new CustomerLookupService({database:tx}),options={purpose:"shipping",atMs:this.time.nowMs()};let address=null,contact=null;
  try{address=await customer.assertAddressUsable(Number(row.customer_id),Number(row.shipping_address_id),options);}catch(error){if(error.code!=="CUSTOMER_PARTY_NOT_FOUND")throw error;}
  if(row.shipping_contact_id!==null)try{contact=await customer.assertContactUsable(Number(row.customer_id),Number(row.shipping_contact_id),options);}catch(error){if(error.code!=="CUSTOMER_PARTY_NOT_FOUND")throw error;}
  return {address:address?{name:address.label,recipientCompany:address.recipientCompanyDepartment,recipientName:contact?.name??"",line1:address.addressLine1,line2:address.addressLine2,line3:address.addressLine3,city:address.city,region:address.stateRegion,postalCode:address.postalCode,countryCode:address.countryCode}:null,contact:contact?{name:contact.name,phone:contact.phone,email:contact.email}:null};
 }
 detail(id,input={}){
  identifier(id);const options=shipmentDetailQuery(input);
  return this.#read(tx=>this.#detail(tx,id,options));
 }
 async #detail(tx,id,options){
   const actor=await this.#actor(tx),{row,root,lines}=await this.#family(tx,id),[issues]=await tx.query(`SELECT ${issueColumns} FROM shipment_issue_details WHERE shipment_id=? AND id>? ORDER BY id LIMIT 101`,[id,options.issueAfterId]),[history]=await tx.query("SELECT * FROM shipment_status_history WHERE shipment_id=? AND sequence_no<? ORDER BY sequence_no DESC LIMIT 101",[id,options.historyBeforeSequence]);
   const [[pending]]=await tx.query("SELECT EXISTS(SELECT 1 FROM fulfillment_operation_requests WHERE target_type='SHIPMENT' AND target_id=? AND status='IN_PROGRESS') AS active",[id]),[[reversal]]=await tx.query("SELECT id,reversal_number,status FROM shipment_reversals WHERE shipment_id=? ORDER BY id DESC LIMIT 1",[id]);
   const allowedActions=[];if(row.status==="DRAFT"&&root.status==="PICKED"&&String(root.active_shipment_id)===id&&!pending.active&&actor.permissions.includes("fulfillment.operation"))allowedActions.push("update","cancel");if(["SHIPPED","REVERSED"].includes(row.status))allowedActions.push("printDeliveryNote","printPackingList");
   return {...basic(row,root),...await this.#selection(tx,row),lines,issues:{items:issues.slice(0,100).map(issueProjection),hasMore:issues.length>100,nextCursor:issues.length>100?identifier(issues[99].id):null},history:{items:history.slice(0,100).map(item=>({sequence:Number(item.sequence_no),fromStatus:item.from_status,toStatus:item.to_status,action:item.action,reason:item.reason,eventId:item.event_id,versionAfter:Number(item.version_after),actorLabel:item.actor_label,occurredAt:Number(item.occurred_at)})),hasMore:history.length>100,nextCursor:history.length>100?Number(history[99].sequence_no):null},reversal:reversal?{id:identifier(reversal.id),number:reversal.reversal_number,status:reversal.status}:null,allowedActions};
 }
 confirmationResult(terminal){
  const id=identifier(terminal?.result?.id);
  return this.#read(async tx=>{
   const actor=await this.#actor(tx);if(!actor.permissions.includes("fulfillment.operation"))throw fulfillmentError("FULFILLMENT_PERMISSION_DENIED");
   const shipment=await this.#detail(tx,id,shipmentDetailQuery({}));
   if(terminal.outcome!=="SHIPPED"||terminal.result.status!=="SHIPPED"||!historic(shipment)||shipment.confirmationEventId!==terminal.eventId||shipment.version<terminal.result.version)unavailable();
   const {salesOrder}=await new FulfillmentInquiryService({database:this.database}).detailInTransaction(tx,shipment.fulfillmentId);
   if(salesOrder.id!==shipment.salesOrder.id)unavailable();
   const [issues]=await tx.query("SELECT shipment_line_id,inventory_movement_id,issued_base_quantity FROM shipment_issue_details WHERE shipment_id=? ORDER BY id LIMIT 5001",[id]);
   if(!issues.length||issues.length>5000)unavailable();
   const totals=new Map(shipment.lines.map(line=>[line.id,0n])),inventoryMovementIds=[];
   for(const issue of issues){const line=identifier(issue.shipment_line_id);if(!totals.has(line))unavailable();totals.set(line,totals.get(line)+fulfillmentInteger(String(issue.issued_base_quantity)));inventoryMovementIds.push(identifier(issue.inventory_movement_id));}
   if(new Set(inventoryMovementIds).size!==issues.length||shipment.lines.some(line=>totals.get(line.id)!==BigInt(line.shippedBaseQuantity)))unavailable();
   return {outcome:"SHIPPED",shipment,inventoryMovementIds,salesOrder};
  });
 }
 deliveryNote(id){
  identifier(id);const correlationId=randomUUID();
  return this.transactions.withTransaction(async tx=>{
   const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.view"),[[route]]=await tx.query("SELECT fulfillment_id,sales_order_id FROM shipments WHERE id=?",[id]);if(!route)throw fulfillmentError("SHIPMENT_NOT_FOUND");
   const [[order]]=await tx.query("SELECT id FROM sales_orders WHERE id=? FOR SHARE",[route.sales_order_id]),[[root]]=await tx.query("SELECT id,sales_order_id FROM fulfillments WHERE id=? FOR SHARE",[route.fulfillment_id]);if(!order||!root||String(root.sales_order_id)!==String(order.id))unavailable();
   const family=await this.#family(tx,id,{locked:true}),{row,lines}=family;if(String(row.fulfillment_id)!==String(root.id)||!["SHIPPED","REVERSED"].includes(row.status))throw fulfillmentError("SHIPMENT_STATE_CONFLICT");
   if(!row.confirmation_event_id||row.shipment_date===null||row.shipped_at===null||family.root.status!==row.status||!/^SHP-[0-9]{6}-[0-9]{6,13}$/u.test(row.shipment_number))unavailable();
   const [issues]=await tx.query(`SELECT ${issueColumns} FROM shipment_issue_details WHERE shipment_id=? ORDER BY shipment_line_id,id LIMIT 5001`,[id]);if(!issues.length||issues.length>5000)unavailable();
   const totals=new Map(lines.map(line=>[line.id,0n])),ids=new Set(),movements=new Set();
   const rows=issues.map(issue=>{const line=lines.find(item=>item.id===String(issue.shipment_line_id)),amount=fulfillmentInteger(String(issue.issued_base_quantity));if(!line||String(issue.shipment_id)!==id||String(issue.warehouse_id)!==String(row.warehouse_id)||issue.stock_status_snapshot!=="AVAILABLE"||issue.sku_code_snapshot!==line.skuCode||issue.base_uom_code_snapshot!==line.baseUomCode||ids.has(String(issue.id))||movements.has(String(issue.inventory_movement_id))||(row.status==="REVERSED")!==(issue.reversal_movement_id!==null))unavailable();ids.add(String(issue.id));movements.add(String(issue.inventory_movement_id));totals.set(line.id,totals.get(line.id)+amount);return {sequence:0,...issueProjection(issue),lineNo:line.lineNo,skuName:line.skuName};});
   for(const line of lines)if(totals.get(line.id)!==BigInt(line.shippedBaseQuantity)||BigInt(line.reversedBaseQuantity)!==(row.status==="REVERSED"?BigInt(line.shippedBaseQuantity):0n))unavailable();
   if(!lines.some(line=>BigInt(line.shippedBaseQuantity)>0n))unavailable();rows.sort((a,b)=>a.lineNo-b.lineNo||(BigInt(a.id)<BigInt(b.id)?-1:1));rows.forEach((item,index)=>{item.sequence=index+1;});
   const at=this.time.nowMs(),projection={...basic(row,family.root),address:addressSnapshot(row),contact:contactSnapshot(row),lines,rows,isEffective:row.status==="SHIPPED",historicalWarning:row.status==="REVERSED"?"已沖銷，只供歷史參考":"",filename:row.shipment_number+".pdf",generatedAt:at};
   await tx.execute("INSERT INTO fulfillment_audit_logs (target_type,target_id,action,event_id,correlation_id,actor_user_id,actor_label,after_summary,occurred_at) VALUES ('SHIPMENT',?,'PRINT',NULL,?,?,?,?,?)",[id,correlationId,actor.id,actor.username,JSON.stringify({version:Number(row.version),status:row.status,lineCount:lines.length,rowCount:rows.length}),at]);
   await requireFulfillmentActor(this.database,tx,"fulfillment.view");return projection;
  });
 }
}
