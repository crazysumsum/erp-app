import path from "node:path";
import {constants} from "node:fs";
import {randomUUID} from "node:crypto";
import {SalesAuditService} from "../../../modules/sales/SalesAuditService.js";
import {lstat,unlink,opendir,rmdir,open} from "node:fs/promises";
import {BaseService} from "../../../framework/services/BaseService.js";
import {prepareDiskTempDirectory} from "../../../framework/upload/normalizeUploadConfig.js";
const name="sales.fileRetention",day=86400000,terminal="('COMPLETED','PARTIAL_SUCCESS','FAILED','CANCELLED')";
const privateEntry=(stat,directory)=>!stat.isSymbolicLink()&&(directory?stat.isDirectory():stat.isFile())&&(stat.mode&0o777)===(directory?0o700:0o600)&&(!process.getuid||stat.uid===process.getuid());
export class SalesFileRetentionJob extends BaseService {
 static service=Object.freeze({name:"job.salesFileRetention",lifecycle:"singleton",dependencies:["scheduler","mysqldatabase","time","logging"],eager:true});
 static jobs=Object.freeze([{name,method:"run",scope:"cluster",intervalMs:day,timeoutMs:30000}]);
 constructor({config,services,options={}}={}){super({config,services,options});this.scheduler=services.require("scheduler");this.database=services.require("mysqldatabase");this.logger=services.require("logging").logger;this.root=options.root==null?prepareDiskTempDirectory("storage/sales-imports","Sales retention"):path.resolve(options.root);this.exportRoot=options.exportRoot==null?prepareDiskTempDirectory("storage/sales-exports","Sales export retention"):path.resolve(options.exportRoot);this.exportDays=config?.sales?.exportFileRetentionDays??7;this.audit=new SalesAuditService();this.fileDays=config?.sales?.importFileRetentionDays??90;this.payloadDays=config?.sales?.intakePayloadRetentionDays??90;}
 async initialize(){this.scheduler.register(this);}
 #active(signal){const scheduler=this.scheduler,job=scheduler.jobs?.get(name);if(!scheduler.started||scheduler.stopped||scheduler.schedulerConfig?.enabled!==true||job?.serviceName!=="job.salesFileRetention"||job.method!=="run"||job.scope!=="cluster"||job.enabled!==true||scheduler.running?.get(name)?.controller.signal!==signal||signal?.aborted!==false)throw Error("Sales retention worker unavailable");return scheduler.owner;}
 async #lease(tx,signal,owner){if(this.#active(signal)!==owner)throw Error("Sales retention worker unavailable");const [[lease]]=await tx.query("SELECT owner,expires_at FROM fr_job_leases WHERE job_name='sales.fileRetention' FOR UPDATE"),[[clock]]=await tx.query("SELECT UNIX_TIMESTAMP() AS now,CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms");if(this.#active(signal)!==owner||lease?.owner!==owner||![Number(lease?.expires_at),Number(clock?.now),Number(clock?.now_ms)].every(Number.isSafeInteger)||Number(lease.expires_at)<=Number(clock.now))throw Error("Sales retention lease unavailable");return Number(clock.now_ms);}
 async #transaction(signal,work){const owner=this.#active(signal);return this.database.withTransaction(async tx=>{const now=await this.#lease(tx,signal,owner),result=await work(tx,now);await this.#lease(tx,signal,owner);return result;},{signal});}
 async #remove(batch,file){if(!/^SI-\d{6}-\d{6}$/u.test(batch)||file!==`${batch}/source.csv`&&file!==`${batch}/result.csv`)throw Error("Sales retention path invalid");
  try{if(!privateEntry(await lstat(this.root),true))throw Error("Sales retention directory invalid");const directory=path.join(this.root,batch);if(!privateEntry(await lstat(directory),true))throw Error("Sales retention directory invalid");const target=path.join(this.root,file);if(!privateEntry(await lstat(target),false))throw Error("Sales retention file invalid");await unlink(target);}catch(error){if(error.code!=="ENOENT")throw error;}
 }
 async #removeExport(job,signal){
  const id=Number(job.id),token="[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
  if(!Number.isSafeInteger(id)||id<1||job.file_path&&!new RegExp(`^${id}/${token}\\.csv$`,"u").test(job.file_path))throw Error("Sales Export retention path invalid");
  const directory=path.join(this.exportRoot,String(id));try{
   if(!privateEntry(await lstat(this.exportRoot),true)||!privateEntry(await lstat(directory),true))throw Error("Sales Export retention directory invalid");
   for await(const entry of await opendir(directory)){signal.throwIfAborted();if(!new RegExp(`^${token}\\.(csv|tmp)$`,"u").test(entry.name))throw Error("Sales Export retention attempt invalid");const file=path.join(directory,entry.name);try{if(!privateEntry(await lstat(file),false))throw Error("Sales Export retention file invalid");await unlink(file);}catch(error){if(error.code!=="ENOENT")throw error;}}
   signal.throwIfAborted();const folder=await open(directory,constants.O_RDONLY|constants.O_NOFOLLOW);try{await folder.sync();}finally{await folder.close();}await rmdir(directory);const root=await open(this.exportRoot,constants.O_RDONLY|constants.O_NOFOLLOW);try{await root.sync();}finally{await root.close();}
  }catch(error){if(error.code!=="ENOENT")throw error;}
 }

 async run(signal){
  const counts={filesPurged:0,exportsPurged:0,payloadsPurged:0,failed:0};
  // ponytail: each daily run clears at most50 batches/500 payloads; increase only if measured expiry backlog needs it.
  const jobs=await this.#transaction(signal,async(tx,now)=>(await tx.query(`SELECT id FROM sales_import_jobs WHERE status IN ${terminal} AND completed_at<=? AND files_purged_at IS NULL ORDER BY id LIMIT 50`,[now-this.fileDays*day]))[0]);
  for(const candidate of jobs){signal.throwIfAborted();try{const purged=await this.#transaction(signal,async(tx,now)=>{const [[job]]=await tx.query(`SELECT id,batch_number,source_file_path,result_file_path,status,completed_at FROM sales_import_jobs WHERE id=? AND status IN ${terminal} AND completed_at<=? AND files_purged_at IS NULL FOR UPDATE`,[candidate.id,now-this.fileDays*day]);if(!job)return;for(const file of [job.source_file_path,job.result_file_path]){signal.throwIfAborted();if(file)await this.#remove(job.batch_number,file);}signal.throwIfAborted();await tx.execute("UPDATE sales_import_jobs SET source_file_path='',result_file_path='',files_purged_at=?,version=version+1,updated_at=? WHERE id=?",[now,now,job.id]);return true;});if(purged)counts.filesPurged++;}catch{signal.throwIfAborted();counts.failed++;}}

  const exportWhere="scope IN ('ACTIVE','ARCHIVE') AND ((status='COMPLETED' AND expires_at<=?) OR (status='FAILED' AND completed_at<=? AND expires_at IS NULL))",exports=await this.#transaction(signal,async(tx,now)=>(await tx.query(`SELECT id FROM sales_export_jobs WHERE ${exportWhere} ORDER BY id LIMIT 50`,[now,now-this.exportDays*day]))[0]);
  for(const candidate of exports){signal.throwIfAborted();try{const purged=await this.#transaction(signal,async(tx,now)=>{const [[job]]=await tx.query(`SELECT * FROM sales_export_jobs WHERE id=? AND ${exportWhere} FOR UPDATE`,[candidate.id,now,now-this.exportDays*day]);if(!job)return;
   await this.audit.record(tx,{actor:{id:null,username:"sales.fileRetention"},action:"sales_export.expired",targetId:Number(job.id),targetNumber:String(job.id),eventId:randomUUID(),nowMs:now,details:{scope:job.scope,filtersHash:job.filters_hash,rowCount:Number(job.row_count)}});
   await this.#removeExport(job,signal);signal.throwIfAborted();await tx.execute("UPDATE sales_export_jobs SET status=IF(status='COMPLETED','EXPIRED',status),file_path='',expires_at=COALESCE(expires_at,?) WHERE id=?",[now,job.id]);return true;});if(purged)counts.exportsPurged++;}catch{signal.throwIfAborted();counts.failed++;}}
  counts.payloadsPurged=await this.#transaction(signal,async(tx,now)=>{const [rows]=await tx.query(`SELECT i.id FROM sales_intake_orders i LEFT JOIN sales_import_jobs j ON j.id=i.import_job_id WHERE i.safe_payload IS NOT NULL AND i.payload_purged_at IS NULL AND ((i.status IN ('INVALID','DUPLICATE','SUCCEEDED','FAILED') AND i.completed_at<=?) OR (j.status IN ${terminal} AND j.completed_at<=?)) ORDER BY i.id LIMIT 500 FOR UPDATE`,[now-this.payloadDays*day,now-this.payloadDays*day]);for(const row of rows){signal.throwIfAborted();await tx.execute("UPDATE sales_intake_orders SET safe_payload=NULL,payload_purged_at=? WHERE id=?",[now,row.id]);}return rows.length;});
  await this.logger.info("sales.file_retention_completed","Sales file retention batch completed",counts);signal.throwIfAborted();if(counts.failed)throw Error("Sales file retention incomplete");return counts;
 }
}
