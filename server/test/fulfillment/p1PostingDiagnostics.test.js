import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {postingDiagnostics,postingSqlCategory,tracePostingAsync,tracePostingSync} from "./p1PostingDiagnostics.js";
import {postingTraceManifest,transformPostingSource} from "./p1PostingTraceSource.js";
import {capacityDiagnostics} from "./p1CapacityDiagnostics.js";

function fixture(){const after=[],messages=[],database={config:{transactionTimeoutMs:20000}};return {database,messages,profile:postingDiagnostics({after:fn=>after.push(fn),diagnostic:text=>messages.push(JSON.parse(text))},database),finish(){after.forEach(fn=>fn());return messages[0];}};}

test("Posting parent identity comes from the actual executor WeakMap and captures its phase/20s",async()=>{
 const after=[],messages=[],t={after:fn=>after.push(fn),diagnostic:text=>messages.push(JSON.parse(text))},tx={query(){return Promise.resolve([[]]);},execute(){}},database={config:{transactionTimeoutMs:20000},withTransaction:work=>work(tx)},parent=capacityDiagnostics(t,database),owner={post(actual){return tracePostingAsync("POST_BATCH",()=>actual.query("SELECT 1"));}};
 assert.equal(parent.transactionInfo(tx),null);postingDiagnostics(t,database,actual=>parent.transactionInfo(actual)).provider(owner,"post");
 await parent.phase("ALLOCATE_SETUP",()=>database.withTransaction(actual=>owner.post(actual)));after.forEach(fn=>fn());assert.deepEqual(messages.find(x=>x.postingDiagnostics).records[0].parent,{ordinal:1,phase:"ALLOCATE_SETUP",timeoutMs:20000});
});

test("Posting SQL categories are fixed and never include SQL text or values",()=>{
 const entries=[
  ["SELECT b.id FROM inventory_stock_balances b JOIN inventory_bins bn ON bn.id=b.bin_id","CANDIDATE_SELECT"],
  ["SELECT * FROM inventory_stock_balances WHERE id IN (?) FOR UPDATE","BALANCE_LOCK_SELECT"],
  ["SELECT * FROM inventory_operation_requests WHERE id=?","OPERATION_SELECT"],
  ["INSERT INTO inventory_stock_balances VALUES (?)","BALANCE_UPSERT"],
  ["INSERT INTO inventory_stock_controls VALUES (?)","CONTROL_UPSERT"],
  ["UPDATE inventory_stock_balances SET version=version+1","BALANCE_CAS"],
  ["UPDATE inventory_reservations SET version=version+1","RESERVATION_CAS"],
  ["INSERT INTO inventory_allocations VALUES (?)","ALLOCATION_INSERT"],
  ["INSERT INTO inventory_audit_logs VALUES (?)","AUDIT_INSERT"],
  ["UPDATE inventory_operation_requests SET completed_at=?","OPERATION_COMPLETE"],
  ["SELECT private_field FROM users","OTHER_SELECT"],[null,"OTHER"]
 ];for(const [sql,label]of entries)assert.equal(postingSqlCategory(sql),label);
});

test("Posting observer retains exact executor receiver, args, values and restoration with nested timings",async()=>{
 const f=fixture(),options={trusted:true},rows=[[{private_field:"never-log"}]],updated=[{affectedRows:1}],calls=[];
 const tx={async query(...args){assert.equal(this,tx);calls.push(args);assert.equal(args[1],options);return rows;},async execute(...args){assert.equal(this,tx);calls.push(args);return updated;}},query=tx.query,execute=tx.execute,output={saved:true};
 const owner={async post(actual){assert.equal(this,owner);assert.equal(actual,tx);return tracePostingAsync("POST_BATCH",async()=>{assert.equal(await tracePostingAsync("CANDIDATE_LOAD",()=>actual.query("SELECT b.id FROM inventory_stock_balances b JOIN inventory_bins bn ON bn.id=b.bin_id",options)),rows);assert.equal(await actual.execute("UPDATE inventory_reservations SET version=version+1",["never-log"]),updated);return tracePostingSync("CANDIDATE_SORT",()=>output);});}},original=owner.post;
 f.profile.provider(owner,"post");assert.throws(()=>f.profile.provider(owner,"post"),/Duplicate posting/u);assert.equal(await owner.post(tx),output);assert.equal(tx.query,query);assert.equal(tx.execute,execute);
 const report=f.finish(),record=report.records[0];assert.equal(owner.post,original);assert.equal(record.timeoutMs,20000);assert.equal(record.instrumentationComplete,true);assert.equal(record.exclusiveTimingQualified,true);assert.equal(record.sql.CANDIDATE_SELECT.returnedRows,1);assert.equal(record.sql.RESERVATION_CAS.affectedRows,1);assert.equal(record.spans.POST_BATCH.sqlCalls,2);assert.equal(record.spans.POST_BATCH.selfSqlCalls,1);assert.equal(record.spans.CANDIDATE_SORT.entered,1);assert.equal(calls.length,2);assert.equal(JSON.stringify(report).includes("never-log"),false);assert.equal(JSON.stringify(report).includes("SELECT b.id"),false);
});

