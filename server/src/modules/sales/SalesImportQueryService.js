import {requireSalesActor} from "./salesAuthorization.js";
import {salesError} from "./salesErrors.js";
import {salesSourceHash} from "./salesImportPrecheck.js";
export const IMPORT_JOB_STATUSES=Object.freeze(["UPLOADED","VALIDATING","READY","QUEUED","PROCESSING","COMPLETED","PARTIAL_SUCCESS","FAILED","CANCELLED"]);
export const INTAKE_STATUSES=Object.freeze(["RECEIVED","VALIDATING","VALID","INVALID","DUPLICATE","QUEUED","PROCESSING","SUCCEEDED","FAILED"]);
const sorts={jobs:{createdAt:"created_at",updatedAt:"updated_at",batchNumber:"batch_number",status:"status"},orders:{id:"i.id",firstRowNo:"i.first_row_no",status:"i.status",createdAt:"i.created_at"},errors:{id:"id"}};
export function validateSalesImportQuery(input={},kind="jobs") {
 const fields={jobs:["status","actorId","fileName","createdFrom","createdTo"],orders:["status","sourceOrderKey","externalOrderId","channelCode"],errors:[]};
 if(!Object.hasOwn(fields,kind)||!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(key=>!["page","pageSize",...(kind==="errors"?[]:["sortBy","descending"]),...fields[kind]].includes(key)))throw salesError("SALES_INPUT_INVALID");
 const query={...input,page:input.page??1,pageSize:input.pageSize??20,sortBy:input.sortBy??(kind==="jobs"?"createdAt":kind==="orders"?"firstRowNo":"id"),descending:input.descending??kind==="jobs"};
 if(!Number.isSafeInteger(query.page)||query.page<1||!Number.isSafeInteger(query.pageSize)||query.pageSize<1||query.pageSize>100||!Number.isSafeInteger((query.page-1)*query.pageSize)||!Object.hasOwn(sorts[kind],query.sortBy)||typeof query.descending!=="boolean")throw salesError("SALES_INPUT_INVALID");
 if(query.status!==undefined&&!(kind==="jobs"?IMPORT_JOB_STATUSES:INTAKE_STATUSES).includes(query.status))throw salesError("SALES_INPUT_INVALID");
 for(const field of ["actorId","createdFrom","createdTo"])if(query[field]!==undefined&&(!Number.isSafeInteger(query[field])||query[field]<(field==="actorId"?1:0)))throw salesError("SALES_INPUT_INVALID");
 if(query.createdFrom!==undefined&&query.createdTo!==undefined&&query.createdFrom>query.createdTo)throw salesError("SALES_INPUT_INVALID");
 for(const field of ["fileName","sourceOrderKey","externalOrderId","channelCode"])if(query[field]!==undefined&&(typeof query[field]!=="string"||[...query[field]].length>(field==="fileName"?255:field==="channelCode"?50:190)||/[\p{Cc}\p{Cf}]/u.test(query[field])))throw salesError("SALES_INPUT_INVALID");
 return query;
}
const jobSelect="id,batch_number,template_version,original_file_name,status,total_row_count,source_order_count,valid_count,invalid_count,duplicate_count,success_count,failed_count,warning_count,version,created_by,confirmed_by,created_at,updated_at,completed_at,files_purged_at";
const admitted="(source_file_path<>'' OR files_purged_at IS NOT NULL)",id=value=>{if(!Number.isSafeInteger(value)||value<1)throw salesError("SALES_INPUT_INVALID");return value;};
export function toSalesImportSummary(row,actor) {
 const result={id:Number(row.id),batchNumber:row.batch_number,templateVersion:row.template_version,fileName:row.original_file_name,status:row.status,version:Number(row.version),createdBy:row.created_by===null?null:Number(row.created_by),confirmedBy:row.confirmed_by===null?null:Number(row.confirmed_by),createdAt:Number(row.created_at),updatedAt:Number(row.updated_at),completedAt:row.completed_at===null?null:Number(row.completed_at),filesPurgedAt:row.files_purged_at===null?null:Number(row.files_purged_at)};
 for(const [name,column] of Object.entries({totalRowCount:"total_row_count",sourceOrderCount:"source_order_count",validCount:"valid_count",invalidCount:"invalid_count",duplicateCount:"duplicate_count",successCount:"success_count",failedCount:"failed_count",warningCount:"warning_count"}))result[name]=Number(row[column]);
 result.allowedActions=actor.permissions.includes("sales.import")?(row.status==="READY"?["confirm","cancel"]:row.status==="QUEUED"?["cancel"]:[]):[];return result;
}
const page=(items,total,query)=>({items,total:Number(total),page:query.page,pageSize:query.pageSize});
export class SalesImportQueryService {
 constructor({database}={}){this.database=database;}
 async #job(tx,jobId){const [[job]]=await tx.query(`SELECT ${jobSelect} FROM sales_import_jobs WHERE id=? AND ${admitted}`,[id(jobId)]);if(!job)throw salesError("SALES_IMPORT_NOT_FOUND");return job;}
 async list({claims,input={}}){const query=validateSalesImportQuery(input),clauses=[admitted],values=[];
  for(const [field,column,operator] of [["status","status","="],["actorId","created_by","="],["createdFrom","created_at",">="],["createdTo","created_at","<="]])if(query[field]!==undefined){clauses.push(`${column}${operator}?`);values.push(query[field]);}
  if(query.fileName!==undefined){clauses.push("original_file_name LIKE ? ESCAPE '!'");values.push(`%${query.fileName.replace(/[!%_]/gu,value=>"!"+value)}%`);}
  return this.database.withTransaction(async tx=>{const actor=await requireSalesActor(tx,claims,"sales.view"),where=" WHERE "+clauses.join(" AND "),[[count]]=await tx.query(`SELECT COUNT(*) AS total FROM sales_import_jobs${where}`,values),[rows]=await tx.query(`SELECT ${jobSelect} FROM sales_import_jobs${where} ORDER BY ${sorts.jobs[query.sortBy]} ${query.descending?"DESC":"ASC"},id ${query.descending?"DESC":"ASC"} LIMIT ? OFFSET ?`,[...values,query.pageSize,(query.page-1)*query.pageSize]);return page(rows.map(row=>toSalesImportSummary(row,actor)),count.total,query);});
 }
 get({claims,id:jobId}){id(jobId);return this.database.withTransaction(async tx=>{const actor=await requireSalesActor(tx,claims,"sales.view");return toSalesImportSummary(await this.#job(tx,jobId),actor);});}
 orders({claims,id:jobId,input={}}){id(jobId);const query=validateSalesImportQuery(input,"orders");return this.database.withTransaction(async tx=>{
  await requireSalesActor(tx,claims,"sales.view");await this.#job(tx,jobId);const clauses=["i.import_job_id=?"],values=[jobId];
  for(const field of ["status","channelCode"])if(query[field]!==undefined){clauses.push(`i.${field==="status"?"status":"channel_code"}=?`);values.push(query[field]);}
  for(const [field,column] of [["sourceOrderKey","source_order_key"],["externalOrderId","external_order_id"]])if(query[field]!==undefined){clauses.push(`i.${column}_hash=? AND BINARY i.${column}=BINARY ?`);values.push(salesSourceHash(query[field]),query[field]);}
  const where=" WHERE "+clauses.join(" AND "),[[count]]=await tx.query(`SELECT COUNT(*) AS total FROM sales_intake_orders i${where}`,values),[rows]=await tx.query(`SELECT i.id,i.source_order_key,i.channel_code,i.external_order_id,i.first_row_no,i.last_row_no,i.line_count,i.status,i.sales_order_id,i.sales_order_number,i.result_code,i.created_at,i.completed_at,k.is_order_archived
   FROM sales_intake_orders i LEFT JOIN sales_external_order_keys k ON k.id=i.external_order_key_id${where} ORDER BY ${sorts.orders[query.sortBy]} ${query.descending?"DESC":"ASC"},i.id ${query.descending?"DESC":"ASC"} LIMIT ? OFFSET ?`,[...values,query.pageSize,(query.page-1)*query.pageSize]);
  return page(rows.map(row=>({id:Number(row.id),sourceOrderKey:row.source_order_key,channelCode:row.channel_code,externalOrderId:row.external_order_id,firstRowNo:Number(row.first_row_no),lastRowNo:Number(row.last_row_no),lineCount:Number(row.line_count),status:row.status,salesOrderId:row.sales_order_id===null?null:Number(row.sales_order_id),salesOrderNumber:row.sales_order_number,isArchived:Boolean(row.is_order_archived),resultCode:row.result_code,createdAt:Number(row.created_at),completedAt:row.completed_at===null?null:Number(row.completed_at)})),count.total,query);
 });}
 errors({claims,id:jobId,orderId,input={}}){id(jobId);id(orderId);const query=validateSalesImportQuery(input,"errors");return this.database.withTransaction(async tx=>{
  await requireSalesActor(tx,claims,"sales.view");await this.#job(tx,jobId);const [[child]]=await tx.query("SELECT id FROM sales_intake_orders WHERE id=? AND import_job_id=?",[orderId,jobId]);if(!child)throw salesError("SALES_IMPORT_NOT_FOUND");
  const [[count]]=await tx.query("SELECT COUNT(*) AS total FROM sales_intake_errors WHERE intake_order_id=?",[orderId]),[rows]=await tx.query("SELECT id,row_no,field_path,error_code,safe_message,created_at FROM sales_intake_errors WHERE intake_order_id=? ORDER BY row_no,id LIMIT ? OFFSET ?",[orderId,query.pageSize,(query.page-1)*query.pageSize]);
  return page(rows.map(row=>({id:Number(row.id),rowNo:Number(row.row_no),field:row.field_path,code:row.error_code,message:row.safe_message,createdAt:Number(row.created_at)})),count.total,query);
 });}
}
