import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {salesArchiveWindow} from "../../../src/modules/sales/SalesArchiveBatchService.js";
import {SALES_ARCHIVE_COLUMNS,hashSalesArchiveRow} from "../../../src/modules/sales/salesArchiveHash.js";
import {FULFILLMENT_ARCHIVE_CONTRACTS,hashFulfillmentArchiveRow} from "../../../src/modules/fulfillment/fulfillmentArchiveSchema.js";
import {quantiles} from "./http.js";

async function scan(c,table,{where="1=1",values=[],columns="*",verify}={}){
 assert.match(table,/^[a-z_]+$/u);const digest=createHash("sha256");let after="0",count=0;
 for(;;){
  const [rows]=await c.db.query(`SELECT ${columns} FROM ${table} WHERE (${where}) AND id>? ORDER BY id LIMIT 500`,[...values,after]);
  if(!rows.length)break;
  for(const row of rows){assert.ok(BigInt(row.id)>BigInt(after));const hash=verify?verify(row):createHash("sha256").update(JSON.stringify(row)).digest("hex");digest.update(`${row.id}:${hash}\n`);after=String(row.id);count++;}
 }
 return {count,hash:digest.digest("hex")};
}
async function contracts(c){
 const [columns]=await c.db.query("SELECT TABLE_NAME AS table_name,COLUMN_NAME AS name,DATA_TYPE AS type FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION"),types=new Map(columns.map(r=>[r.table_name+":"+r.name,r.type]));
 return [...Object.entries(SALES_ARCHIVE_COLUMNS).map(([table,names])=>({table,names,hash:hashSalesArchiveRow})),...FULFILLMENT_ARCHIVE_CONTRACTS.map(r=>({table:r.table,names:Object.keys(r.columns),hash:hashFulfillmentArchiveRow}))].map(r=>({...r,projection:r.names.map(name=>types.get(r.table+":"+name)==="date"?`DATE_FORMAT(${name},'%Y-%m-%d') AS ${name}`:name).join(",")}));
}
async function inventoryState(c){
 const [tables]=await c.db.query("SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND LEFT(TABLE_NAME,10)='inventory_' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"),result={};assert.ok(tables.length>0);
 for(const {name}of tables){
  assert.match(name,/^[a-z_]+$/u);const [keys]=await c.db.query(`SHOW INDEX FROM ${name} WHERE Key_name='PRIMARY'`);assert.ok(keys.length>0);const primary=keys.sort((a,b)=>a.Seq_in_index-b.Seq_in_index).map(r=>r.Column_name);assert.ok(primary.every(n=>/^[a-z_]+$/u.test(n)));
  let cursor=null,count=0;const hash=createHash("sha256");
  for(;;){const args=cursor??[],suffix=cursor?` WHERE (${primary.join(",")})>(${primary.map(()=>"?").join(",")})`:"",[rows]=await c.db.query(`SELECT * FROM ${name}${suffix} ORDER BY ${primary.join(",")} LIMIT 500`,args);if(!rows.length)break;for(const row of rows){hash.update(JSON.stringify(row)+"\n");count++;}cursor=primary.map(key=>rows.at(-1)[key]);}
  result[name]={count,hash:hash.digest("hex")};
 }
 return result;
}

