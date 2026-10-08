import path from "node:path";
import {SalesImportPrecheckWorker} from "./SalesImportPrecheckWorker.js";
import {constants,createReadStream} from "node:fs";
import {lstat,readFile,open,mkdir,rename,rmdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {ApplicationError} from "../../framework/errors/ApplicationError.js";
import {prepareDiskTempDirectory} from "../../framework/upload/normalizeUploadConfig.js";
import {requireSalesActor} from "./salesAuthorization.js";
import {SalesOperationService} from "./SalesOperationService.js";
import {SalesSequenceService} from "./SalesSequenceService.js";
import {SalesAuditService} from "./SalesAuditService.js";
import {transitionImportJob} from "./SalesIntakeStateMachine.js";
import {salesPayloadHash} from "./salesCanonicalHash.js";
import {salesEventId} from "./salesValidation.js";
import {salesError} from "./salesErrors.js";

const invalid=()=>salesError("SALES_IMPORT_FILE_INVALID");
export function validateSalesImportCommand(input){
 if(!input||Array.isArray(input)||Object.keys(input).sort().join(",")!=="eventId,version"||!Number.isInteger(input.version)||input.version<1||input.version>=4294967295)throw salesError("SALES_INPUT_INVALID");
 salesEventId(input.eventId);return {eventId:input.eventId,version:input.version};
}
function privateEntry(stat,directory=false) {
 return !stat.isSymbolicLink()&&(directory?stat.isDirectory():stat.isFile())&&(stat.mode&0o777)===(directory?0o700:0o600)&&(!process.getuid||stat.uid===process.getuid());
}
async function actorInTransaction(tx,claims) {
 const actor=await requireSalesActor(tx,claims,"sales.import");
 if(!actor.permissions.includes("sales.view"))throw new ApplicationError("Sales view permission is required",{code:"FORBIDDEN",statusCode:403});
 return actor;
}
async function checkFile(filePath,size,hash,signal) {
 signal?.throwIfAborted();let handle;
 try {
  if(!privateEntry(await lstat(filePath)))throw invalid();
  handle=await open(filePath,constants.O_RDONLY|constants.O_NOFOLLOW);
  const stat=await handle.stat();if(!privateEntry(stat)||stat.size!==size)throw invalid();
  const digest=createHash("sha256");
  for await(const chunk of createReadStream(filePath,{fd:handle.fd,autoClose:false,signal}))digest.update(chunk);
  if(digest.digest("hex")!==hash)throw invalid();
 }catch(error){if(["ENOENT","ELOOP"].includes(error.code))throw invalid();throw error;}
 finally{await handle?.close();}
}
function summary(row,warnings=[]) {
 return {importJob:{id:Number(row.id),batchNumber:row.batch_number,status:row.status,version:Number(row.version)},warnings};
}

export class SalesImportService {
 constructor({database,time,root="storage/sales-imports",tempRoot="storage/uploads/tmp",...options}={}) {
  this.workerOptions=options;this.database=database;this.time=time;this.root=prepareDiskTempDirectory(root,"Sales import");
  this.tempRoot=prepareDiskTempDirectory(tempRoot,"Sales import temp");this.operations=new SalesOperationService();this.sequence=new SalesSequenceService({time});this.audit=options.audit??new SalesAuditService();
 }
 runPrecheckBatch(request){
  this.precheck??=new SalesImportPrecheckWorker({...this.workerOptions,database:this.database,time:this.time,root:this.root,checkFile});
  return this.precheck.runBatch(request);
 }
 authorizeUpload(claims){return this.database.withTransaction(tx=>actorInTransaction(tx,claims)).then(()=>true);}
 confirm(request){return this.#control(request,"QUEUED","CONFIRM_IMPORT");}
 cancel(request){return this.#control(request,"CANCELLED","CANCEL_IMPORT");}
 async #control({claims,id,input,abortSignal,trace={}},status,commandType){
  if(!Number.isSafeInteger(id)||id<1)throw salesError("SALES_INPUT_INVALID");
  const {eventId,version}=validateSalesImportCommand(input);abortSignal?.throwIfAborted();
  return this.operations.run(this.database,async tx=>{
   const actor=await actorInTransaction(tx,claims),nowMs=this.time.nowMs();
   const claim=await this.operations.claim(tx,{eventId,commandType,targetId:id,payload:{version},actor,nowMs,...trace});
   const [[job]]=await tx.query("SELECT id,batch_number,status,version,source_file_path,files_purged_at FROM sales_import_jobs WHERE id=? FOR UPDATE",[id]);
   if(!job||!job.source_file_path&&job.files_purged_at===null)throw salesError("SALES_IMPORT_NOT_FOUND");
   if(claim.replay)return {importJob:{id:claim.replay.id,batchNumber:claim.replay.number,status:claim.replay.status,version:claim.replay.version},warnings:[]};
   if(Number(job.version)!==version)throw salesError("VERSION_CONFLICT",{currentVersion:Number(job.version)});
   transitionImportJob(job.status,status);abortSignal?.throwIfAborted();
   const [written]=await tx.execute(`UPDATE sales_import_jobs SET status=?,version=version+1,updated_at=?,
    ${status==="QUEUED"?"confirmed_by=?,confirmed_at=?":"completed_at=?"} WHERE id=? AND version=? AND status=?`,
    status==="QUEUED"?[status,nowMs,actor.id,nowMs,id,version,job.status]:[status,nowMs,nowMs,id,version,job.status]);
   if(Number(written.affectedRows)!==1)throw salesError("CONCURRENT_OPERATION");
   if(status==="QUEUED")await tx.execute("UPDATE sales_intake_orders SET status='QUEUED',updated_at=? WHERE import_job_id=? AND status='VALID'",[nowMs,id]);
   await this.audit.record(tx,{actor,action:status==="QUEUED"?"sales_import.confirmed":"sales_import.cancelled",targetId:id,targetNumber:job.batch_number,eventId,nowMs,...trace,details:{fromStatus:job.status,toStatus:status,version:version+1}});
   const result={id,number:job.batch_number,status,version:version+1};await this.operations.succeed(tx,{operationId:claim.operationId,result,nowMs});
   abortSignal?.throwIfAborted();return {importJob:{id,batchNumber:job.batch_number,status,version:version+1},warnings:[]};
  },{signal:abortSignal});
 }
 async resolveResultDownload({claims,id,abortSignal}){
  if(!Number.isSafeInteger(id)||id<1)throw salesError("SALES_INPUT_INVALID");
  const job=await this.database.withTransaction(async tx=>{
   await requireSalesActor(tx,claims,"sales.view");const [[row]]=await tx.query("SELECT id,batch_number,status,result_file_path,completed_at,files_purged_at FROM sales_import_jobs WHERE id=? AND (source_file_path<>'' OR files_purged_at IS NOT NULL)",[id]);
   if(!row)throw salesError("SALES_IMPORT_NOT_FOUND");
   if(row.files_purged_at!==null)throw salesError("SALES_IMPORT_RESULT_EXPIRED");
   if(!["COMPLETED","PARTIAL_SUCCESS","FAILED"].includes(row.status))throw salesError("SALES_STATE_CONFLICT");
   if(row.completed_at===null||this.time.nowMs()>=Number(row.completed_at)+90*86400000)throw salesError("SALES_IMPORT_RESULT_EXPIRED");
   return row;
  },{signal:abortSignal});
  let handle;
  try{
   if(!/^SI-\d{6}-\d{6}$/u.test(job.batch_number)||job.result_file_path!==`${job.batch_number}/result.csv`)throw salesError("SALES_IMPORT_RESULT_EXPIRED");
   if(!privateEntry(await lstat(this.root),true)||!privateEntry(await lstat(path.join(this.root,job.batch_number)),true)||!privateEntry(await lstat(path.join(this.root,job.result_file_path))))throw salesError("SALES_IMPORT_RESULT_EXPIRED");
   abortSignal?.throwIfAborted();handle=await open(path.join(this.root,job.result_file_path),constants.O_RDONLY|constants.O_NOFOLLOW);
   if(!privateEntry(await handle.stat()))throw salesError("SALES_IMPORT_RESULT_EXPIRED");
   return {stream:handle.createReadStream({autoClose:true,signal:abortSignal}),fileName:`${job.batch_number}-result.csv`};
  }catch(error){await handle?.close();if(["ENOENT","ELOOP"].includes(error.code))throw salesError("SALES_IMPORT_RESULT_EXPIRED");throw error;}
 }
 async createFromUpload({claims,eventId,file,abortSignal,trace={}}) {
  abortSignal?.throwIfAborted();salesEventId(eventId);
  if(!file||file.field!=="file"||!["text/csv","application/csv"].includes(file.mimeType)||!Number.isSafeInteger(file.size)||file.size<1||file.size>52428800||
   !/^[a-f0-9]{64}$/u.test(file.contentHash)||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.csv$/u.test(file.storedName)||
   typeof file.path!=="string"||path.basename(file.path)!==file.storedName||path.dirname(path.dirname(file.path))!==this.tempRoot||
   !/^upload-[a-zA-Z0-9]{6}$/u.test(path.basename(path.dirname(file.path))))throw invalid();
  prepareDiskTempDirectory(this.tempRoot);
  if(!privateEntry(await lstat(path.dirname(file.path)),true)||await readFile(path.join(path.dirname(file.path),".upload-owner"),"utf8")!=="erp-disk-upload-v1\n")throw invalid();
  await checkFile(file.path,file.size,file.contentHash,abortSignal);
  const intent={fileHash:file.contentHash,fileSize:file.size,templateVersion:"1.0"},hash=salesPayloadHash(intent),nowMs=this.time.nowMs();
  const stage=await this.operations.run(this.database,async tx=>{
   const actor=await actorInTransaction(tx,claims);abortSignal?.throwIfAborted();
   let operationId;
   try {
    const [inserted]=await tx.execute(`INSERT INTO sales_operation_requests
     (event_id,command_type,target_type,request_hash,status,actor_user_id,actor_label,request_id,correlation_id,created_at,updated_at)
     VALUES (?,'UPLOAD_IMPORT','IMPORT_JOB',?,'IN_PROGRESS',?,?,?,?,?,?)`,
     [eventId,hash,actor.id,actor.username,trace.requestId??"",trace.correlationId??"",nowMs,nowMs]);operationId=Number(inserted.insertId);
   }catch(error){
    if((error.cause?.code??error.code)!=="ER_DUP_ENTRY")throw error;
    const [[existing]]=await tx.query("SELECT id,command_type,target_type,request_hash,actor_user_id,target_id,status,result_summary FROM sales_operation_requests WHERE event_id=? FOR UPDATE",[eventId]);
    if(!existing||existing.command_type!=="UPLOAD_IMPORT"||existing.target_type!=="IMPORT_JOB"||existing.request_hash!==hash||Number(existing.actor_user_id)!==actor.id)throw salesError("SALES_EVENT_CONFLICT");
    const [[job]]=await tx.query("SELECT id,batch_number,status,version,source_file_path FROM sales_import_jobs WHERE id=? FOR UPDATE",[existing.target_id]);
    if(!job||!["IN_PROGRESS","SUCCEEDED"].includes(existing.status))throw salesError("CONCURRENT_OPERATION");
    return {operationId:Number(existing.id),job,admitted:existing.status==="SUCCEEDED",result:typeof existing.result_summary==="string"?JSON.parse(existing.result_summary):existing.result_summary};
   }
   const number=await this.sequence.nextNumberInTransaction(tx,{documentType:"IMPORT_BATCH",nowMs});
   const originalName=path.basename(String(file.originalName??"import.csv")).replace(/[\p{Cc}]/gu,"").slice(0,255)||"import.csv";
   const [inserted]=await tx.execute(`INSERT INTO sales_import_jobs (batch_number,template_version,original_file_name,file_sha256,file_size_bytes,status,created_by,created_at,updated_at)
    VALUES (?,'1.0',?,?,?,'UPLOADED',?,?,?)`,[number,originalName,Buffer.from(file.contentHash,"hex"),file.size,actor.id,nowMs,nowMs]);
   const id=Number(inserted.insertId);
   await tx.execute("UPDATE sales_operation_requests SET target_id=?,recovery_payload=? WHERE id=?",[id,JSON.stringify(intent),operationId]);
   return {operationId,job:{id,batch_number:number,status:"UPLOADED",version:1,source_file_path:""},admitted:false};
  },{signal:abortSignal});
  if(stage.admitted)return stage.result;
  const directory=path.join(this.root,stage.job.batch_number),relative=`${stage.job.batch_number}/source.csv`,destination=path.join(this.root,relative);
  try {
   return await this.operations.run(this.database,async tx=>{
    const actor=await actorInTransaction(tx,claims);
    const [[operation]]=await tx.query("SELECT status,target_id,request_hash,actor_user_id,result_summary FROM sales_operation_requests WHERE id=? FOR UPDATE",[stage.operationId]);
    if(!operation||operation.request_hash!==hash||Number(operation.target_id)!==Number(stage.job.id))throw salesError("SALES_EVENT_CONFLICT");
    const [[job]]=await tx.query("SELECT id,batch_number,status,version,source_file_path FROM sales_import_jobs WHERE id=? FOR UPDATE",[stage.job.id]);
    if(!job)throw salesError("SALES_IMPORT_NOT_FOUND");
    if(operation.status==="SUCCEEDED")return typeof operation.result_summary==="string"?JSON.parse(operation.result_summary):operation.result_summary;
    if(operation.status!=="IN_PROGRESS"||job.status!=="UPLOADED"||job.source_file_path!=="")throw salesError("CONCURRENT_OPERATION");
    abortSignal?.throwIfAborted();prepareDiskTempDirectory(this.root);
    try{await mkdir(directory,{mode:0o700});}catch(error){if(error.code!=="EEXIST")throw error;}
    if(!privateEntry(await lstat(directory),true))throw invalid();
    let exists=true;try{await lstat(destination);}catch(error){if(error.code!=="ENOENT")throw error;exists=false;}
    if(exists)await checkFile(destination,file.size,file.contentHash,abortSignal);
    else{await checkFile(file.path,file.size,file.contentHash,abortSignal);abortSignal?.throwIfAborted();await rename(file.path,destination);}
    abortSignal?.throwIfAborted();
    const [[duplicate]]=await tx.query("SELECT id FROM sales_import_jobs WHERE file_sha256=? AND id<>? AND source_file_path<>'' LIMIT 1",[Buffer.from(file.contentHash,"hex"),job.id]);
    const warnings=duplicate?[{code:"SAME_FILE_PREVIOUSLY_UPLOADED"}]:[];
    await tx.execute("UPDATE sales_import_jobs SET source_file_path=?,updated_at=? WHERE id=? AND source_file_path=''",[relative,this.time.nowMs(),job.id]);
    const result=summary(job,warnings);
    await this.audit.record(tx,{actor,action:"sales_import.uploaded",targetId:Number(job.id),targetNumber:job.batch_number,eventId,nowMs:this.time.nowMs(),...trace,details:{version:Number(job.version)}});
    await tx.execute("UPDATE sales_operation_requests SET status='SUCCEEDED',result_type='IMPORT_JOB',result_id=?,result_summary=?,completed_at=?,updated_at=? WHERE id=? AND status='IN_PROGRESS'",[job.id,JSON.stringify(result),this.time.nowMs(),this.time.nowMs(),stage.operationId]);
    return result;
   },{signal:abortSignal});
  }catch(error){
   // A moved file belongs to the durable staging Job even when COMMIT acknowledgement is lost.
   let moved=true;try{await lstat(destination);}catch(probe){if(probe.code!=="ENOENT")throw error;moved=false;}
   if(!moved&&error.code!=="TRANSACTION_OUTCOME_UNKNOWN") {
    try {
     await this.database.withTransaction(async tx=>{
      const [[operation]]=await tx.query("SELECT status FROM sales_operation_requests WHERE id=? FOR UPDATE",[stage.operationId]);
      if(operation?.status!=="IN_PROGRESS")return;
      const [[job]]=await tx.query("SELECT status,source_file_path FROM sales_import_jobs WHERE id=? FOR UPDATE",[stage.job.id]);
      if(!job||job.status!=="UPLOADED"||job.source_file_path!=="")return;
      // Same-event retries can move a file while this compensator waits for the operation lock.
      try{await lstat(destination);return;}catch(probe){if(probe.code!=="ENOENT")throw probe;}
      await tx.execute("DELETE FROM sales_import_jobs WHERE id=? AND status='UPLOADED' AND source_file_path=''",[stage.job.id]);
      await tx.execute("DELETE FROM sales_operation_requests WHERE id=? AND status='IN_PROGRESS'",[stage.operationId]);
     });
     await rmdir(directory).catch(failure=>{if(!["ENOENT","ENOTEMPTY"].includes(failure.code))throw failure;});
    }catch{throw salesError("SALES_DEPENDENCY_UNAVAILABLE");}
   }
   throw error;
  }
 }
}
