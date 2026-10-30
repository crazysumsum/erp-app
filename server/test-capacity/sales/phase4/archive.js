import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {salesArchiveWindow} from "../../../src/modules/sales/SalesArchiveBatchService.js";
import {SALES_ARCHIVE_COLUMNS,hashSalesArchiveRow,hashSalesArchiveRows} from "../../../src/modules/sales/salesArchiveHash.js";
import {FULFILLMENT_ARCHIVE_CONTRACTS,hashFulfillmentArchiveRow,hashFulfillmentArchiveTable} from "../../../src/modules/fulfillment/fulfillmentArchiveSchema.js";
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

// DEC047C: two real500-order invocations; full300k drain remains a separate prelaunch obligation.
export async function boundedMergeArchive(c){
 const window=salesArchiveWindow(Date.now(),c.app.configuration.sales),eligible="status IN ('CANCELLED','CLOSED','COMPLETED') AND last_business_updated_at<?";
 const [[count]]=await c.db.query(`SELECT COUNT(*) AS n FROM sales_orders WHERE ${eligible}`,[window.cutoffMs]),[[existing]]=await c.db.query("SELECT COUNT(*) AS n FROM sales_archive_batches");
 assert.equal(Number(count.n),300000);assert.equal(Number(existing.n),0,"Do not resume or overwrite a measured attempt");
 const [roots]=await c.db.query(`SELECT id,total_amount FROM sales_orders WHERE ${eligible} ORDER BY status,last_business_updated_at,id LIMIT 1000`,[window.cutoffMs]);assert.equal(roots.length,1000);assert.ok(roots.slice(0,500).some(row=>String(row.id)==="1"));
 const ids=roots.map(row=>String(row.id));assert.ok(ids.every(id=>/^[1-9][0-9]*$/u.test(id)));const selected=ids.join(","),fulfillments=`SELECT id FROM fulfillments WHERE sales_order_id IN (${selected})`,shipments=`SELECT id FROM shipments WHERE sales_order_id IN (${selected})`,reversals=`SELECT id FROM shipment_reversals WHERE shipment_id IN (${shipments})`;
 const definitions=await contracts(c),before={},source={};assert.equal(definitions.length,18);
 for(const {table,names,projection,hash}of definitions){
  let where;
  if(table==="sales_orders")where=`id IN (${selected})`;
  else if(table==="sales_order_line_reservations")where=`sales_order_line_id IN (SELECT id FROM sales_order_lines WHERE sales_order_id IN (${selected}))`;
  else if(table==="sales_audit_logs")where=`target_type='ORDER' AND target_id IN (${selected})`;
  else if(names.includes("sales_order_id"))where=`sales_order_id IN (${selected})`;
  else if(names.includes("fulfillment_id"))where=`fulfillment_id IN (${fulfillments})`;
  else if(names.includes("shipment_id"))where=`shipment_id IN (${shipments})`;
  else {assert.equal(table,"fulfillment_audit_logs");where=`(target_type='FULFILLMENT' AND target_id IN (${fulfillments})) OR (target_type='SHIPMENT' AND target_id IN (${shipments})) OR (target_type='REVERSAL' AND target_id IN (${reversals}))`;}
  source[table]=[];before[table]=await scan(c,table,{where,columns:projection,verify:row=>{source[table].push(row);return hash(table,row);}});
 }
 assert.equal(before.sales_orders.count,1000);assert.ok(FULFILLMENT_ARCHIVE_CONTRACTS.every(({table})=>before[table].count>0),"All twelve owner classes must occur in the selected graph");
 const owners=table=>new Map(source[table].map(row=>[String(row.id),String(row.sales_order_id)])),lineOwners=owners("sales_order_lines"),fulfillmentOwners=owners("fulfillments"),shipmentOwners=owners("shipments"),reversalOwners=new Map(source.shipment_reversals.map(row=>[String(row.id),shipmentOwners.get(String(row.shipment_id))]));
 const grouped=new Map(ids.map(id=>[id,Object.fromEntries(definitions.map(({table})=>[table,[]]))]));
 for(const {table}of definitions)for(const row of source[table]){
  let orderId;
  if(table==="sales_orders")orderId=String(row.id);
  else if(table==="sales_audit_logs")orderId=String(row.target_id);
  else if(table==="fulfillment_audit_logs")orderId=({FULFILLMENT:fulfillmentOwners,SHIPMENT:shipmentOwners,REVERSAL:reversalOwners})[row.target_type]?.get(String(row.target_id));
  else if(row.sales_order_id!==undefined)orderId=String(row.sales_order_id);
  else if(row.sales_order_line_id!==undefined&&table==="sales_order_line_reservations")orderId=lineOwners.get(String(row.sales_order_line_id));
  else if(row.fulfillment_id!==undefined)orderId=fulfillmentOwners.get(String(row.fulfillment_id));
  else orderId=shipmentOwners.get(String(row.shipment_id));
  assert.ok(grouped.has(orderId),table+" must belong to a selected Order");grouped.get(orderId)[table].push(row);
 }
 const expectedManifests={};
 for(const [id,tables]of grouped){
  const expected={sales_table_counts:{},sales_hash_summary:{},fulfillment_table_counts:{},fulfillment_hash_summary:{}};
  for(const {table}of definitions){const sales=Object.hasOwn(SALES_ARCHIVE_COLUMNS,table),digest=sales?await hashSalesArchiveRows(table,tables[table]):hashFulfillmentArchiveTable(table,tables[table]);expected[sales?"sales_table_counts":"fulfillment_table_counts"][table]=digest.count;expected[sales?"sales_hash_summary":"fulfillment_hash_summary"][table]=digest.hash;}
  expectedManifests[id]=expected;
 }
 const inventoryBefore=await inventoryState(c);await c.save("merge-archive-before.json",{window,ids,before,expectedManifests,inventoryBefore,scale:"selected1000 only; full300k/50mixed deferred; no historical graph rebuild"});
 const now=Date.now(),[inserted]=await c.db.execute("INSERT INTO sales_archive_batches(batch_number,period_key,cutoff_at,status,started_at,updated_at)VALUES(?,?,?,'RUNNING',?,?)",[`SA-${window.periodKey}-000001`,window.periodKey,window.cutoffMs,now,now]),batchId=Number(inserted.insertId),job=c.scheduler.jobs.get("sales.archive");
 assert.equal(job.timeoutMs,600000);assert.equal(job.intervalMs,900000);assert.equal(c.app.configuration.sales.archiveBatchSize,500);
 const foreground=readers(c),invocations=[];
 try{for(let index=0;index<2;index++){
  await c.reserve();const prior=await assertBatch(c,batchId),tick=await c.tick("sales.archive"),batch=await assertBatch(c,batchId);foreground.check();
  const record={index,ms:tick.ms,delta:Number(batch.archived_count)-Number(prior.archived_count),total:Number(batch.archived_count),status:batch.status};invocations.push(record);await c.save(`merge-archive-tick-${index}.json`,record);
  assert.ok(tick.ms<=600000);assert.equal(record.delta,500);assert.equal(record.total,500*(index+1));assert.equal(Number(batch.candidate_count),record.total);assert.equal(batch.status,"RUNNING");assert.deepEqual(await inventoryState(c),inventoryBefore);
 }}finally{await foreground.close();await c.save("merge-archive-foreground.json",{samples:foreground.samples,failures:foreground.failures,invocations,qualification:"10 real readers; report actual sample count, not the deferred>=100 long-run cohort"});}
 foreground.check();assert.ok(foreground.samples.length>=10);const after=await mirrorDigests(c,definitions,batchId);assert.deepEqual(after,before);
 const [manifests]=await c.db.query("SELECT * FROM sales_archive_order_manifests WHERE archive_batch_id=? ORDER BY sales_order_id",[batchId]);assert.deepEqual(manifests.map(row=>String(row.sales_order_id)),[...ids].sort((a,b)=>Number(a)-Number(b)));
 const json=value=>typeof value==="string"?JSON.parse(value):value,byId=new Map(manifests.map(row=>[String(row.sales_order_id),row]));let amountTotal=0n,amountHash=createHash("sha256").digest("hex"),manifestHash=amountHash;
 for(const root of roots){const id=String(root.id),actual=byId.get(id),expected=expectedManifests[id];for(const key of Object.keys(expected))assert.deepEqual(json(actual[key]),expected[key]);assert.deepEqual(json(actual.participant_versions),{sales:"1",fulfillment:"1"});amountTotal+=BigInt(String(root.total_amount).replace(".",""));amountHash=createHash("sha256").update(`${amountHash}:${id}:${root.total_amount}\n`).digest("hex");manifestHash=createHash("sha256").update(`${manifestHash}:${id}:${JSON.stringify(expected.sales_hash_summary)}:${JSON.stringify(expected.fulfillment_hash_summary)}\n`).digest("hex");}
 const batch=await assertBatch(c,batchId),summary=json(batch.checksum_summary);assert.equal(summary.amountTotal,amountTotal.toString());assert.equal(summary.amountHash,amountHash);assert.equal(summary.manifestHash,manifestHash);assert.equal(summary.pending.length,0);
 for(const {table}of definitions){const [[overlap]]=await c.db.query(`SELECT COUNT(*) AS n FROM ${table} a JOIN ${table}_archive b ON a.id=b.id WHERE b.archive_batch_id=?`,[batchId]);assert.equal(Number(overlap.n),0);assert.equal((Object.hasOwn(SALES_ARCHIVE_COLUMNS,table)?summary.salesTableCounts:summary.fulfillmentTableCounts)[table],before[table].count);}
 const [[remaining]]=await c.db.query(`SELECT COUNT(*) AS n FROM sales_orders WHERE ${eligible}`,[window.cutoffMs]);assert.equal(Number(remaining.n),299000);
 await c.save("merge-archive-complete.json",{batchId,before,after,amountTotal:amountTotal.toString(),amountHash,manifestHash,manifestCount:manifests.length,remaining,inventoryUnchanged:true,foreground:quantiles(foreground.samples),invocations,full300kDrain:"NOT_RUN_PRELAUNCH",longForegroundCohort:"NOT_RUN_PRELAUNCH",noDR:true});
}
