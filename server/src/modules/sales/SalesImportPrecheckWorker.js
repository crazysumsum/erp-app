import {requireSalesImportWorker} from "./salesAuthorization.js";
import {constants} from "node:fs";
import {randomUUID,createHash} from "node:crypto";
import path from "node:path";
import {createReadStream} from "node:fs";
import {CustomerLookupService} from "../customer/CustomerLookupService.js";
import {ItemLookupService} from "../item/ItemLookupService.js";
import {loadPermissionNamesForUser} from "../authorization/directoryLookups.js";
import {parseSalesCsv} from "./salesCsv.js";
import {precheckSalesOrders,sourceOrderPayloadHash,salesSourceHash} from "./salesImportPrecheck.js";
import {salesError} from "./salesErrors.js";
import {SalesAuditService} from "./SalesAuditService.js";
import defaults from "../../../config/sales.js";

const json=value=>typeof value==="string"?JSON.parse(value):value;
export class SalesImportPrecheckWorker {
 constructor({database,time,logger,config=defaults,root,authorizeSalesImport,customerProvider,itemProvider,checkFile,audit}={}) {
  this.database=database;this.config=config;this.root=root;this.authorize=authorizeSalesImport;this.checkFile=checkFile;this.audit=audit??new SalesAuditService();
  this.customers=customerProvider??new CustomerLookupService({database});this.items=itemProvider??new ItemLookupService({database,time,logger});
 }
 #lease(tx,signal){return requireSalesImportWorker(tx,this.authorize,signal);}
 async #actor(tx,userId) {
  const [[user]]=await tx.query("SELECT username FROM users WHERE id=? AND status='active'",[Number(userId)]),permissions=await loadPermissionNamesForUser(tx,Number(userId));
  if(!user||!["sales.view","sales.import"].every(permission=>permissions.includes(permission)))throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
  return {id:Number(userId),username:user.username};
 }
 async #transaction(claim,signal,work) {
  return this.database.withTransaction(async tx=>{
   const fence=await this.#lease(tx,signal),[[job]]=await tx.query("SELECT * FROM sales_import_jobs WHERE id=? FOR UPDATE",[claim.id]);
   if(!job||job.status!=="VALIDATING"||job.lease_owner!==claim.token||Number(job.lease_until)<=fence.nowMs)throw salesError("CONCURRENT_OPERATION");
   await this.#actor(tx,job.created_by);const result=await work(tx,job,fence.nowMs);
   const fresh=await this.#lease(tx,signal);if(fresh.leaseOwner!==fence.leaseOwner)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
   await tx.execute("UPDATE sales_import_jobs SET lease_until=?,updated_at=? WHERE id=? AND lease_owner=?",[fence.nowMs+this.config.confirmationLeaseMs,fence.nowMs,claim.id,claim.token]);return result;
  },{signal,timeoutMs:this.config.transactionTimeoutMs});
 }
 async runBatch({signal}={}) {
  const principal=await this.authorize?.();if(!principal||signal!==principal.signal||signal?.aborted!==false)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
  const token=randomUUID(),claim=await this.database.withTransaction(async tx=>{
   const {nowMs}=await this.#lease(tx,signal),[[job]]=await tx.query(`SELECT j.* FROM sales_import_jobs j WHERE j.status IN ('UPLOADED','VALIDATING') AND j.source_file_path<>''
    AND EXISTS (SELECT 1 FROM users u WHERE u.id=j.created_by AND u.status='active'
     AND (SELECT COUNT(DISTINCT p.name) FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id
      WHERE ur.user_id=u.id AND p.name IN ('sales.view','sales.import'))=2)
    AND (lease_until IS NULL OR lease_until<=?) ORDER BY created_at,id LIMIT 1 FOR UPDATE`,[nowMs]);
   if(!job)return null;await this.#actor(tx,job.created_by);
   await tx.execute("UPDATE sales_import_jobs SET status='VALIDATING',lease_owner=?,lease_until=?,updated_at=?,version=version+1 WHERE id=?",[token,nowMs+this.config.confirmationLeaseMs,nowMs,job.id]);
   return {id:Number(job.id),token,job};
  },{signal,timeoutMs:this.config.transactionTimeoutMs});
  if(!claim)return {processed:0,classified:0};
  try {
   const count=await this.#transaction(claim,signal,async(tx,job)=>{const [[row]]=await tx.query("SELECT COUNT(*) AS n FROM sales_intake_orders WHERE import_job_id=?",[job.id]);return {count:Number(row.n),expected:Number(job.source_order_count)};});
   if(!count.expected||count.count<count.expected){
    const job=claim.job,expected=`${job.batch_number}/source.csv`;
    if(job.source_file_path!==expected||!/^SI-\d{6}-\d{6}$/u.test(job.batch_number))throw salesError("SALES_IMPORT_FILE_INVALID");
    const source=path.join(this.root,expected);await this.checkFile(source,Number(job.file_size_bytes),Buffer.from(job.file_sha256).toString("hex"),signal);
    let batch=[];
    const flush=async()=>{if(batch.length){const current=batch;batch=[];await this.#persist(claim,signal,current);}};
    const digest=createHash("sha256"),stream=createReadStream(source,{signal,flags:constants.O_RDONLY|constants.O_NOFOLLOW});
    async function* verifiedBytes(){for await(const chunk of stream){digest.update(chunk);yield chunk;}}
    await parseSalesCsv(verifiedBytes(),{spoolRoot:this.root,abortSignal:signal,maxRows:this.config.importMaxRows,maxOrders:this.config.importMaxOrders,
     onFileValidated:counts=>{if(digest.digest("hex")!==Buffer.from(job.file_sha256).toString("hex"))throw salesError("SALES_IMPORT_FILE_INVALID");return this.#transaction(claim,signal,(tx,_job,nowMs)=>tx.execute("UPDATE sales_import_jobs SET total_row_count=?,source_order_count=?,updated_at=? WHERE id=?",[counts.rowCount,counts.orderCount,nowMs,claim.id]));},
     onOrder:async group=>{batch.push(group);if(batch.length===this.config.importWorkerBatchSize)await flush();}});
    await flush();
   }
   const classified=await this.#transaction(claim,signal,async(tx,job,nowMs)=>{
    const [[count]]=await tx.query("SELECT COUNT(*) AS n FROM sales_intake_orders WHERE import_job_id=?",[job.id]);if(Number(count.n)!==Number(job.source_order_count))throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
    const [rows]=await tx.query("SELECT * FROM sales_intake_orders WHERE import_job_id=? AND status='RECEIVED' ORDER BY id LIMIT ? FOR UPDATE",[job.id,this.config.importWorkerBatchSize]);
    const groups=[],selected=[],pairs=new Set();
    for(const row of rows){const payload=json(row.safe_payload),keys=payload.lines.map(line=>JSON.stringify([line.skuCode,line.salesUomCode])),next=new Set([...pairs,...keys]);if(next.size>100)break;for(const key of keys)pairs.add(key);
     groups.push({payload,errors:[],channelCode:row.channel_code,externalOrderId:row.external_order_id,firstRowNo:Number(row.first_row_no),lastRowNo:Number(row.last_row_no),processingEventId:row.processing_event_id});selected.push(row);}
    const results=groups.length?await precheckSalesOrders({tx,groups,customers:this.customers,items:this.items,config:this.config,nowMs}):[];
    for(let index=0;index<results.length;index++){
     const result=results[index],row=selected[index];
     if(result.payloadHash!==row.payload_hash)throw salesError("SALES_SOURCE_HASH_COLLISION");
     await tx.execute("UPDATE sales_intake_orders SET status=?,safe_payload=?,external_order_key_id=?,sales_order_id=?,sales_order_number=?,result_code=?,updated_at=? WHERE id=? AND status='RECEIVED'",[result.status,result.payload?JSON.stringify(result.payload):null,result.duplicate?.externalOrderKeyId??null,result.duplicate?.salesOrderId??null,result.duplicate?.salesOrderNumber??"",result.errors[0]?.code??"",nowMs,row.id]);
     await this.#errors(tx,row.id,result.errors,nowMs);
    }
    const [[counts]]=await tx.query(`SELECT COALESCE(SUM(status='VALID'),0) AS valid_count,COALESCE(SUM(status='INVALID'),0) AS invalid_count,COALESCE(SUM(status='DUPLICATE'),0) AS duplicate_count,
     COALESCE(SUM(status='RECEIVED'),0) AS pending,COALESCE(SUM(JSON_LENGTH(safe_payload,'$.warnings')>0),0) AS warning_count FROM sales_intake_orders WHERE import_job_id=?`,[job.id]);
    await tx.execute("UPDATE sales_import_jobs SET valid_count=?,invalid_count=?,duplicate_count=?,warning_count=?,status=?,version=version+1,updated_at=? WHERE id=?",[Number(counts.valid_count),Number(counts.invalid_count),Number(counts.duplicate_count),Number(counts.warning_count),Number(counts.pending)?"VALIDATING":"READY",nowMs,job.id]);
    if(!Number(counts.pending))await this.audit.record(tx,{actor:await this.#actor(tx,job.created_by),action:"sales_import.prechecked",targetId:Number(job.id),targetNumber:job.batch_number,eventId:randomUUID(),nowMs,
     details:{version:Number(job.version)+1,rowCount:Number(job.total_row_count),sourceOrderCount:Number(job.source_order_count),validCount:Number(counts.valid_count),invalidCount:Number(counts.invalid_count),duplicateCount:Number(counts.duplicate_count)}});
    return results.length;
   });
   return {processed:1,classified};
  }catch(error){
   if(["SALES_IMPORT_FILE_INVALID","SALES_IMPORT_VERSION_UNSUPPORTED"].includes(error.code))await this.#transaction(claim,signal,(tx,_job,nowMs)=>tx.execute("UPDATE sales_import_jobs SET status='FAILED',completed_at=?,version=version+1,updated_at=? WHERE id=?",[nowMs,nowMs,claim.id]));
   throw error;
  }finally{
   // A stopped/lost principal cannot change ownership; its durable claim expires for the next registered worker.
   if(!signal.aborted)await this.database.withTransaction(async tx=>{
    const {nowMs}=await this.#lease(tx,signal);await tx.execute("UPDATE sales_import_jobs SET lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_owner=?",[nowMs,claim.id,claim.token]);
   },{signal,timeoutMs:this.config.transactionTimeoutMs});
  }
 }
 async #persist(claim,signal,groups) {
  await this.#transaction(claim,signal,async(tx,_job,nowMs)=>{
   const [sizes]=await tx.query(groups.map(()=>"SELECT ? AS request_index,LENGTH(CAST(CAST(? AS JSON) AS CHAR CHARSET utf8mb4)) AS bytes").join(" UNION ALL "),groups.flatMap((group,index)=>[index,JSON.stringify(group.payload)]));
   for(let index=0;index<groups.length;index++){
    const group=groups[index],hash=sourceOrderPayloadHash(group),sourceHash=salesSourceHash(group.sourceOrderKey),[[existing]]=await tx.query("SELECT source_order_key,payload_hash FROM sales_intake_orders WHERE import_job_id=? AND source_order_key_hash=? FOR UPDATE",[claim.id,sourceHash]);
    if(existing){if(existing.source_order_key!==group.sourceOrderKey||existing.payload_hash!==hash)throw salesError("SALES_SOURCE_HASH_COLLISION");continue;}
    const errors=[...group.errors];if(Number(sizes[index].bytes)>131072)errors.push({rowNo:group.firstRowNo,field:"payload",code:"SALES_IMPORT_ORDER_INVALID"});
    const [inserted]=await tx.execute(`INSERT INTO sales_intake_orders (import_job_id,source_type,source_order_key,source_order_key_hash,channel_code,external_order_id,external_order_id_hash,schema_version,payload_hash,safe_payload,
     first_row_no,last_row_no,line_count,status,processing_event_id,created_at,updated_at) VALUES (?,'CSV',?,?,?,?,?,'1.0',?,?,?,?,?,?,?,?,?)`,[claim.id,group.sourceOrderKey,sourceHash,group.channelCode,group.externalOrderId,salesSourceHash(group.externalOrderId),hash,errors.length?null:JSON.stringify(group.payload),group.firstRowNo,group.lastRowNo,Math.max(1,Math.min(100,group.payload.lines.length)),errors.length?"INVALID":"RECEIVED",randomUUID(),nowMs,nowMs]);
    await this.#errors(tx,inserted.insertId,errors,nowMs);
   }
  });
 }
 async #errors(tx,intakeId,errors,nowMs) {
  const bounded=errors.slice(0,200);if(errors.length>200)bounded[199]={rowNo:errors.at(-1).rowNo,field:"row",code:"TOO_MANY_ERRORS"};
  for(const error of bounded)await tx.execute("INSERT INTO sales_intake_errors (intake_order_id,row_no,field_path,error_code,safe_message,created_at) VALUES (?,?,?,?,?,?)",[intakeId,error.rowNo,error.field,error.code,"來源訂單未通過驗證，請檢查指定欄位",nowMs]);
 }
}
