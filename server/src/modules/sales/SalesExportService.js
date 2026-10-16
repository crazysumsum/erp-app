import {validateSalesOrderQuery} from "./SalesInquiryService.js";
import {salesError} from "./salesErrors.js";

export function validateSalesExportInput(input) {
 if(!input||Array.isArray(input)||Object.keys(input).sort().join(",")!=="filters,scope"||!["ACTIVE","ARCHIVE"].includes(input.scope)||!input.filters||Array.isArray(input.filters)||Object.hasOwn(input.filters,"page")||Object.hasOwn(input.filters,"pageSize"))throw salesError("SALES_INPUT_INVALID");
 const filters=validateSalesOrderQuery(input.filters);delete filters.page;delete filters.pageSize;
 if(input.scope==="ARCHIVE"){
  const from=filters.orderDateFrom,to=filters.orderDateTo;
  if((from!==undefined)!==(to!==undefined)||from&&((Date.parse(to)-Date.parse(from))/86400000+1>366))throw salesError("SALES_INPUT_INVALID");
  if(!filters.number&&!filters.externalOrderId&&!filters.customerId&&!from)throw salesError("SALES_INPUT_INVALID");
 }
 return {scope:input.scope,filters};
}

export function validateSalesExportJobsQuery(input={}){
 if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(key=>!["page","pageSize"].includes(key)))throw salesError("SALES_INPUT_INVALID");
 const query={page:input.page??1,pageSize:input.pageSize??20};if(!Number.isSafeInteger(query.page)||query.page<1||!Number.isSafeInteger(query.pageSize)||query.pageSize<1||query.pageSize>100||!Number.isSafeInteger((query.page-1)*query.pageSize))throw salesError("SALES_INPUT_INVALID");return query;
}

import path from "node:path";
import {constants,createWriteStream} from "node:fs";
import {mkdir,lstat,open,rename,unlink} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {stringify} from "csv-stringify";
import {prepareDiskTempDirectory} from "../../framework/upload/normalizeUploadConfig.js";
import {requireSalesActor,requireSalesExportActorById} from "./salesAuthorization.js";
import {salesOrderWhere,SALES_ORDER_SORT_COLUMNS} from "./SalesInquiryService.js";
import {salesPayloadHash} from "./salesCanonicalHash.js";
import {safeSalesCsvCell} from "./salesCsv.js";
import {SalesOperationService} from "./SalesOperationService.js";
import {salesEventId} from "./salesValidation.js";
import {SalesAuditService} from "./SalesAuditService.js";

export const SALES_EXPORT_COLUMNS=Object.freeze(["number","sourceType","channelCode","externalOrderId","customerCode","customerName","orderDate","warehouseCode","warehouseName","status","currencyCode","totalAmount","orderedBaseQuantity","reservedBaseQuantity","backorderedBaseQuantity","fulfilledBaseQuantity","cancelledBaseQuantity","outstandingBaseQuantity"]);
const leaseMs=60000,day=86400000;
const privateEntry=(stat,directory=false)=>!stat.isSymbolicLink()&&(directory?stat.isDirectory():stat.isFile())&&(stat.mode&0o777)===(directory?0o700:0o600)&&(!process.getuid||stat.uid===process.getuid());
const parsed=value=>typeof value==="string"?JSON.parse(value):value;
export function toSalesExportSummary(row){return {id:Number(row.id),scope:row.scope,filters:parsed(row.filters),status:row.status,rowCount:Number(row.row_count),errorCode:row.error_code,createdAt:Number(row.created_at),startedAt:row.started_at===null?null:Number(row.started_at),completedAt:row.completed_at===null?null:Number(row.completed_at),expiresAt:row.expires_at===null?null:Number(row.expires_at)};}
export class SalesExportService {
 constructor({database,time,config={},root="storage/sales-exports",authorizeSalesExport,audit=new SalesAuditService(),operations=new SalesOperationService()}={}){this.database=database;this.time=time;this.maxRows=config.exportMaxRows??250000;this.fileDays=config.exportFileRetentionDays??7;this.root=prepareDiskTempDirectory(root,"Sales export");this.authorize=authorizeSalesExport;this.audit=audit;this.operations=operations;}
 async authorizeCreate(claims){return this.database.withTransaction(async tx=>{await requireSalesActor(tx,claims,"sales.view");return true;});}
 async create({claims,eventId,input,signal,trace={}}){
  salesEventId(eventId);const snapshot=validateSalesExportInput(input),hash=salesPayloadHash(snapshot);signal?.throwIfAborted();
  return this.operations.run(this.database,async tx=>{const actor=await requireSalesActor(tx,claims,"sales.view"),now=this.time.nowMs(),claim=await this.operations.claim(tx,{eventId,commandType:"CREATE_EXPORT",payload:snapshot,actor,nowMs:now,requestId:trace.requestId,correlationId:trace.correlationId});
   if(claim.replay)return this.#summary((await this.#job(tx,claims,claim.replay.id,true)).row);
   const [inserted]=await tx.execute("INSERT INTO sales_export_jobs(scope,filters,filters_hash,status,created_by,created_at) VALUES(?,?,?,'QUEUED',?,?)",[snapshot.scope,JSON.stringify(snapshot.filters),hash,actor.id,now]),id=Number(inserted.insertId);
   await this.audit.record(tx,{actor,action:"sales_export.created",targetId:id,targetNumber:String(id),eventId,nowMs:now,details:{scope:snapshot.scope,filtersHash:hash,rowCount:0}});
   await this.operations.succeed(tx,{operationId:claim.operationId,commandType:"CREATE_EXPORT",result:{id},nowMs:now});
   const [[row]]=await tx.query("SELECT * FROM sales_export_jobs WHERE id=?",[id]);return toSalesExportSummary(row);
  },{signal});
 }