function readers(c){
 const samples=[],failures=[];let stopped=false;
 const work=Array.from({length:10},(_,index)=>(async()=>{
  while(!stopped){
   try{const result=await c.http(c.actors[index],"/api/v1/sales-orders?customerId="+c.binding.customers[30+index]+"&pageSize=20");assert.ok(c.successful(result).total>0);samples.push({actor:index,ms:result.sample.ms,atMs:Date.now()});}
   catch(error){failures.push({actor:index,error:error.code??error.name,message:error.message});stopped=true;}
   if(!stopped)await delay(10000);
  }
 })());
 return {samples,failures,async close(){stopped=true;await Promise.all(work);},check(){assert.equal(failures.length,0,JSON.stringify(failures));}};
}
async function assertBatch(c,batchId){const [[batch]]=await c.db.query("SELECT * FROM sales_archive_batches WHERE id=?",[batchId]);assert.equal(Number(batch.failed_count),0);assert.equal(Number(batch.skipped_count),0);assert.equal(batch.lease_owner,null);return batch;}
async function mirrorDigests(c,definitions,batchId){const result={};for(const {table,projection,hash}of definitions)result[table]=await scan(c,table+"_archive",{where:"archive_batch_id=?",values:[batchId],columns:projection+",row_hash",verify:row=>{const digest=hash(table,row);assert.equal(digest,row.row_hash);return digest;}});return result;}
export async function prepareArchive(c){

 const window=salesArchiveWindow(Date.now(),c.app.configuration.sales),cutoff=window.cutoffMs;
 const eligible="SELECT id FROM sales_orders WHERE status IN ('CANCELLED','CLOSED','COMPLETED') AND last_business_updated_at<?";
 const [[count]]=await c.db.query(`SELECT COUNT(*) AS n FROM (${eligible}) candidates`,[cutoff]);assert.equal(Number(count.n),300000);
 const [[existing]]=await c.db.query("SELECT COUNT(*) AS n FROM sales_archive_batches");assert.equal(Number(existing.n),0,"Never silently resume or overwrite an earlier measured Archive run");
 const [candidateIds]=await c.db.query(eligible+" ORDER BY id",[cutoff]),[firstRoots]=await c.db.query(eligible+" ORDER BY status,last_business_updated_at,id LIMIT 500",[cutoff]);assert.equal(candidateIds.length,300000);assert.equal(firstRoots.length,500);assert.ok(firstRoots.some(r=>Number(r.id)===1),"Full original owner graph is among first500");
 await c.save("archive-original-candidate-ids.json",candidateIds.map(r=>String(r.id)));
 const definitions=await contracts(c);assert.equal(definitions.length,18);const before={},firstBefore={};
 for(const definition of definitions){
  const {table,projection,hash}=definition;let where;
  if(table==="sales_orders")where=`id IN (${eligible})`;
  else if(table==="sales_order_line_reservations")where=`sales_order_line_id IN (SELECT id FROM sales_order_lines WHERE sales_order_id IN (${eligible}))`;
  else if(table==="sales_audit_logs")where=`target_type='ORDER' AND target_id IN (${eligible})`;
  else if(Object.hasOwn(SALES_ARCHIVE_COLUMNS,table))where=`sales_order_id IN (${eligible})`;
  // The source generator creates exactly one controlled full owner graph. Other299999 candidates have no Fulfillment history.
  else where="1=1";
  before[table]=await scan(c,table,{where,values:Object.hasOwn(SALES_ARCHIVE_COLUMNS,table)?[cutoff]:[],columns:projection,verify:row=>hash(table,row)});
  const firstWhere=Object.hasOwn(SALES_ARCHIVE_COLUMNS,table)?where.replace(eligible,"SELECT id FROM sales_orders WHERE id IN ("+firstRoots.map(()=>"?").join(",")+")"):"1=1";
  firstBefore[table]=await scan(c,table,{where:firstWhere,values:Object.hasOwn(SALES_ARCHIVE_COLUMNS,table)?firstRoots.map(r=>r.id):[],columns:projection,verify:row=>hash(table,row)});
 }
 assert.equal(before.sales_orders.count,300000);assert.ok(definitions.filter(d=>!Object.hasOwn(SALES_ARCHIVE_COLUMNS,d.table)).every(d=>before[d.table].count>0),"All twelve original owner classes must be genuinely represented");
 const inventoryBefore=await inventoryState(c);await c.save("archive-before.json",{window,before,firstBefore,inventoryBefore,eligibility:"actual normal24month cutoff, historical Manual create/cancel; no future cutoff",cadence:"accelerated real registered invocations;600*15min=150h lower bound; not24h calendar completion"});
 const [inserted]=await c.db.execute("INSERT INTO sales_archive_batches(batch_number,period_key,cutoff_at,status,started_at,updated_at)VALUES(?,?,?,'RUNNING',?,?)",[`SA-${window.periodKey}-000001`,window.periodKey,cutoff,Date.now(),Date.now()]);const batchId=Number(inserted.insertId),job=c.scheduler.jobs.get("sales.archive");assert.equal(job.timeoutMs,600000);assert.equal(job.intervalMs,900000);assert.equal(c.app.configuration.sales.archiveBatchSize,500);

 const foreground=readers(c);let tick,batch;
 try{tick=await c.tick("sales.archive");foreground.check();batch=await assertBatch(c,batchId);assert.equal(Number(batch.archived_count),500);assert.equal(Number(batch.candidate_count),500);assert.ok(tick.ms<=600000);}
 finally{await foreground.close();await c.save("archive-first500-foreground.json",{samples:foreground.samples,failures:foreground.failures});}
 const [moved]=await c.db.query("SELECT id,line_count FROM sales_orders_archive WHERE archive_batch_id=? ORDER BY id",[batchId]);assert.deepEqual(moved.map(r=>String(r.id)),firstRoots.map(r=>String(r.id)).sort((a,b)=>Number(a)-Number(b)));
 const firstAfter=await mirrorDigests(c,definitions,batchId);assert.deepEqual(firstAfter,firstBefore);assert.deepEqual(await inventoryState(c),inventoryBefore);
 await c.save("archive-first500.json",{firstRoots,firstBefore,firstAfter,inventoryUnchanged:true,tickMs:tick.ms});
 return {batchId,cutoff,window,before,moved,invocations:[{phase:"first",ms:tick.ms,delta:500,total:500,status:batch.status}],firstSamples:foreground.samples,firstEvidenceRoot:c.root};
}
export async function drainArchive(c,state){
 const {batchId,cutoff,before,window,invocations}=state,definitions=await contracts(c),initial=await assertBatch(c,batchId);assert.equal(Number(initial.cutoff_at),cutoff);assert.equal(initial.period_key,window.periodKey);assert.equal(Number(initial.archived_count),1000);assert.equal(Number(initial.candidate_count),1000);assert.equal(invocations.length,2);
 const inventoryBefore=await inventoryState(c);await c.save("archive-continuation.json",{state,inventoryBefore,qualification:"Fresh defaultloggedpool afterallmixedmutatorssettle; sameoriginal300kset/batch/cutoff/cursor; no reset"});
 const foreground=readers(c);
 try{
  for(let index=0;index<=600;index++){
   foreground.check();await c.reserve();const prior=await assertBatch(c,batchId);if(prior.status==="COMPLETED")break;
   const tick=await c.tick("sales.archive"),batch=await assertBatch(c,batchId),delta=Number(batch.archived_count)-Number(prior.archived_count);assert.ok(delta>=0&&delta<=500);assert.ok(tick.ms<=600000);const record={phase:"drain",index,ms:tick.ms,delta,total:Number(batch.archived_count),status:batch.status};invocations.push(record);await c.save(`archive-tick-${String(index).padStart(3,"0")}.json`,record);
  }
 }finally{await foreground.close();await c.save("archive-drain-foreground.json",{samples:foreground.samples,failures:foreground.failures,invocations});}
 foreground.check();const samples=[...state.firstSamples,...foreground.samples],metrics=quantiles(samples);assert.ok(metrics.count>=100);assert.ok(metrics.p95<=2000,`Archive-only foregroundP95 ${metrics.p95}ms >2000ms`);
 const finished=await assertBatch(c,batchId);assert.equal(finished.status,"COMPLETED");for(const field of ["candidate_count","archived_count"])assert.equal(Number(finished[field]),300000);assert.equal(finished.checksum_summary.pending.length,0);assert.ok(invocations.length>=600);assert.equal(invocations.reduce((sum,row)=>sum+row.delta,0),300000);
 const after=await mirrorDigests(c,definitions,batchId);assert.deepEqual(after,before);
 for(const {table}of definitions){const [[overlap]]=await c.db.query(`SELECT COUNT(*) AS n FROM ${table} a JOIN ${table}_archive b ON a.id=b.id WHERE b.archive_batch_id=?`,[batchId]);assert.equal(Number(overlap.n),0);}
 const [[manifests]]=await c.db.query("SELECT COUNT(*) AS n FROM sales_archive_order_manifests WHERE archive_batch_id=?",[batchId]);assert.equal(Number(manifests.n),300000);assert.deepEqual(await inventoryState(c),inventoryBefore);
 const replay=await c.tick("sales.archive"),replayed=await assertBatch(c,batchId);assert.equal(Number(replayed.archived_count),300000);await c.save("archive-complete.json",{batchId,cutoff,before,after,manifests,foreground:metrics,invocations,replayMs:replay.ms,noDR:true,calendarCompletionClaim:false,firstEvidenceRoot:state.firstEvidenceRoot});
}
