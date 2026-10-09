import { createHash,randomUUID } from "node:crypto";
import { InventoryReservationService } from "../inventory/InventoryReservationService.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { SalesAuditService } from "./SalesAuditService.js";
import { validateConfirmationInventoryResult } from "./SalesOrderConfirmationService.js";
import { readSalesOrderDetail } from "./SalesOrderService.js";
import { requireSalesWriteActor } from "./salesAuthorization.js";
import { assertQuantityConservation } from "./salesQuantityMath.js";
import { salesError } from "./salesErrors.js";
import defaults from "../../../config/sales.js";

const name="sales.backorderAllocate",actor={id:null,username:name};
export function validateSalesBackorderScope(input,{optional=false}={}){
 if(input===undefined&&optional)return null;
 if(!input||Array.isArray(input)||!["orderId","skuId,warehouseId"].includes(Object.keys(input).sort().join(","))||Object.values(input).some(value=>!Number.isSafeInteger(value)||value<1))throw salesError("SALES_INPUT_INVALID");
 return {...input};
}
function scopeFilter(scope){
 if(!scope)return {sql:"",params:[]};
 if(scope.orderId)return {sql:" AND (q.warehouse_id,q.sku_id) IN (SELECT o.fulfillment_warehouse_id,l.sku_id FROM sales_orders o JOIN sales_order_lines l ON l.sales_order_id=o.id WHERE o.id=?)",params:[scope.orderId]};
 return {sql:" AND q.warehouse_id=? AND q.sku_id=?",params:[scope.warehouseId,scope.skuId]};
}
export class SalesBackorderService{
 constructor(options={}){
  this.database=options.database;this.config=options.config??defaults;this.authorize=options.authorizeSalesBackorder;
  this.items=options.itemProvider??new ItemLookupService(options);this.inventory=options.inventory??new InventoryReservationService(options);this.audit=options.audit??new SalesAuditService();
 }
 async wake({claims,input,signal}){
  const scope=validateSalesBackorderScope(input);
  return this.database.withTransaction(async tx=>{
   await requireSalesWriteActor(tx,claims);
   let scopes=[scope];
   if(scope.orderId){const order=await readSalesOrderDetail(tx,scope.orderId);scopes=[...new Set(order.lines.map(line=>line.skuId))].map(skuId=>({warehouseId:order.fulfillmentWarehouseId,skuId}));}
   for(const value of scopes)await tx.execute("UPDATE sales_backorder_entries SET next_attempt_at=LEAST(next_attempt_at,CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)) WHERE status='OPEN' AND warehouse_id=? AND sku_id=?",[value.warehouseId,value.skuId]);
   return {accepted:true};
  },{signal,timeoutMs:this.config.transactionTimeoutMs});
 }
 async #lease(tx){
  const principal=await this.authorize?.();
  if(typeof principal?.leaseOwner!=="string"||!principal.leaseOwner||principal.signal?.aborted!==false)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
  const [[lease]]=await tx.query("SELECT owner,expires_at FROM fr_job_leases WHERE job_name=? FOR UPDATE",[name]);
  const [[clock]]=await tx.query("SELECT UNIX_TIMESTAMP() AS now,CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms");
  const fresh=await this.authorize?.();
  if(!lease||lease.owner!==principal.leaseOwner||![Number(lease.expires_at),Number(clock.now),Number(clock.now_ms)].every(value=>Number.isSafeInteger(value)&&value>=0)||Number(lease.expires_at)<=Number(clock.now)||fresh?.leaseOwner!==principal.leaseOwner||fresh.signal?.aborted!==false)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
  return {nowMs:Number(clock.now_ms),leaseOwner:principal.leaseOwner};
 }
 async runBatch({scope,maxEntries=this.config.backorderBatchSize,signal}={}){
  scope=validateSalesBackorderScope(scope,{optional:true});
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>this.config.backorderBatchSize)throw salesError("SALES_INPUT_INVALID");
  const principal=await this.authorize?.();if(!principal?.leaseOwner||principal.signal?.aborted!==false||signal&&signal!==principal.signal)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");signal=principal.signal;
  // ponytail: one global lease serializes FIFO allocators; reconsider per-scope leases only if measured throughput requires an approved contract change.
  const excluded=[],filter=scopeFilter(scope),stats={scanned:0,allocatedEntries:0,allocatedBaseQuantity:"0",noStock:0,stale:0,deferred:0,reconciled:0};
  for(let index=0;index<maxEntries;index++){
   signal?.throwIfAborted();
   const exclusion=excluded.length?` AND NOT (${excluded.map(()=>"(q.warehouse_id=? AND q.sku_id=?)").join(" OR ")})`:"";
   const [[candidate]]=await this.database.query(`SELECT q.id,q.sales_order_id,q.warehouse_id,q.sku_id FROM sales_backorder_entries q WHERE q.status='OPEN'
    AND q.next_attempt_at<=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)
    AND NOT EXISTS (SELECT 1 FROM sales_backorder_entries older WHERE older.status='OPEN' AND older.warehouse_id=q.warehouse_id AND older.sku_id=q.sku_id
      AND (older.priority_at,older.sales_order_id,older.line_no,older.id)<(q.priority_at,q.sales_order_id,q.line_no,q.id))${filter.sql}${exclusion}
    ORDER BY q.priority_at,q.sales_order_id,q.line_no,q.id LIMIT 1`,[...filter.params,...excluded.flat()]);
   if(!candidate)break;
   stats.scanned++;let result;
   try{result=await this.#allocate(candidate,signal);}catch{signal?.throwIfAborted();stats.deferred++;break;}
   if(result.retry)continue;
   if(result.deferred){stats.deferred++;break;}
   if(result.reconciled)stats.reconciled++;
   if(result.stale)stats.stale++;
   else if(result.quantity){stats.allocatedEntries++;stats.allocatedBaseQuantity=(BigInt(stats.allocatedBaseQuantity)+BigInt(result.quantity)).toString();}
   if(result.noStock){stats.noStock++;excluded.push([Number(candidate.warehouse_id),Number(candidate.sku_id)]);}
  }
  signal?.throwIfAborted();
  const [[metrics]]=await this.database.query("SELECT COUNT(*) AS open_count,COALESCE(GREATEST(CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS DECIMAL(20,0))-CAST(MIN(priority_at) AS DECIMAL(20,0)),0),0) AS oldest_age_ms FROM sales_backorder_entries WHERE status='OPEN'");
  return {...stats,openCount:Number(metrics.open_count),oldestAgeMs:Number(metrics.oldest_age_ms)};
 }
 async #allocate(candidate,signal){
  const eventId=randomUUID();let completed;
  try{return await this.database.withTransaction(async tx=>{
   const {nowMs,leaseOwner}=await this.#lease(tx),orderId=Number(candidate.sales_order_id);
   const [[header]]=await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[orderId]);if(!header)return {retry:true};
   await tx.query("SELECT id FROM sales_order_lines WHERE sales_order_id=? ORDER BY id FOR UPDATE",[orderId]);
   const [[queue]]=await tx.query("SELECT * FROM sales_backorder_entries WHERE id=? AND sales_order_id=? FOR UPDATE",[Number(candidate.id),orderId]);if(!queue||queue.status!=="OPEN")return {retry:true};
   // The first consistent InnoDB read follows the owned row locks: verify the current committed head without locking another Sales owner's queue.
   const [[head]]=await tx.query("SELECT id FROM sales_backorder_entries WHERE status='OPEN' AND warehouse_id=? AND sku_id=? ORDER BY priority_at,sales_order_id,line_no,id LIMIT 1",[Number(queue.warehouse_id),Number(queue.sku_id)]);
   if(Number(head?.id)!==Number(queue.id)||Number(queue.next_attempt_at)>nowMs)return {retry:true};
   const order=await readSalesOrderDetail(tx,orderId,{lock:true}),line=order.lines.find(value=>value.id===Number(queue.sales_order_line_id));
   const [mappings]=await tx.query("SELECT r.* FROM sales_order_line_reservations r JOIN sales_order_lines l ON l.id=r.sales_order_line_id WHERE l.sales_order_id=? ORDER BY r.id FOR UPDATE",[orderId]);
   if(!line)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
   let result,action,version=order.version,payload;
   if(BigInt(line.backorderedBaseQuantity)===0n){
    await tx.execute("UPDATE sales_backorder_entries SET status='CANCELLED',outstanding_base_quantity=0,version=version+1,updated_at=? WHERE id=?",[nowMs,Number(queue.id)]);result={stale:true,quantity:0};action="backorder_stale";
   }else{
    if(!["CONFIRMED","PARTIALLY_FULFILLED"].includes(order.status)||Number(queue.outstanding_base_quantity)!==Number(line.backorderedBaseQuantity)||mappings.filter(m=>Number(m.sales_order_line_id)===line.id).reduce((sum,m)=>sum+BigInt(m.outstanding_base_quantity),0n)!==BigInt(line.reservedBaseQuantity))throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
    const profiles=await this.items.getSalesInventoryProfilesInTransaction(tx,[line.skuId],{atMs:nowMs}),life=profiles instanceof Map?profiles.get(line.skuId)?.minimumSaleLifeDays:undefined;
    if(life!==null&&(!Number.isSafeInteger(life)||life<0||life>36500))throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
    payload={warehouseId:order.fulfillmentWarehouseId,expectedOrderVersion:order.version,lines:[{sourceLineId:line.id,skuId:line.skuId,orderedBaseQuantity:Number(line.backorderedBaseQuantity),minimumRemainingDays:Math.max(line.minimumSaleLifeDays,life??0)}]};
    const reservation=await this.inventory.reserveAvailableForSalesBackorderInTransaction(tx,{actor:{userId:null,serviceName:name,claimedRoles:[],claimedPermissions:[name]},source:{documentId:String(order.id),eventId},correlationId:eventId,payload});
    validateConfirmationInventoryResult(reservation,payload,true);const member=reservation.lines[0],quantity=member.reservedBaseQuantity,remaining=member.uncoveredBaseQuantity;
    result={quantity,noStock:remaining>0};action=quantity?"backorder_allocated":"backorder_deferred";
    await tx.execute("UPDATE sales_backorder_entries SET outstanding_base_quantity=?,status=?,last_allocation_event_id=?,next_attempt_at=?,last_attempt_at=?,attempt_count=attempt_count+1,last_error_code='',version=version+1,updated_at=? WHERE id=?",[remaining,remaining?"OPEN":"FULFILLED",eventId,nowMs+this.config.backorderNoStockRetryMs,nowMs,nowMs,Number(queue.id)]);
    if(quantity){
     const reserved=Number(line.reservedBaseQuantity)+quantity;
     assertQuantityConservation({orderedBaseQuantity:Number(line.orderedBaseQuantity),reservedOutstandingBaseQuantity:reserved,backorderedBaseQuantity:remaining,fulfilledBaseQuantity:Number(line.fulfilledBaseQuantity),cancelledBaseQuantity:Number(line.cancelledBaseQuantity)});
     await tx.execute("UPDATE sales_order_lines SET reserved_outstanding_base_quantity=?,backordered_base_quantity=?,version=version+1,updated_at=? WHERE id=?",[reserved,remaining,nowMs,line.id]);
     await tx.execute("INSERT INTO sales_order_line_reservations (sales_order_line_id,inventory_reservation_id,inventory_operation_id,source_event_id,original_base_quantity,outstanding_base_quantity,status,inventory_version,created_at,updated_at) VALUES (?,?,?,?,?,?,'ACTIVE',?,?,?)",[line.id,member.reservationId,reservation.operationId,eventId,quantity,quantity,member.version,nowMs,nowMs]);
     version++;const count=order.lines.filter(value=>(value.id===line.id?BigInt(remaining):BigInt(value.backorderedBaseQuantity))>0n).length;
     const [updated]=await tx.execute("UPDATE sales_orders SET has_backorder=?,backorder_line_count=?,version=?,updated_at=?,last_business_updated_at=?,updated_by=NULL WHERE id=? AND version=?",[count>0?1:0,count,version,nowMs,nowMs,order.id,order.version]);if(Number(updated.affectedRows)!==1)throw salesError("CONCURRENT_OPERATION");
     await tx.execute("INSERT INTO sales_order_status_history (sales_order_id,sequence_no,from_status,to_status,action,order_version_after,event_id,actor_user_id,actor_label,occurred_at) SELECT ?,COALESCE(MAX(sequence_no),0)+1,?,?,?,?,?,NULL,?,? FROM sales_order_status_history WHERE sales_order_id=?",[order.id,order.status,order.status,action,version,eventId,name,nowMs,order.id]);
    }
   }
   await this.audit.record(tx,{actor,action:`sales_order.${action}`,targetId:order.id,targetNumber:order.number,eventId,nowMs,details:{fromStatus:order.status,toStatus:order.status,version,commitmentHash:createHash("sha256").update(JSON.stringify({queueId:Number(queue.id),payload:payload??null,result})).digest("hex")}});
   const fresh=await this.authorize?.();if(fresh?.leaseOwner!==leaseOwner||fresh.signal?.aborted!==false)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
   completed=result;return result;
  },{signal,timeoutMs:this.config.transactionTimeoutMs});}
  catch(error){
   signal?.throwIfAborted();
   // Acquire the same lease/owner locks before inspecting facts: the old transaction has settled before retry metadata can change.
   return this.database.withTransaction(async tx=>{
    const {nowMs}=await this.#lease(tx);await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[Number(candidate.sales_order_id)]);
    const [[queue]]=await tx.query("SELECT * FROM sales_backorder_entries WHERE id=? AND sales_order_id=? FOR UPDATE",[Number(candidate.id),Number(candidate.sales_order_id)]);
    const [[audit]]=await tx.query("SELECT action FROM sales_audit_logs WHERE event_id=? AND target_id=? LOCK IN SHARE MODE",[eventId,Number(candidate.sales_order_id)]);
    if(audit){if(completed&&["sales_order.backorder_allocated","sales_order.backorder_deferred","sales_order.backorder_stale"].includes(audit.action))return {...completed,reconciled:true};throw error;}
    if(queue?.status==="OPEN"){
     const delay=Math.min(300000,30000*2**Math.min(Number(queue.attempt_count),4));
     await tx.execute("UPDATE sales_backorder_entries SET next_attempt_at=?,last_attempt_at=?,attempt_count=attempt_count+1,last_error_code='SALES_DEPENDENCY_UNAVAILABLE',version=version+1,updated_at=? WHERE id=?",[nowMs+delay,nowMs,nowMs,Number(queue.id)]);
    }
    return {deferred:true};
   },{signal,timeoutMs:this.config.transactionTimeoutMs});
  }
 }
}