test("Posting observer preserves native synchronous throws and rejected error identity",async()=>{
 for(const synchronous of [false,true]){
  const f=fixture(),error=Object.assign(new Error("private error SQL text"),{code:"DATABASE_TRANSACTION_TIMEOUT"});
  const tx={query(){if(synchronous)throw error;return Promise.reject(error);},execute(){}},original=tx.query,owner={post(actual){return tracePostingAsync("POST_BATCH",()=>actual.query("SELECT private_secret",["private-input"]));}};f.profile.provider(owner,"post");
  await assert.rejects(()=>owner.post(tx),actual=>actual===error);assert.equal(tx.query,original);const record=f.finish().records[0];assert.equal(record.errorCode,"DATABASE_TRANSACTION_TIMEOUT");assert.equal(record.spans.POST_BATCH.failed,1);assert.equal(record.sql.OTHER_SELECT.failed,1);assert.equal(record.sqlInFlight,0);assert.equal(JSON.stringify(record).includes("private"),false);
 }
 const f=fixture(),error=new Error("original sync owner failure"),tx={query(){},execute(){}},owner={post(){throw error;}};f.profile.provider(owner,"post");assert.throws(()=>owner.post(tx),actual=>actual===error);f.finish();
});

test("Observer failure marks measurements invalid without masking results or business errors",async()=>{
 const f=fixture(),result=Object.defineProperty({},"0",{get(){throw Error("observer result getter");}}),error=Object.defineProperty(new Error("business"),"code",{get(){throw Error("observer code getter");}}),tx={query(){return Promise.resolve(result);},execute(){}},owner={async post(actual,fail){return tracePostingAsync("POST_BATCH",async()=>{tracePostingSync("unknown unsafe label",()=>1);assert.equal(await actual.query("SELECT private"),result);if(fail)throw error;return result;});}};f.profile.provider(owner,"post");
 assert.equal(await owner.post(tx,false),result);await assert.rejects(()=>owner.post(tx,true),actual=>actual===error);const report=f.finish();for(const record of report.records){assert.equal(record.observerInvalid,true);assert.equal(record.exclusiveTimingQualified,false);}assert.equal(JSON.stringify(report).includes("observer result getter"),false);
});

test("Parallel child spans invalidate exclusive wall time and separate post contexts do not leak",async()=>{
 const f=fixture(),gates=[Promise.withResolvers(),Promise.withResolvers()],tx=()=>({async query(){return [[]];},execute(){}}),a=tx(),b=tx(),owner={post(actual,index){return tracePostingAsync("POST_BATCH",async()=>{await Promise.all([tracePostingAsync("CANDIDATE_LOAD",async()=>{await gates[index].promise;await actual.query("SELECT 1");}),tracePostingAsync("CANDIDATE_SORT",async()=>{gates[index].resolve();await actual.query("SELECT 2");})]);return actual;});}};f.profile.provider(owner,"post");assert.deepEqual(await Promise.all([owner.post(a,0),owner.post(b,1)]),[a,b]);
 const records=f.finish().records;assert.equal(records.length,2);for(const record of records){assert.equal(record.spans.POST_BATCH.unqualifiedSelfSamples,1);assert.equal(record.exclusiveTimingQualified,false);assert.equal(record.sql.OTHER_SELECT.entered,2);assert.equal(record.spans.CANDIDATE_LOAD.entered,1);assert.equal(record.spans.CANDIDATE_SORT.entered,1);}
 assert.equal(tracePostingSync("outside",()=>7),7);
});

test("Posting observation retains a bounded number of summaries with explicit omissions",async()=>{
 const f=fixture(),tx={query(){},execute(){}},owner={async post(){return 9;}};f.profile.provider(owner,"post");for(let i=0;i<17;i++)assert.equal(await owner.post(tx),9);const report=f.finish();assert.equal(report.records.length,16);assert.equal(report.omitted,1);
});

