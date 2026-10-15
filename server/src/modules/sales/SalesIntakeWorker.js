import {randomUUID} from "node:crypto";
import path from "node:path";
import {constants} from "node:fs";
import {lstat,open,opendir,rename,unlink} from "node:fs/promises";
import {SalesIntakeService} from "./SalesIntakeService.js";
import {SalesAuditService} from "./SalesAuditService.js";
import {requireSalesImportActorById,requireSalesImportWorker} from "./salesAuthorization.js";
import {createSalesImportResultStream} from "./salesImportResult.js";
import {salesError} from "./salesErrors.js";
import defaults from "../../../config/sales.js";
const terminal=["INVALID","DUPLICATE","SUCCEEDED","FAILED"];
export class SalesIntakeWorker {
 constructor({database,time,logger,config=defaults,root,authorizeSalesImport,channelVerifier,intakeService,audit}={}){
  this.database=database;this.config=config;this.root=root;this.authorize=authorizeSalesImport;this.logger=logger;this.audit=audit??new SalesAuditService();this.intake=intakeService??new SalesIntakeService({database,time,logger,config,authorizeSalesImport,channelVerifier});
 }
 #lease(tx,signal,previous){return requireSalesImportWorker(tx,this.authorize,signal,previous);}
 async #transaction(claim,signal,work){
  return this.database.withTransaction(async tx=>{
   const first=await this.#lease(tx,signal);let job,actor,nowMs=first.nowMs;
   if(claim){[[job]]=await tx.query("SELECT * FROM sales_import_jobs WHERE id=? FOR UPDATE",[claim.id]);const fresh=await this.#lease(tx,signal,first);nowMs=fresh.nowMs;if(!job||job.status!=="PROCESSING"||job.lease_owner!==claim.token||Number(job.lease_until)<=fresh.nowMs||Number(job.confirmed_by)!==claim.actorId)throw salesError("CONCURRENT_OPERATION");actor=await requireSalesImportActorById(tx,claim.actorId);}
   const result=await work(tx,job,actor,nowMs),last=await this.#lease(tx,signal,first);if(job&&Number(job.lease_until)<=last.nowMs)throw salesError("CONCURRENT_OPERATION");
   if(job)await tx.execute("UPDATE sales_import_jobs SET lease_until=?,updated_at=? WHERE id=? AND status='PROCESSING' AND lease_owner=?",[last.nowMs+this.config.confirmationLeaseMs,last.nowMs,claim.id,claim.token]);return result;
  },{signal,timeoutMs:this.config.transactionTimeoutMs});
 }
 async #claimJob(signal){
  return this.database.withTransaction(async tx=>{
   const first=await this.#lease(tx,signal),[[job]]=await tx.query(`SELECT j.* FROM sales_import_jobs j WHERE j.status IN ('QUEUED','PROCESSING') AND j.source_file_path<>'' AND (j.lease_until IS NULL OR j.lease_until<=?)
    AND EXISTS (SELECT 1 FROM users u WHERE u.id=j.confirmed_by AND u.status='active' AND (SELECT COUNT(DISTINCT p.name) FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=u.id AND p.name IN ('sales.view','sales.import'))=2)
    AND (NOT EXISTS (SELECT 1 FROM sales_intake_orders i WHERE i.import_job_id=j.id AND i.status IN ('QUEUED','PROCESSING')) OR EXISTS (SELECT 1 FROM sales_intake_orders i WHERE i.import_job_id=j.id AND i.status IN ('QUEUED','PROCESSING') AND (i.next_attempt_at IS NULL OR i.next_attempt_at<=?))) ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE`,[first.nowMs,first.nowMs]);
   if(!job)return null;await requireSalesImportActorById(tx,Number(job.confirmed_by));const fresh=await this.#lease(tx,signal,first),token=randomUUID();
   const [row]=await tx.execute("UPDATE sales_import_jobs SET status='PROCESSING',lease_owner=?,lease_until=?,processing_started_at=COALESCE(processing_started_at,?),updated_at=?,version=version+1 WHERE id=? AND status=? AND (lease_until IS NULL OR lease_until<=?)",[token,fresh.nowMs+this.config.confirmationLeaseMs,fresh.nowMs,fresh.nowMs,job.id,job.status,fresh.nowMs]);if(row.affectedRows!==1)throw salesError("CONCURRENT_OPERATION");return {id:Number(job.id),token,actorId:Number(job.confirmed_by)};
  },{signal,timeoutMs:this.config.transactionTimeoutMs});
 }
 async #children(claim,signal,limit){
  if(limit<1)return [];
  return this.#transaction(claim,signal,async(tx,_job,_actor,nowMs)=>{
   const [rows]=await tx.query(`SELECT id,processing_event_id,attempt_count FROM sales_intake_orders WHERE ${claim?"import_job_id=?":"source_type='CHANNEL'"} AND status IN ('QUEUED','PROCESSING') AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY id LIMIT ? FOR UPDATE`,[...(claim?[claim.id]:[]),nowMs,limit]);
   for(const row of rows)await tx.execute("UPDATE sales_intake_orders SET status='PROCESSING',attempt_count=attempt_count+1,last_attempt_at=?,next_attempt_at=NULL,updated_at=? WHERE id=? AND processing_event_id=?",[nowMs,nowMs,row.id,row.processing_event_id]);return rows;
  });
 }
 async #defer(claim,row,signal){
  return this.#transaction(claim,signal,async(tx,_job,_actor,nowMs)=>{
   const [[current]]=await tx.query("SELECT status,processing_event_id,attempt_count FROM sales_intake_orders WHERE id=? FOR UPDATE",[row.id]);if(!current||current.processing_event_id!==row.processing_event_id)throw salesError("SALES_EVENT_CONFLICT");if(terminal.includes(current.status))return current.status;
   if(current.status!=="PROCESSING")throw salesError("SALES_STATE_CONFLICT");const delay=Math.min(300000,2000*2**Math.min(Number(current.attempt_count)-1,8));await tx.execute("UPDATE sales_intake_orders SET next_attempt_at=?,updated_at=? WHERE id=? AND processing_event_id=? AND status='PROCESSING'",[nowMs+delay,nowMs,row.id,row.processing_event_id]);return "DEFERRED";
  });
 }
 async #counts(claim,signal){
  return this.#transaction(claim,signal,async(tx,job,_actor)=>{
   const [[counts]]=await tx.query(`SELECT COUNT(*) AS source_count,COALESCE(SUM(i.status='INVALID'),0) AS invalid_count,COALESCE(SUM(i.status='DUPLICATE'),0) AS duplicate_count,COALESCE(SUM(i.status='SUCCEEDED'),0) AS success_count,COALESCE(SUM(i.status='FAILED'),0) AS failed_count,
    COALESCE(SUM(i.status NOT IN ('INVALID','DUPLICATE','SUCCEEDED','FAILED')),0) AS pending,COALESCE(SUM(JSON_LENGTH(COALESCE(o.result_summary,i.safe_payload),'$.warnings')>0),0) AS warning_count
    FROM sales_intake_orders i LEFT JOIN sales_operation_requests o ON o.event_id=i.processing_event_id AND o.command_type='PROCESS_INTAKE' AND o.target_type='INTAKE_ORDER' AND o.target_id=i.id AND o.status='SUCCEEDED' WHERE i.import_job_id=?`,[claim.id]);
   if(Number(counts.source_count)!==Number(job.source_order_count))throw salesError("SALES_DEPENDENCY_UNAVAILABLE");return {job,counts:Object.fromEntries(Object.entries(counts).map(([key,value])=>[key,Number(value)]))};
  });
 }
 async #publish(claim,job,signal){
  if(!/^SI-\d{6}-\d{6}$/u.test(job.batch_number)||job.source_file_path!==`${job.batch_number}/source.csv`)throw salesError("SALES_IMPORT_FILE_INVALID");
  const root=path.resolve(this.root),directory=path.join(root,job.batch_number),destination=path.join(directory,"result.csv"),temporary=path.join(directory,`result-${claim.token}.tmp`);
  const privateFile=stat=>stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o600&&(!process.getuid||stat.uid===process.getuid());
  const privateDirectories=async()=>{for(const entry of [root,directory]){const stat=await lstat(entry);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o700||(process.getuid&&stat.uid!==process.getuid()))throw salesError("SALES_IMPORT_FILE_INVALID");}};await privateDirectories();
  try{const existing=await lstat(destination);if(!privateFile(existing))throw salesError("SALES_IMPORT_FILE_INVALID");}catch(error){if(error.code!=="ENOENT")throw error;}
  // A dead claimant cannot run finally; reclaim only private result temporaries after obtaining the new Job claim.
  for await(const entry of await opendir(directory)){signal.throwIfAborted();if(!/^result-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/u.test(entry.name))continue;const file=path.join(directory,entry.name);if(!privateFile(await lstat(file)))throw salesError("SALES_IMPORT_FILE_INVALID");await unlink(file);}
  let handle,created=false;
  try{handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;await handle.writeFile(createSalesImportResultStream({database:this.database,id:claim.id,signal}),{signal});await handle.sync();await handle.close();handle=null;signal.throwIfAborted();await this.#transaction(claim,signal,async()=>{});await privateDirectories();await rename(temporary,destination);const folder=await open(directory,constants.O_RDONLY|constants.O_NOFOLLOW);try{await folder.sync();}finally{await folder.close();}return `${job.batch_number}/result.csv`;}
  finally{await handle?.close();if(created)await unlink(temporary).catch(error=>{if(error.code!=="ENOENT")throw error;});}
 }
 async #finish(claim,signal){
  const {job,counts}=await this.#counts(claim,signal);let resultFile="";if(!counts.pending)resultFile=await this.#publish(claim,job,signal);
  await this.#transaction(claim,signal,async(tx,current,actor,nowMs)=>{
   const status=counts.pending?"PROCESSING":counts.failed_count+counts.invalid_count>0?(counts.success_count+counts.duplicate_count>0?"PARTIAL_SUCCESS":"FAILED"):"COMPLETED";
   const [written]=await tx.execute("UPDATE sales_import_jobs SET valid_count=?,success_count=?,failed_count=?,invalid_count=?,duplicate_count=?,warning_count=?,status=?,result_file_path=?,completed_at=?,lease_owner=IF(?=0,NULL,lease_owner),lease_until=IF(?=0,NULL,lease_until),version=version+1,updated_at=? WHERE id=? AND status='PROCESSING' AND lease_owner=?",[counts.source_count-counts.invalid_count-counts.duplicate_count,counts.success_count,counts.failed_count,counts.invalid_count,counts.duplicate_count,counts.warning_count,status,resultFile,counts.pending?null:nowMs,counts.pending,counts.pending,nowMs,claim.id,claim.token]);if(written.affectedRows!==1)throw salesError("CONCURRENT_OPERATION");
   if(!counts.pending)await this.audit.record(tx,{actor,action:"sales_import.completed",targetId:claim.id,targetNumber:current.batch_number,eventId:randomUUID(),nowMs,details:{version:Number(current.version)+1,sourceOrderCount:counts.source_count,successCount:counts.success_count,failedCount:counts.failed_count,invalidCount:counts.invalid_count,duplicateCount:counts.duplicate_count}});
  });
 }
 async runBatch({signal}={}){
  const principal=await this.authorize?.();if(!principal||principal.signal!==signal||signal?.aborted!==false)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
  // ponytail: one CSV Job per tick bounds claim ownership; split quotas if sustained Channel traffic needs guaranteed latency.
  const claim=await this.#claimJob(signal),result={processed:0,succeeded:0,failed:0,duplicate:0,deferred:0};
  try{
   const csv=claim?await this.#children(claim,signal,this.config.importWorkerBatchSize):[],channel=await this.#children(null,signal,this.config.importWorkerBatchSize-csv.length);
   for(const [row,owner] of [...csv.map(row=>[row,claim]),...channel.map(row=>[row,null])]){
    signal.throwIfAborted();result.processed++;let status;
    try{status=(await this.intake.process({intakeOrderId:Number(row.id),...(owner?{jobClaimToken:owner.token}:{}),signal})).status;}
    catch(error){signal.throwIfAborted();if(error.code==="TRANSACTION_OUTCOME_UNKNOWN")try{status=(await this.intake.process({intakeOrderId:Number(row.id),...(owner?{jobClaimToken:owner.token}:{}),signal})).status;}catch{signal.throwIfAborted();}if(!status)status=await this.#defer(owner,row,signal);}
    const counter={SUCCEEDED:"succeeded",FAILED:"failed",DUPLICATE:"duplicate",DEFERRED:"deferred"}[status];if(!counter)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");result[counter]++;
    if(owner)await this.#transaction(owner,signal,async()=>{});
   }
   if(claim)await this.#finish(claim,signal);return result;
  }finally{if(claim&&!signal.aborted)await this.database.withTransaction(async tx=>{const {nowMs}=await this.#lease(tx,signal);await tx.execute("UPDATE sales_import_jobs SET lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='PROCESSING' AND lease_owner=?",[nowMs,claim.id,claim.token]);},{signal,timeoutMs:this.config.transactionTimeoutMs});}
 }
}
