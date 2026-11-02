import {observeSalesQuery} from "./salesQueryObservations.js";
import {createHash} from "node:crypto";
import {validateSalesOrderQuery,validateSalesAuditQuery,salesOrderWhere,SALES_ORDER_SORT_COLUMNS,toSalesOrderSummary} from "./SalesInquiryService.js";
import {validateSalesExportInput,validateSalesExportJobsQuery} from "./SalesExportService.js";
import {toSalesOrderDetail} from "./SalesOrderService.js";
import {requireSalesActor} from "./salesAuthorization.js";
import {salesError} from "./salesErrors.js";

export function validateSalesArchiveQuery(input={}){
 const query=validateSalesOrderQuery(input),{page,pageSize,...filters}=query;
 validateSalesExportInput({scope:"ARCHIVE",filters});return {...query,page,pageSize};
}
const id=value=>{if(!Number.isSafeInteger(value)||value<1)throw salesError("SALES_INPUT_INVALID");return value;};
const dateProjection="*,DATE_FORMAT(order_date,'%Y-%m-%d') AS order_date,DATE_FORMAT(requested_delivery_date,'%Y-%m-%d') AS requested_delivery_date";
const completed="EXISTS (SELECT 1 FROM sales_archive_order_manifests m WHERE m.sales_order_id=sales_orders_archive.id AND m.archive_batch_id=sales_orders_archive.archive_batch_id)";
const json=value=>typeof value==="string"?JSON.parse(value):value;
export class SalesArchiveInquiryService{
 constructor({database}={}){this.database=database;}
 async list({claims,input={}}){
  const query=validateSalesArchiveQuery(input);
  return observeSalesQuery(this.database,query.number||query.externalOrderId?"archive_exact":"archive_range",()=>this.database.withTransaction(async tx=>{
   const actor=await requireSalesActor(tx,claims,"sales.view"),{where:base,values}=salesOrderWhere({...query,externalOrderId:undefined},{actorId:actor.id,archived:true});let where=base+(base?" AND ":" WHERE ")+completed;
   if(query.externalOrderId){
    const condition="external_order_id_hash=? AND BINARY external_order_id=BINARY ? AND status='SUCCEEDED' AND is_order_archived=1"+(query.channelCode?" AND channel_code=?":""),args=[createHash("sha256").update(query.externalOrderId).digest(),query.externalOrderId,...(query.channelCode?[query.channelCode]:[])];
    // This indexed existence probe determines the allowed store, not the first matching Order.
    const [routes]=await tx.query(`SELECT sales_order_id,is_order_archived FROM sales_external_order_keys WHERE ${condition} ORDER BY id LIMIT 1`,args);
    if(!routes.some(row=>Number(row.is_order_archived)===1))return {items:[],total:0,page:query.page,pageSize:query.pageSize};
    where+=(where?" AND ":" WHERE ")+`id IN (SELECT sales_order_id FROM sales_external_order_keys WHERE ${condition})`;values.push(...args);
   }
   const [[count]]=await tx.query(`SELECT COUNT(*) AS total FROM sales_orders_archive${where}`,values),direction=query.descending?"DESC":"ASC";
   const [page]=await tx.query(`SELECT id FROM sales_orders_archive${where} ORDER BY ${SALES_ORDER_SORT_COLUMNS[query.sortBy]} ${direction},id ${direction} LIMIT ? OFFSET ?`,[...values,query.pageSize,(query.page-1)*query.pageSize]);
   const [rows]=page.length?await tx.query(`SELECT ${dateProjection} FROM sales_orders_archive WHERE id IN (${page.map(()=>"?").join(",")})`,page.map(row=>row.id)):[[]],byId=new Map(rows.map(row=>[String(row.id),row]));
   return {items:page.map(row=>{const snapshot=byId.get(String(row.id));return {...toSalesOrderSummary(snapshot),isArchived:true,archivedAt:Number(snapshot.archived_at),archiveBatchId:Number(snapshot.archive_batch_id)};}),total:Number(count.total),page:query.page,pageSize:query.pageSize};
  }));
 }
 async #header(tx,orderId){const [[row]]=await tx.query(`SELECT ${dateProjection} FROM sales_orders_archive WHERE id=? AND ${completed}`,[orderId]);if(!row)throw salesError("SALES_ORDER_NOT_FOUND");return row;}
 async get({claims,id:orderId}){
  id(orderId);return observeSalesQuery(this.database,"archive_detail",()=>this.database.withTransaction(async tx=>{
   await requireSalesActor(tx,claims,"sales.view");const row=await this.#header(tx,orderId),[lines]=await tx.query("SELECT * FROM sales_order_lines_archive WHERE sales_order_id=? ORDER BY line_no LIMIT 100",[orderId]),[history]=await tx.query("SELECT id,sequence_no,from_status,to_status,action,reason,order_version_after,actor_label,occurred_at FROM sales_order_status_history_archive WHERE sales_order_id=? ORDER BY sequence_no DESC LIMIT 101",[orderId]);
   const [totals]=await tx.query("SELECT sales_order_line_id,COUNT(*) AS total,CAST(SUM(released_base_quantity) AS CHAR) AS released FROM sales_order_line_reservations_archive WHERE sales_order_line_id IN (SELECT id FROM sales_order_lines_archive WHERE sales_order_id=?) GROUP BY sales_order_line_id",[orderId]),byLine=new Map(totals.map(total=>[String(total.sales_order_line_id),total]));
   // One stable bounded window for the whole SO; cumulative release history is independently complete.
   const [window]=await tx.query("SELECT id,sales_order_line_id,inventory_reservation_id,status,original_base_quantity,consumed_base_quantity,released_base_quantity,outstanding_base_quantity FROM sales_order_line_reservations_archive WHERE sales_order_line_id IN (SELECT id FROM sales_order_lines_archive WHERE sales_order_id=?) ORDER BY id LIMIT 500",[orderId]),references=new Map(lines.map(line=>[String(line.id),[]]));
   for(const mapping of window)references.get(String(mapping.sales_order_line_id)).push({id:Number(mapping.id),inventoryReservationId:Number(mapping.inventory_reservation_id),status:mapping.status,originalBaseQuantity:String(mapping.original_base_quantity),consumedBaseQuantity:String(mapping.consumed_base_quantity),releasedBaseQuantity:String(mapping.released_base_quantity),outstandingBaseQuantity:String(mapping.outstanding_base_quantity)});
   const detail=toSalesOrderDetail(row,lines);detail.lines=detail.lines.map(line=>{const reservations=references.get(String(line.id)),total=byLine.get(String(line.id));return {...line,reservations,reservationsTotal:Number(total?.total??0),reservationsTruncated:Number(total?.total??0)>reservations.length,releasedBaseQuantity:String(total?.released??"0")};});
   return {...detail,isArchived:true,allowedActions:[],archivedAt:Number(row.archived_at),archiveBatchId:Number(row.archive_batch_id),historyTruncated:history.length>100,history:history.slice(0,100).reverse().map(item=>({id:Number(item.id),sequence:Number(item.sequence_no),fromStatus:item.from_status,toStatus:item.to_status,action:item.action,reason:item.reason,version:Number(item.order_version_after),actorLabel:item.actor_label,occurredAt:Number(item.occurred_at)}))};
  }));
 }
 async listAudit({claims,id:orderId,input={}}){
  id(orderId);const query=validateSalesAuditQuery(input);if(Object.keys(input).some(key=>["targetType","targetId"].includes(key)))throw salesError("SALES_INPUT_INVALID");
  return this.database.withTransaction(async tx=>{
   await requireSalesActor(tx,claims,"sales.view");await this.#header(tx,orderId);
   const clauses=["target_type='ORDER'","target_id=?"],args=[orderId];for(const [key,column]of [["actorId","actor_user_id"],["action","action"]])if(query[key]!==undefined){clauses.push(`${column}=?`);args.push(query[key]);}for(const [key,op]of [["occurredFrom",">="],["occurredTo","<="]])if(query[key]!==undefined){clauses.push(`occurred_at${op}?`);args.push(query[key]);}
   const where=" WHERE "+clauses.join(" AND "),direction=query.descending?"DESC":"ASC",[[count]]=await tx.query(`SELECT COUNT(*) AS total FROM sales_audit_logs_archive${where}`,args),[rows]=await tx.query(`SELECT id,occurred_at,actor_user_id,actor_label,action,target_type,target_id,target_number,outcome,reason,event_id FROM sales_audit_logs_archive${where} ORDER BY occurred_at ${direction},id ${direction} LIMIT ? OFFSET ?`,[...args,query.pageSize,(query.page-1)*query.pageSize]);
   return {items:rows.map(row=>({id:Number(row.id),occurredAt:Number(row.occurred_at),actorId:row.actor_user_id===null?null:Number(row.actor_user_id),actorLabel:row.actor_label,action:row.action,targetType:row.target_type,targetId:Number(row.target_id),targetNumber:row.target_number,outcome:row.outcome,reason:row.reason,eventId:row.event_id})),total:Number(count.total),page:query.page,pageSize:query.pageSize};
  });
 }
 async listBatches({claims,input={}}){
  const query=validateSalesExportJobsQuery(input);return this.database.withTransaction(async tx=>{
   await requireSalesActor(tx,claims,"sales.view");const [[count]]=await tx.query("SELECT COUNT(*) AS total FROM sales_archive_batches"),[rows]=await tx.query("SELECT id,batch_number,period_key,cutoff_at,status,candidate_count,archived_count,skipped_count,failed_count,started_at,updated_at,completed_at,checksum_summary FROM sales_archive_batches ORDER BY started_at DESC,id DESC LIMIT ? OFFSET ?",[query.pageSize,(query.page-1)*query.pageSize]);
   return {items:rows.map(row=>{
    const summary=json(row.checksum_summary),errors=new Map();for(const item of summary?.pending??[]){const code=new Set(["ARCHIVE_DATA_CONFLICT","OPEN_MATTER_UNKNOWN","SALES_DEPENDENCY_UNAVAILABLE","ORDER_NOT_FINALIZED","RETENTION_NOT_MET","BACKORDER_OPEN","RESERVATION_OPEN","OPERATION_IN_PROGRESS","FULFILLMENT_OPEN","FULFILLMENT_ARCHIVE_NOT_ELIGIBLE"]).has(item.code)?item.code:"SALES_DEPENDENCY_UNAVAILABLE";errors.set(code,(errors.get(code)??0)+1);}
    return {id:Number(row.id),number:row.batch_number,periodKey:row.period_key,status:row.status,cutoffAt:Number(row.cutoff_at),candidateCount:Number(row.candidate_count),archivedCount:Number(row.archived_count),skippedCount:Number(row.skipped_count),failedCount:Number(row.failed_count),startedAt:Number(row.started_at),updatedAt:Number(row.updated_at),completedAt:row.completed_at===null?null:Number(row.completed_at),elapsedMs:Math.max(0,Number(row.completed_at??row.updated_at)-Number(row.started_at)),errors:[...errors].sort(([a],[b])=>a.localeCompare(b)).map(([code,count])=>({code,count})),checksums:summary?{amountHash:summary.amountHash,manifestHash:summary.manifestHash}:null};
   }),total:Number(count.total),page:query.page,pageSize:query.pageSize};
  });
 }
}