test("Child spans overlapping parent SQL and unawaited work cannot qualify exclusive measurements",async()=>{
 for(const sqlFirst of [false,true]){
  const f=fixture(),sql=Promise.withResolvers(),child=Promise.withResolvers(),tx={query:()=>sql.promise,execute(){}},owner={post(actual){return tracePostingAsync("POST_BATCH",async()=>{
   let a,b;const runChild=()=>tracePostingAsync("CANDIDATE_LOAD",()=>child.promise);
   if(sqlFirst){a=actual.query("SELECT 1");b=runChild();}else{a=runChild();b=actual.query("SELECT 1");}
   sql.resolve([[]]);child.resolve(1);await Promise.all([a,b]);return 17;
  });}};f.profile.provider(owner,"post");assert.equal(await owner.post(tx),17);const record=f.finish().records[0];assert.equal(record.overlapDetected,true);assert.equal(record.exclusiveTimingQualified,false);assert.equal(record.spans.POST_BATCH.unqualifiedSelfSamples,1);
 }
 const f=fixture(),gate=Promise.withResolvers(),tx={query(){},execute(){}};let late;
 const owner={post(){return tracePostingAsync("POST_BATCH",()=>{late=tracePostingAsync("CANDIDATE_LOAD",()=>gate.promise);return 23;});}};f.profile.provider(owner,"post");assert.equal(await owner.post(tx),23);gate.resolve();await late;const record=f.finish().records[0];assert.equal(record.observerInvalid,true);assert.equal(record.exclusiveTimingQualified,false);
});

test("Diagnostic transform pins five modules, thirteen bodies and their business AST without SQL rewrites",async()=>{
 const helper=new URL("./p1PostingDiagnostics.js",import.meta.url).href;let targets=0;
 for(const [name,entry]of Object.entries(postingTraceManifest)){
  const original=await readFile(new URL("../../src/modules/inventory/"+name,import.meta.url),"utf8"),result=transformPostingSource(name,original,helper);
  targets+=result.proof.spans.length;assert.equal(result.proof.businessAstEquivalent,true);assert.equal(result.proof.originalSha256,entry.sha256);assert.match(result.proof.transformedSha256,/^[a-f0-9]{64}$/u);assert.throws(()=>transformPostingSource(name,original+"\n",helper),/baseline changed/u);
 }
 assert.equal(targets,13);
});

test("Original native absent-Stocktake guard is classified without accepting partial schema or timeout",async()=>{
 const source=await readFile(new URL("../../src/modules/inventory/InventoryLockService.js",import.meta.url),"utf8"),{parse}=createRequire(import.meta.url)("acorn"),ast=parse(source,{ecmaVersion:"latest",sourceType:"module"}),fn=ast.body.find(node=>node.type==="FunctionDeclaration"&&node.id.name==="lockActiveBinLocks"),AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
 const originalGuard=new AsyncFunction("connection","binIds",source.slice(fn.body.start+1,fn.body.end-1));
 for(const tableCount of [0,1,2]){
  const f=fixture(),error={code:"DATABASE_OPERATION_FAILED",cause:{code:"ER_NO_SUCH_TABLE"}},tx={async query(sql){if(sql.includes("information_schema.tables"))return [Array.from({length:tableCount},()=>({table_name:"private-name"}))];throw error;},execute(){}},owner={post(actual){return tracePostingAsync("POST_BATCH",()=>originalGuard(actual,[1]));}};f.profile.provider(owner,"post");
  if(tableCount===0)assert.deepEqual(await owner.post(tx),[]);else await assert.rejects(()=>owner.post(tx),actual=>actual===error);
  const record=f.finish().records[0];assert.equal(record.sql.STOCKTAKE_LOCK_PROBE.failed,1);assert.deepEqual(record.sql.STOCKTAKE_LOCK_PROBE.errorCodes,["DATABASE_OPERATION_FAILED","ER_NO_SUCH_TABLE"]);assert.equal(record.sql.STOCKTAKE_SCHEMA_PROOF.returnedRows,tableCount);assert.equal(JSON.stringify(record).includes("private-name"),false);
 }
 const timeout={code:"DATABASE_TRANSACTION_TIMEOUT"};let calls=0;await assert.rejects(()=>originalGuard({async query(){calls++;throw timeout;}},[1]),actual=>actual===timeout);assert.equal(calls,1);
});
