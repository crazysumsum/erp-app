import {createHash,randomUUID} from "node:crypto";
import {SalesArchiveLockService} from "./SalesArchiveLockService.js";
import {FulfillmentArchiveLockService} from "../fulfillment/FulfillmentArchiveLockService.js";
import defaults from "../../../config/sales.js";

const fail=code=>{throw Object.assign(new Error(code),{code});};
const statuses=["CANCELLED","CLOSED","COMPLETED"];
const terminalSkips=new Set(["ORDER_NOT_FINALIZED","RETENTION_NOT_MET","BACKORDER_OPEN","RESERVATION_OPEN","OPERATION_IN_PROGRESS","FULFILLMENT_OPEN","FULFILLMENT_ARCHIVE_NOT_ELIGIBLE"]);
const emptyHash=createHash("sha256").digest("hex");
const codeOf=error=>error?.code==="DATABASE_TRANSACTION_INDETERMINATE"?error.code:error?.cause?.code??error?.code;
const tuple=row=>({status:row.status,at:String(row.last_business_updated_at),id:String(row.id)});
function validTuple(value){return value&&Object.keys(value).sort().join(",")==="at,id,status"&&statuses.includes(value.status)&&typeof value.at==="string"&&/^(0|[1-9][0-9]{0,15})$/u.test(value.at)&&BigInt(value.at)<=9007199254740991n&&typeof value.id==="string"&&/^[1-9][0-9]{0,15}$/u.test(value.id)&&BigInt(value.id)<=9007199254740991n;}
const compare=(a,b)=>a.status.localeCompare(b.status,"en")||(BigInt(a.at)<BigInt(b.at)?-1:BigInt(a.at)>BigInt(b.at)?1:BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
export function salesArchiveWindow(nowMs,config={}){
 if(!Number.isSafeInteger(nowMs)||nowMs<0)throw new TypeError("Invalid Archive clock");
 const hkt=new Date(nowMs+28800000),year=hkt.getUTCFullYear(),month=hkt.getUTCMonth(),day=hkt.getUTCDate(),hour=hkt.getUTCHours(),cutoff=new Date(hkt);
 cutoff.setUTCDate(1);cutoff.setUTCFullYear(year-2);const last=new Date(Date.UTC(year-2,month+1,0)).getUTCDate();cutoff.setUTCDate(Math.min(day,last));
 return {periodKey:`${year}${String(month+1).padStart(2,"0")}`,inWindow:day===(config.archiveDayOfMonth??2)&&hour===(config.archiveHourHkt??2),cutoffMs:cutoff.getTime()-28800000};
}
// Internal job coordinator. Its instance and fixed executeLockedArchive callback remain private in SalesJobs.
export class SalesArchiveBatchService{
 #authorizeJob;#executeLockedArchive;
 constructor({database,time,config,authorizeJob,executeLockedArchive}={}){this.database=database;this.time=time??{nowMs:()=>Date.now()};this.config=config??defaults;this.#authorizeJob=authorizeJob;this.#executeLockedArchive=executeLockedArchive;this.salesLocks=new SalesArchiveLockService({database});this.ownerLocks=new FulfillmentArchiveLockService({database});}
 async #principal(signal){const p=await this.#authorizeJob?.();if(!p||p.signal!==signal||signal?.aborted!==false||typeof p.leaseOwner!=="string"||!p.leaseOwner)fail("SALES_ARCHIVE_FORBIDDEN");return p;}
 #transaction(signal,work){const context=this.database.context;if(!context?.storage?.run)fail("SALES_ARCHIVE_FORBIDDEN");return context.storage.run({databaseTransaction:null,auth:null,signal,startedAt:this.time.nowMs()},()=>this.database.withTransaction(work,{signal,timeoutMs:this.config.transactionTimeoutMs,isolationLevel:"REPEATABLE READ"}));}
 async #lease(tx,signal){const principal=await this.#principal(signal),[[lease]]=await tx.query("SELECT owner,expires_at FROM fr_job_leases WHERE job_name='sales.archive' FOR UPDATE"),[[clock]]=await tx.query("SELECT UNIX_TIMESTAMP() AS now,CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms");if(!lease||lease.owner!==principal.leaseOwner||Number(lease.expires_at)<=Number(clock.now))fail("SALES_ARCHIVE_FORBIDDEN");return {principal,nowMs:Number(clock.now_ms)};}
 #summary(row){
  if(row.checksum_summary===null){if(["candidate_count","archived_count","skipped_count","failed_count","last_scanned_order_id"].some(k=>Number(row[k])!==0))fail("ARCHIVE_DATA_CONFLICT");return {version:"1",cursor:null,pending:[],salesTableCounts:{},fulfillmentTableCounts:{},amountTotal:"0",amountHash:emptyHash,manifestHash:emptyHash};}
  const s=typeof row.checksum_summary==="string"?JSON.parse(row.checksum_summary):structuredClone(row.checksum_summary);
  if(!s||Object.keys(s).sort().join(",")!=="amountHash,amountTotal,cursor,fulfillmentTableCounts,manifestHash,pending,salesTableCounts,version"||s.version!=="1"||s.cursor!==null&&!validTuple(s.cursor)||!Array.isArray(s.pending)||s.pending.length>500||new Set(s.pending.map(p=>p.candidate?.id)).size!==s.pending.length||s.pending.some(p=>Object.keys(p).sort().join(",")!=="candidate,code,outcome"||!validTuple(p.candidate)||!["FAILED","SKIPPED"].includes(p.outcome)||typeof p.code!=="string"||!/^[A-Z_]{1,80}$/u.test(p.code))||typeof s.amountTotal!=="string"||!/^(0|[1-9][0-9]*)$/u.test(s.amountTotal)||[s.amountHash,s.manifestHash].some(h=>typeof h!=="string"||!/^[0-9a-f]{64}$/u.test(h))||[s.salesTableCounts,s.fulfillmentTableCounts].some(c=>!c||typeof c!=="object"||Array.isArray(c)||Object.values(c).some(n=>!Number.isSafeInteger(n)||n<0)))fail("ARCHIVE_DATA_CONFLICT");return s;
 }
 async #batch(tx,id,token,signal){const {principal,nowMs}=await this.#lease(tx,signal),[[row]]=await tx.query("SELECT * FROM sales_archive_batches WHERE id=? FOR UPDATE",[id]);if(!row||!["RUNNING","PARTIAL"].includes(row.status)||row.lease_owner!==token||Number(row.lease_until)<=nowMs)fail("SALES_ARCHIVE_FORBIDDEN");return {row,summary:this.#summary(row),principal,nowMs};}
 async #claim(signal){return this.#transaction(signal,async tx=>{
  const {nowMs}=await this.#lease(tx,signal),window=salesArchiveWindow(this.time.nowMs(),this.config),[[unfinished]]=await tx.query("SELECT * FROM sales_archive_batches WHERE status IN ('RUNNING','PARTIAL','FAILED') AND completed_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE");let row=unfinished;
  if(!row){if(!window.inWindow)return null;const [[existing]]=await tx.query("SELECT id FROM sales_archive_batches WHERE period_key=? FOR UPDATE",[window.periodKey]);if(existing)return null;const [inserted]=await tx.execute("INSERT INTO sales_archive_batches(batch_number,period_key,cutoff_at,status,started_at,updated_at) VALUES (?,?,?,'RUNNING',?,?)",[`SA-${window.periodKey}-000001`,window.periodKey,window.cutoffMs,nowMs,nowMs]);[[row]]=await tx.query("SELECT * FROM sales_archive_batches WHERE id=? FOR UPDATE",[String(inserted.insertId)]);}
  if(row.lease_owner!==null&&Number(row.lease_until)>nowMs)return null;const token=randomUUID(),summary=this.#summary(row);await tx.execute("UPDATE sales_archive_batches SET status='RUNNING',lease_owner=?,lease_until=?,checksum_summary=?,updated_at=? WHERE id=?",[token,nowMs+630000,JSON.stringify(summary),nowMs,String(row.id)]);return {id:String(row.id),token};
 });}
 async #record(tx,batch,candidate,outcome,code,result){
  const s=batch.summary,pending=s.pending.findIndex(p=>p.candidate.id===candidate.id),seen=s.cursor&&compare(candidate,s.cursor)<=0;
  if(pending<0&&seen){if(outcome!=="ARCHIVED")fail("ARCHIVE_DATA_CONFLICT");return;}
  const delta={candidate:pending<0?1:0,archived:0,skipped:0,failed:0};if(pending>=0){delta[s.pending[pending].outcome.toLowerCase()]--;s.pending.splice(pending,1);}else s.cursor=candidate;
  delta[outcome.toLowerCase()]++;
  if(outcome==="FAILED"||code==="OPEN_MATTER_UNKNOWN"){if(s.pending.length>=500)fail("ARCHIVE_DATA_CONFLICT");s.pending.push({candidate,code,outcome});}
  if(outcome==="ARCHIVED"){
   for(const [key,counts]of [["salesTableCounts",result.tableCounts],["fulfillmentTableCounts",result.fulfillmentTableCounts]])for(const [table,count]of Object.entries(counts)){s[key][table]=(s[key][table]??0)+count;if(!Number.isSafeInteger(s[key][table]))fail("ARCHIVE_DATA_CONFLICT");}
   if(typeof result.totalAmount!=="string"||!/^\d+\.\d{4}$/u.test(result.totalAmount))fail("ARCHIVE_DATA_CONFLICT");s.amountTotal=(BigInt(s.amountTotal)+BigInt(result.totalAmount.replace(".",""))).toString();s.amountHash=createHash("sha256").update(`${s.amountHash}:${candidate.id}:${result.totalAmount}\n`).digest("hex");s.manifestHash=createHash("sha256").update(`${s.manifestHash}:${candidate.id}:${JSON.stringify(result.hashSummary)}:${JSON.stringify(result.fulfillmentHashSummary)}\n`).digest("hex");
  }
  const [updated]=await tx.execute("UPDATE sales_archive_batches SET candidate_count=candidate_count+?,archived_count=archived_count+?,skipped_count=skipped_count+?,failed_count=failed_count+?,last_scanned_order_id=?,checksum_summary=?,updated_at=? WHERE id=? AND lease_owner=?",[delta.candidate,delta.archived,delta.skipped,delta.failed,s.cursor?.id??"0",JSON.stringify(s),batch.nowMs,String(batch.row.id),batch.row.lease_owner]);if(Number(updated.affectedRows)!==1)fail("SALES_ARCHIVE_FORBIDDEN");
 }
 async #order(id,token,candidate,signal,{reconcile=false}={}){
  const hints=await this.ownerLocks.discoverOrder(candidate.id),routing=await this.salesLocks.discoverOrderRouting(candidate.id);
  try{return await this.#transaction(signal,async tx=>{
   const batch=await this.#batch(tx,id,token,signal),owner=await this.ownerLocks.lockOrderOperationsInTransaction(tx,candidate.id),sales=await this.salesLocks.lockOrderOperationsInTransaction(tx,{orderId:candidate.id,shipmentIds:hints.shipments.map(s=>s.id)});
   if(owner.hasInProgress||sales.hasInProgress)fail("OPERATION_IN_PROGRESS");
   await this.salesLocks.lockOrderRoutingInTransaction(tx,routing);
   const [[active]]=await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[candidate.id]);if(active){const locked=await this.salesLocks.lockOrderRowsInTransaction(tx,candidate.id);this.salesLocks.assertOrderRouting(locked.header,routing);}
   if(JSON.stringify(await this.ownerLocks.readOrderMembershipInTransaction(tx,candidate.id))!==JSON.stringify(hints))fail("ARCHIVE_MEMBERSHIP_CHANGED");
   // Fresh observation clock follows all possible operation/routing/root lock waits. Historical mirror time is metadata only.
   const [[clock]]=await tx.query("SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms"),readAtMs=Number(clock.now_ms),cutoffMs=Number(batch.row.cutoff_at);
   const metadata=[...await this.salesLocks.readOrderMirrorMetadataInTransaction(tx,candidate.id),...await this.ownerLocks.readOrderMirrorMetadataInTransaction(tx,candidate.id)],times=new Set(metadata.map(row=>row.archivedAtMs));
   if(!Number.isSafeInteger(readAtMs)||readAtMs<cutoffMs||times.size>1||metadata.some(row=>row.archiveBatchId!==id||!Number.isSafeInteger(row.archivedAtMs)||row.archivedAtMs<cutoffMs||row.archivedAtMs>readAtMs))fail("ARCHIVE_DATA_CONFLICT");
   const scope=Object.freeze({orderId:candidate.id,archiveBatchId:id,cutoffMs,readAtMs,archivedAtMs:metadata.length?metadata[0].archivedAtMs:readAtMs,leaseOwner:batch.principal.leaseOwner,leaseToken:token,signal});
   const result=await this.#executeLockedArchive(tx,scope);await this.#record(tx,batch,candidate,"ARCHIVED","",result);return {outcome:"ARCHIVED",reconciled:reconcile};
  });}catch(error){
   if(codeOf(error)==="DATABASE_TRANSACTION_INDETERMINATE"){if(reconcile)throw error;return this.#order(id,token,candidate,signal,{reconcile:true});}
   signal.throwIfAborted();if(codeOf(error)==="SALES_ARCHIVE_FORBIDDEN")throw error;
   // This metadata transaction follows a settled rollback. Never label a durable manifest as a failed order.
   return this.#transaction(signal,async tx=>{const batch=await this.#batch(tx,id,token,signal),[[manifest]]=await tx.query("SELECT id FROM sales_archive_order_manifests WHERE sales_order_id=? FOR UPDATE",[candidate.id]);if(manifest)throw error;const raw=codeOf(error),code=raw==="OPEN_MATTER_UNKNOWN"?raw:terminalSkips.has(raw)?raw:raw==="ARCHIVE_DATA_CONFLICT"?raw:"SALES_DEPENDENCY_UNAVAILABLE",outcome=terminalSkips.has(raw)||raw==="OPEN_MATTER_UNKNOWN"?"SKIPPED":"FAILED";await this.#record(tx,batch,candidate,outcome,code);return {outcome,code};});
  }
 }
 async runBatch({signal}={}){
  await this.#principal(signal);if(this.database.context?.get()?.databaseTransaction)fail("SALES_ARCHIVE_FORBIDDEN");const claim=await this.#claim(signal);if(!claim)return {processed:0,archived:0,skipped:0,failed:0};
  const stats={processed:0,archived:0,skipped:0,failed:0},limit=Math.min(500,this.config.archiveBatchSize);let exhausted=false;
  try{
   const initial=await this.#transaction(signal,tx=>this.#batch(tx,claim.id,claim.token,signal));
   for(const item of initial.summary.pending.slice(0,limit)){signal.throwIfAborted();const result=await this.#order(claim.id,claim.token,item.candidate,signal);stats.processed++;stats[result.outcome.toLowerCase()]++;if(result.code==="ARCHIVE_DATA_CONFLICT")return {...stats,stopped:true};}
   while(stats.processed<limit){
    signal.throwIfAborted();const current=await this.#transaction(signal,tx=>this.#batch(tx,claim.id,claim.token,signal));if(current.summary.pending.length>=500)break;const cursor=current.summary.cursor,remaining=Math.min(limit-stats.processed,500-current.summary.pending.length);
    const [rows]=await this.database.query(`SELECT id,status,last_business_updated_at FROM sales_orders FORCE INDEX (idx_sales_orders_archive_eligibility) WHERE status IN ('CANCELLED','CLOSED','COMPLETED') AND last_business_updated_at<?${cursor?" AND (status>? OR (status=? AND (last_business_updated_at>? OR (last_business_updated_at=? AND id>?))))":""} ORDER BY status,last_business_updated_at,id LIMIT ${remaining}`,[Number(current.row.cutoff_at),...(cursor?[cursor.status,cursor.status,cursor.at,cursor.at,cursor.id]:[])]);
    if(!rows.length){exhausted=true;break;}
    for(const row of rows){const candidate=tuple(row);if(!validTuple(candidate))fail("ARCHIVE_DATA_CONFLICT");const result=await this.#order(claim.id,claim.token,candidate,signal);stats.processed++;stats[result.outcome.toLowerCase()]++;if(result.code==="ARCHIVE_DATA_CONFLICT")return {...stats,stopped:true};}
   }
   return stats;
  }finally{
   // Aborted jobs retain their bounded lease for safe expiry/takeover; never create an unsignalled transaction to defeat cancellation.
   if(!signal.aborted)await this.#transaction(signal,async tx=>{const batch=await this.#batch(tx,claim.id,claim.token,signal),done=exhausted&&batch.summary.pending.length===0;await tx.execute("UPDATE sales_archive_batches SET status=?,completed_at=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_owner=?",[done?"COMPLETED":batch.summary.pending.length?"PARTIAL":"RUNNING",done?batch.nowMs:null,batch.nowMs,claim.id,claim.token]);});
  }
 }
}