 #summary(row){const result=toSalesExportSummary(row);if(row.status==="COMPLETED"&&(row.expires_at===null||this.time.nowMs()>=Number(row.expires_at)))result.status="EXPIRED";return result;}
 async #job(tx,claims,id,lock=false){
  if(!Number.isSafeInteger(id)||id<1)throw salesError("SALES_INPUT_INVALID");const actor=await requireSalesActor(tx,claims,"sales.view"),[[row]]=await tx.query("SELECT * FROM sales_export_jobs WHERE id=? AND created_by=?"+(lock?" FOR UPDATE":""),[id,actor.id]);if(!row)throw salesError("SALES_EXPORT_NOT_FOUND");return {actor,row};
 }
 list({claims,input={},signal}){const query=validateSalesExportJobsQuery(input);return this.database.withTransaction(async tx=>{const actor=await requireSalesActor(tx,claims,"sales.view"),[[count]]=await tx.query("SELECT COUNT(*) AS total FROM sales_export_jobs WHERE created_by=?",[actor.id]),[rows]=await tx.query("SELECT * FROM sales_export_jobs WHERE created_by=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",[actor.id,query.pageSize,(query.page-1)*query.pageSize]);return {items:rows.map(row=>this.#summary(row)),total:Number(count.total),...query};},{signal});}
 get({claims,id,signal}){return this.database.withTransaction(async tx=>this.#summary((await this.#job(tx,claims,id)).row),{signal});}
 #downloadable(row){if(row.status==="EXPIRED"||row.status==="COMPLETED"&&(row.expires_at===null||this.time.nowMs()>=Number(row.expires_at)))throw salesError("SALES_EXPORT_EXPIRED");if(row.status!=="COMPLETED")throw salesError("SALES_STATE_CONFLICT");}
 async resolveDownload({claims,id,signal}){
  const {row}=await this.database.withTransaction(tx=>this.#job(tx,claims,id),{signal});this.#downloadable(row);let handle;
  try{
   if(!new RegExp(`^${id}/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.csv$`,"u").test(row.file_path))throw salesError("SALES_EXPORT_EXPIRED");
   if(!privateEntry(await lstat(this.root),true)||!privateEntry(await lstat(path.join(this.root,String(id))),true)||!privateEntry(await lstat(path.join(this.root,row.file_path))))throw salesError("SALES_EXPORT_EXPIRED");
   signal?.throwIfAborted();handle=await open(path.join(this.root,row.file_path),constants.O_RDONLY|constants.O_NOFOLLOW);if(!privateEntry(await handle.stat()))throw salesError("SALES_EXPORT_EXPIRED");
   await this.database.withTransaction(async tx=>{const {row:fresh,actor}=await this.#job(tx,claims,id,true);this.#downloadable(fresh);if(fresh.file_path!==row.file_path)throw salesError("SALES_EXPORT_EXPIRED");await this.audit.record(tx,{actor,action:"sales_export.downloaded",targetId:id,targetNumber:String(id),eventId:randomUUID(),nowMs:this.time.nowMs(),details:{scope:fresh.scope,filtersHash:fresh.filters_hash,rowCount:Number(fresh.row_count)}});},{signal});
   signal?.throwIfAborted();return {stream:handle.createReadStream({autoClose:true,signal}),fileName:`Sales-export-${id}.csv`};
  }catch(error){await handle?.close();if(["ENOENT","ELOOP"].includes(error.code))throw salesError("SALES_EXPORT_EXPIRED");throw error;}
 }
 async #principal(tx,signal){
  const first=await this.authorize?.();if(!first||first.signal!==signal||signal?.aborted!==false||typeof first.leaseOwner!=="string"||!first.leaseOwner)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
  const [[lease]]=await tx.query("SELECT owner,expires_at FROM fr_job_leases WHERE job_name='sales.exportWorker' FOR UPDATE"),[[clock]]=await tx.query("SELECT UNIX_TIMESTAMP() AS now,CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms"),fresh=await this.authorize?.();
  if(fresh?.leaseOwner!==first.leaseOwner||fresh.signal!==signal||signal.aborted||lease?.owner!==first.leaseOwner||![Number(lease?.expires_at),Number(clock.now),Number(clock.now_ms)].every(Number.isSafeInteger)||Number(lease.expires_at)<=Number(clock.now))throw salesError("SALES_DEPENDENCY_UNAVAILABLE");return Number(clock.now_ms);
 }
 async #owned(tx,claim,signal){
  const now=await this.#principal(tx,signal),[[row]]=await tx.query("SELECT * FROM sales_export_jobs WHERE id=? FOR UPDATE",[claim.id]);
  if(!row||row.status!=="PROCESSING"||row.lease_owner!==claim.token||!Number.isSafeInteger(Number(row.lease_until))||Number(row.lease_until)<=now)throw salesError("CONCURRENT_OPERATION");return {row,now};
 }
 async *#csv(tx,job,actorId,signal,counter){
  const snapshot=validateSalesExportInput({scope:job.scope,filters:parsed(job.filters)});if(salesPayloadHash(snapshot)!==job.filters_hash)throw salesError("SALES_INPUT_INVALID");
  const archived=snapshot.scope==="ARCHIVE",table=archived?"sales_orders_archive":"sales_orders",lineTable=archived?"sales_order_lines_archive":"sales_order_lines",query=snapshot.filters,{where,values}=salesOrderWhere(query,{actorId,archived}),column=SALES_ORDER_SORT_COLUMNS[query.sortBy],direction=query.descending?"DESC":"ASC",comparison=query.descending?"<":">";let cursor;
  yield SALES_EXPORT_COLUMNS;
  for(;;){
   signal.throwIfAborted();const suffix=cursor?`${where?" AND ":" WHERE "}(${column}${comparison}? OR (${column}=? AND id${comparison}?))`:"",args=cursor?[...values,cursor.value,cursor.value,cursor.id]:[...values];
   const [rows]=await tx.query(`SELECT id,${query.sortBy==="orderDate"?"DATE_FORMAT(order_date,'%Y-%m-%d')":column} AS cursor_value,sales_order_number AS number,source_type AS sourceType,channel_code_snapshot AS channelCode,external_order_id_snapshot AS externalOrderId,customer_code_snapshot AS customerCode,customer_name_snapshot AS customerName,DATE_FORMAT(order_date,'%Y-%m-%d') AS orderDate,warehouse_code_snapshot AS warehouseCode,warehouse_name_snapshot AS warehouseName,status,currency_code AS currencyCode,total_amount AS totalAmount FROM ${table}${where}${suffix} ORDER BY ${column} ${direction},id ${direction} LIMIT 5000`,args);
   if(!rows.length)return;const ids=rows.map(row=>row.id),[totals]=await tx.query(`SELECT sales_order_id,SUM(ordered_base_quantity) AS ordered,SUM(reserved_outstanding_base_quantity) AS reserved,SUM(backordered_base_quantity) AS backordered,SUM(fulfilled_base_quantity) AS fulfilled,SUM(cancelled_base_quantity) AS cancelled,SUM(ordered_base_quantity-fulfilled_base_quantity-cancelled_base_quantity) AS outstanding FROM ${lineTable} WHERE sales_order_id IN (${ids.map(()=>"?").join(",")}) GROUP BY sales_order_id`,ids),byId=new Map(totals.map(row=>[String(row.sales_order_id),row]));
   for(const row of rows){signal.throwIfAborted();if(++counter.rows>this.maxRows)throw salesError("SALES_EXPORT_ROW_LIMIT_EXCEEDED");const quantities=byId.get(String(row.id));if(!quantities)throw salesError("SALES_STATE_CONFLICT");for(const key of ["ordered","reserved","backordered","fulfilled","cancelled","outstanding"])row[key+"BaseQuantity"]=String(quantities[key]);yield SALES_EXPORT_COLUMNS.map(key=>safeSalesCsvCell(row[key]));}
   const last=rows.at(-1);cursor={id:last.id,value:last.cursor_value};
  }
 }
 async #write(claim,signal){
  if(!privateEntry(await lstat(this.root),true))throw salesError("SALES_DEPENDENCY_UNAVAILABLE");const directory=path.join(this.root,String(claim.id));try{await mkdir(directory,{mode:0o700});}catch(error){if(error.code!=="EEXIST")throw error;}if(!privateEntry(await lstat(directory),true))throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
  const temporary=path.join(directory,claim.token+".tmp"),relative=`${claim.id}/${claim.token}.csv`,counter={rows:0};
  await this.database.withTransaction(async tx=>{const actor=await requireSalesExportActorById(tx,Number(claim.created_by)),{row}=await this.#owned(tx,claim,signal);
   await pipeline(Readable.from(this.#csv(tx,row,actor.id,signal,counter)),stringify({bom:true,record_delimiter:"\r\n"}),createWriteStream(temporary,{flags:"wx",mode:0o600}),{signal});
   const handle=await open(temporary,constants.O_RDWR|constants.O_NOFOLLOW);try{if(!privateEntry(await handle.stat()))throw salesError("SALES_DEPENDENCY_UNAVAILABLE");await handle.sync();}finally{await handle.close();}
   await this.#owned(tx,claim,signal);signal.throwIfAborted();await rename(temporary,path.join(this.root,relative));for(const entry of [directory,this.root]){const folder=await open(entry,constants.O_RDONLY|constants.O_NOFOLLOW);try{await folder.sync();}finally{await folder.close();}}
  },{signal});return {relative,rows:counter.rows};
 }
 async #removeOwn(claim,relative){
  if(relative!==`${claim.id}/${claim.token}.csv`&&relative!==`${claim.id}/${claim.token}.tmp`)throw new TypeError("Invalid Export attempt file");
  const directory=path.join(this.root,String(claim.id));try{if(!privateEntry(await lstat(this.root),true)||!privateEntry(await lstat(directory),true)||!privateEntry(await lstat(path.join(this.root,relative))))throw salesError("SALES_DEPENDENCY_UNAVAILABLE");await unlink(path.join(this.root,relative));}catch(error){if(error.code!=="ENOENT")throw error;}
 }
 async runBatch({signal}={}){
  signal?.throwIfAborted();const token=randomUUID(),claim=await this.database.withTransaction(async tx=>{const now=await this.#principal(tx,signal),[[job]]=await tx.query("SELECT * FROM sales_export_jobs WHERE status='QUEUED' OR (status='PROCESSING' AND (lease_until IS NULL OR lease_until<=?)) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",[now]);if(!job)return null;
   await tx.execute("UPDATE sales_export_jobs SET status='PROCESSING',lease_owner=?,lease_until=?,started_at=COALESCE(started_at,?),error_code='' WHERE id=?",[token,now+leaseMs,now,job.id]);return {...job,id:Number(job.id),token};
  },{signal});if(!claim)return {processed:0,failed:0};
  const relative=`${claim.id}/${token}.csv`;
  try{
   const written=await this.#write(claim,signal);
   await this.database.withTransaction(async tx=>{const actor=await requireSalesExportActorById(tx,Number(claim.created_by)),{row,now}=await this.#owned(tx,claim,signal);
    await this.audit.record(tx,{actor,action:"sales_export.completed",targetId:claim.id,targetNumber:String(claim.id),eventId:randomUUID(),nowMs:now,details:{scope:row.scope,filtersHash:row.filters_hash,rowCount:written.rows}});
    await tx.execute("UPDATE sales_export_jobs SET status='COMPLETED',row_count=?,file_path=?,completed_at=?,expires_at=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?",[written.rows,written.relative,now,now+this.fileDays*day,claim.id,token]);
   },{signal});return {processed:1,failed:0};
  }catch(error){
   // A locking read settles an uncertain publish COMMIT before deleting this attempt's possible durable file.
   let durable;try{durable=await this.database.withTransaction(async tx=>(await tx.query("SELECT status,file_path FROM sales_export_jobs WHERE id=? FOR UPDATE",[claim.id]))[0][0]);}catch{throw error;}
   if(durable?.status==="COMPLETED"&&durable.file_path===relative)return {processed:1,failed:0};
   await this.#removeOwn(claim,`${claim.id}/${token}.tmp`);await this.#removeOwn(claim,relative);signal?.throwIfAborted();
   await this.database.withTransaction(async tx=>{const {now}=await this.#owned(tx,claim,signal),code=["FORBIDDEN","SALES_INPUT_INVALID","SALES_STATE_CONFLICT","SALES_EXPORT_ROW_LIMIT_EXCEEDED"].includes(error.code)?error.code:"SALES_EXPORT_FAILED";await tx.execute("UPDATE sales_export_jobs SET status='FAILED',error_code=?,completed_at=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?",[code,now,claim.id,token]);},{signal});return {processed:1,failed:1};
  }
 }
}
