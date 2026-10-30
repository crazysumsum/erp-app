// Explicit local test-loader diagnostics only. Product modules never import this normally.
import assert from "node:assert/strict";
import {AsyncLocalStorage} from "node:async_hooks";
import {createHash} from "node:crypto";
import mysql from "mysql2/promise";
import {getActiveTransactionIsolation} from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import {tracePostingAsync as traceBase,tracePostingSync} from "./p1PostingDiagnostics.js";
export {tracePostingSync};
const active=new AsyncLocalStorage(),prefix="UPDATE fulfillment_allocations SET released_base_quantity=allocated_base_quantity,status='RELEASED',inventory_version=";
const fields={prepared:["COUNT_EXECUTE","SUM_TIMER_EXECUTE","COUNT_REPREPARE","SUM_LOCK_TIME","SUM_ERRORS","SUM_WARNINGS","SUM_ROWS_AFFECTED","SUM_ROWS_EXAMINED","SUM_SELECT_SCAN","SUM_NO_INDEX_USED","SUM_NO_GOOD_INDEX_USED"],program:["COUNT_STAR","SUM_TIMER_WAIT","COUNT_STATEMENTS","SUM_STATEMENTS_WAIT"],index:["COUNT_FETCH","SUM_TIMER_FETCH","COUNT_UPDATE","SUM_TIMER_UPDATE"],wait:["COUNT_STAR","SUM_TIMER_WAIT"]};
const integer=value=>{assert.match(String(value),/^\d+$/u,"Invalid diagnostic integer");return BigInt(value);};
export function releaseMetricDelta(after,before,names){return Object.fromEntries(names.map(name=>{const value=integer(after[name])-integer(before?.[name]??0);assert.ok(value>=0n,"Diagnostic counter reset");return [name,String(value)];}));}
const scalar=(row,names)=>Object.fromEntries(names.map(name=>[name,String(integer(row[name]))]));
const code=error=>typeof error?.code==="string"&&/^[A-Z_]{1,80}$/u.test(error.code)?error.code:null;
const checks=new Set(["Diagnostic counter reset","Diagnostic counter disappeared","Prepared statement metrics unavailable","Truncated SQL prefix differs","Prepared object changed","Prepared handle changed","Other active foreground work makes object/global counters unqualified","Enabled SQL events make global/object counters unqualified","Other active InnoDB transaction makes object/global counters unqualified","Original100-row batch shape changed","Observer EXPLAIN session settings differ","Invalid diagnostic integer","Ambiguous prepared statement prefix","Prepared SQL identity changed","Prepared execute count delta","Prepared statement reported errors","Prepared affected rows differ","Prepared instrumentation lost","Original SQL shape changed","Actual diagnostic thread missing","Actual diagnostic namespace mismatch","Actual diagnostic thread disabled","Unsupported diagnostic text length","Incomplete EXPLAIN session settings","Original UPDATE plan row missing","Unsafe plan identifier","Original UPDATE plan table differs","Original UPDATE plan operation differs","Invalid plan estimate","Invalid plan flags"]);
const problem=(record,stage,error)=>{record.invalid=true;if(record.issues.length<16){const first=String(error?.message??"").split("\n")[0];record.issues.push({stage,code:code(error),check:checks.has(first)?first:null});}};
const maps=(rows,key,names)=>Object.fromEntries(rows.map(row=>[key(row),scalar(row,names)]));
const changes=(after,before,names)=>{assert.ok(Object.keys(before).every(key=>Object.hasOwn(after,key)),"Diagnostic counter disappeared");return Object.fromEntries(Object.entries(after).map(([key,row])=>[key,releaseMetricDelta(row,before[key],names)]).filter(([,row])=>Object.values(row).some(value=>value!=="0")));};
export function releasePlanTables(rows){
 assert.ok(Array.isArray(rows)&&rows.length===1,"Original UPDATE plan row missing");
 const identifier=value=>{assert.equal(typeof value,"string","Unsafe plan identifier");assert.match(value,/^[A-Za-z0-9_$]+$/u,"Unsafe plan identifier");return value;};
 return rows.map(row=>{
  assert.equal(row.table,"fulfillment_allocations","Original UPDATE plan table differs");assert.equal(row.select_type,"UPDATE","Original UPDATE plan operation differs");
  const table={table:identifier(row.table),access_type:identifier(row.type),possible_keys:row.possible_keys===null?[]:row.possible_keys.split(",").map(identifier)};
  if(row.key!==null)table.key=identifier(row.key);
  for(const [source,target]of [["rows","estimated_rows"],["filtered","filtered"]])if(row[source]!==null){assert.ok(Number.isFinite(Number(row[source]))&&Number(row[source])>=0,"Invalid plan estimate");table[target]=Number(row[source]);}
  assert.ok(row.Extra===null||typeof row.Extra==="string","Invalid plan flags");table.using_temporary=/\bUsing temporary\b/u.test(row.Extra??"");table.using_where=/\bUsing where\b/u.test(row.Extra??"");return table;
 });
}
export function releaseBackgroundThreads(rows){
 for(const row of rows){const known=row.NAME==="thread/sql/event_scheduler"&&row.PROCESSLIST_USER==="event_scheduler"||row.NAME==="thread/sql/compress_gtid_table"&&row.PROCESSLIST_USER===null;assert.ok(known&&row.TYPE==="FOREGROUND"&&row.PROCESSLIST_COMMAND==="Daemon"&&row.PROCESSLIST_DB===null,"Other active foreground work makes object/global counters unqualified");}
 return rows.some(row=>row.NAME==="thread/sql/event_scheduler");
}
async function snapshot(observer,threadId,namespace,connectionId){
 const rows=async(sql,parameters=[])=>{const [result]=await observer.query({sql,timeout:2000},parameters);return result;};
 const prepared=await rows(`SELECT OBJECT_INSTANCE_BEGIN,STATEMENT_ID,SQL_TEXT,${fields.prepared.join(",")} FROM performance_schema.prepared_statements_instances WHERE OWNER_THREAD_ID=? AND OWNER_OBJECT_TYPE IS NULL AND STATEMENT_NAME IS NULL AND SQL_TEXT LIKE ?`,[threadId,prefix+"%"]);
 const programs=await rows(`SELECT OBJECT_NAME,${fields.program.join(",")} FROM performance_schema.events_statements_summary_by_program WHERE OBJECT_TYPE='TRIGGER' AND OBJECT_SCHEMA=?`,[namespace]);
 const indexes=await rows(`SELECT OBJECT_NAME,INDEX_NAME,${fields.index.join(",")} FROM performance_schema.table_io_waits_summary_by_index_usage WHERE OBJECT_SCHEMA=? AND OBJECT_NAME IN ('fulfillment_allocations','fulfillment_lines','inventory_allocations','inventory_operation_requests','inventory_stock_balances')`,[namespace]);
 const waits=await rows(`SELECT EVENT_NAME,${fields.wait.join(",")} FROM performance_schema.events_waits_summary_by_thread_by_event_name WHERE THREAD_ID=? AND COUNT_STAR>0 AND EVENT_NAME<>'idle'`,[threadId]);
 const status=await rows("SELECT VARIABLE_NAME,VARIABLE_VALUE FROM performance_schema.status_by_thread WHERE THREAD_ID=? AND (VARIABLE_NAME LIKE 'Handler_read_%' OR VARIABLE_NAME='Handler_update')",[threadId]);
 const locks=await rows("SELECT VARIABLE_NAME,VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME IN ('Innodb_row_lock_waits','Innodb_row_lock_time','Innodb_row_lock_current_waits','Performance_schema_prepared_statements_lost')");
 const others=await rows("SELECT NAME,TYPE,PROCESSLIST_USER,PROCESSLIST_COMMAND,PROCESSLIST_DB FROM performance_schema.threads WHERE TYPE='FOREGROUND' AND PROCESSLIST_ID<>CONNECTION_ID() AND THREAD_ID<>? AND PROCESSLIST_COMMAND<>'Sleep'",[threadId]);
 if(releaseBackgroundThreads(others)){const events=await rows("SELECT COUNT(*) AS n FROM information_schema.events WHERE STATUS='ENABLED'");assert.equal(Number(events[0].n),0,"Enabled SQL events make global/object counters unqualified");}
 const transactions=await rows("SELECT COUNT(*) AS n FROM information_schema.innodb_trx WHERE trx_mysql_thread_id<>?",[connectionId]);assert.equal(Number(transactions[0].n),0,"Other active InnoDB transaction makes object/global counters unqualified");
 assert.ok(prepared.length<=1,"Ambiguous prepared statement prefix");
 return {prepared:prepared[0]??null,programs:maps(programs,row=>row.OBJECT_NAME,fields.program),indexes:maps(indexes,row=>row.OBJECT_NAME+":"+(row.INDEX_NAME??"<none>"),fields.index),waits:maps(waits,row=>row.EVENT_NAME,fields.wait),status:Object.fromEntries(status.map(row=>[row.VARIABLE_NAME,{value:String(integer(row.VARIABLE_VALUE))}])),locks:Object.fromEntries(locks.map(row=>[row.VARIABLE_NAME.toLowerCase(),String(integer(row.VARIABLE_VALUE))]))};
}
export function releaseSnapshotDelta(after,before,sql,textLength){
 const a=after.prepared,b=before.prepared;assert.ok(a,"Prepared statement metrics unavailable");
 assert.equal(a.SQL_TEXT,sql.slice(0,textLength),"Truncated SQL prefix differs");
 if(b){assert.equal(String(a.OBJECT_INSTANCE_BEGIN),String(b.OBJECT_INSTANCE_BEGIN),"Prepared object changed");assert.equal(String(a.STATEMENT_ID),String(b.STATEMENT_ID),"Prepared handle changed");assert.equal(a.SQL_TEXT,b.SQL_TEXT,"Prepared SQL identity changed");}
 const prepared=releaseMetricDelta(a,b,fields.prepared);assert.equal(prepared.COUNT_EXECUTE,"1","Prepared execute count delta");assert.equal(prepared.SUM_ERRORS,"0","Prepared statement reported errors");assert.equal(prepared.SUM_ROWS_AFFECTED,"100","Prepared affected rows differ");
 assert.equal(after.locks.performance_schema_prepared_statements_lost,before.locks.performance_schema_prepared_statements_lost,"Prepared instrumentation lost");
 return {prepared,programs:changes(after.programs,before.programs,fields.program),indexes:changes(after.indexes,before.indexes,fields.index),waits:changes(after.waits,before.waits,fields.wait),handlers:changes(after.status,before.status,["value"]),rowLocks:releaseMetricDelta(after.locks,before.locks,["innodb_row_lock_waits","innodb_row_lock_time"]),rowLocksCurrent:{before:before.locks.innodb_row_lock_current_waits,after:after.locks.innodb_row_lock_current_waits}};
}
async function captureRelease(scope,work){
 const {tx,parent,observer,namespace,records,state}=scope;if(records.length>=2){state.omitted++;return work();}const record={parent,samples:[],plans:[],issues:[],invalid:false,settled:false,executed:0,observerMs:0,originalSqlMs:0};records.push(record);
 const start=performance.now(),timed=async work=>{const now=performance.now();try{return await work();}finally{record.observerMs+=performance.now()-now;}};
 let previous,threadId,textLength,connectionId;const statements=[];
 try{
  connectionId=tx.target.threadId;assert.ok(Number.isSafeInteger(connectionId)&&connectionId>0);
  const [threads]=await timed(()=>observer.query({sql:"SELECT THREAD_ID,PROCESSLIST_DB,INSTRUMENTED FROM performance_schema.threads WHERE PROCESSLIST_ID=?",timeout:2000},[connectionId]));assert.equal(threads.length,1,"Actual diagnostic thread missing");assert.equal(threads[0].PROCESSLIST_DB,namespace,"Actual diagnostic namespace mismatch");assert.equal(threads[0].INSTRUMENTED,"YES","Actual diagnostic thread disabled");threadId=threads[0].THREAD_ID;
  const [variables]=await timed(()=>observer.query({sql:"SELECT @@performance_schema_max_sql_text_length AS textLength",timeout:2000}));textLength=Number(variables[0].textLength);assert.ok(Number.isSafeInteger(textLength)&&textLength>=prefix.length,"Unsupported diagnostic text length");
  const settings="('optimizer_switch','optimizer_prune_level','optimizer_search_depth','eq_range_index_dive_limit','range_optimizer_max_mem_size','sql_mode','collation_connection')";
  const [actual]=await timed(()=>observer.query({sql:"SELECT VARIABLE_NAME,VARIABLE_VALUE FROM performance_schema.variables_by_thread WHERE THREAD_ID=? AND VARIABLE_NAME IN "+settings,timeout:2000},[threadId]));
  const [own]=await timed(()=>observer.query({sql:"SHOW SESSION VARIABLES WHERE Variable_name IN "+settings,timeout:2000}));
  const normalize=rows=>Object.fromEntries(rows.map(row=>[String(row.VARIABLE_NAME??row.Variable_name).toLowerCase(),String(row.VARIABLE_VALUE??row.Value)]).sort(([a],[b])=>a.localeCompare(b)));
  record.planSessionSettings=normalize(actual);assert.equal(actual.length,7,"Incomplete EXPLAIN session settings");assert.deepEqual(record.planSessionSettings,normalize(own),"Observer EXPLAIN session settings differ");
  previous=await timed(()=>snapshot(observer,threadId,namespace,connectionId));
 }catch(error){problem(record,"initial-snapshot",error);}
 const original=tx.execute;
 const wrapped=function(...args){
  if(typeof args[0]!=="string"||!args[0].startsWith(prefix))return original.apply(this,args);
  record.executed++;const started=performance.now();
  let result;try{result=original.apply(this,args);}catch(error){record.originalSqlMs+=performance.now()-started;record.businessErrorCode=code(error);throw error;}
  if(!(result instanceof Promise)){record.invalid=true;return result;}
  return result.then(async value=>{
   const clientMs=performance.now()-started;record.originalSqlMs+=clientMs;
   try{
    assert.ok(record.executed<=50&&Array.isArray(args[1])&&args[1].length===802,"Original100-row batch shape changed");
    const hash=createHash("sha256").update(args[0]).digest("hex");record.sqlSha256??=hash;assert.equal(hash,record.sqlSha256,"Original SQL shape changed");
    if(!record.invalid){const after=await timed(()=>snapshot(observer,threadId,namespace,connectionId));record.samples.push({batch:record.executed,clientMs,...releaseSnapshotDelta(after,previous,args[0],textLength)});previous=after;statements.push([args[0],[...args[1]]]);}
   }catch(error){problem(record,"post-update-snapshot",error);}
   return value;
  },error=>{record.originalSqlMs+=performance.now()-started;record.businessErrorCode=code(error);throw error;});
 };
 tx.execute=wrapped;
 let businessError;
 try{return await work();}catch(error){businessError=error;record.businessErrorCode=code(error);throw error;}
 finally{
  if(tx.execute===wrapped)tx.execute=original;
  if(!businessError&&!record.invalid)try{
   // All original UPDATE counters are captured first. Planning on the observer cannot contaminate their deltas.
   for(const [sql,parameters]of statements){const [rows]=await timed(()=>observer.query({sql:"EXPLAIN FORMAT=TRADITIONAL "+sql,timeout:2000},parameters));record.plans.push({batch:record.plans.length+1,tables:releasePlanTables(rows)});}
  }catch(error){problem(record,"explain-original",error);}
  record.settled=true;record.elapsedMs=performance.now()-start;
 }
}
export function tracePostingAsync(label,work){const scope=active.getStore();return traceBase(label,label==="F_RELEASE_PROJECTIONS"&&scope?()=>captureRelease(scope,work):work);}
export function installReleaseSqlDiagnostics(t,database,parentOf,{observer,namespace}){
 const records=[],state={selectionFailures:0,omitted:0},original=database.withTransaction;
 const wrapped=function(work,...options){return original.call(this,function(tx,...context){let parent,selected;
  try{parent=parentOf(tx);selected=["REALLOCATE_ROLLBACK","REALLOCATE"].includes(parent?.phase)&&getActiveTransactionIsolation(tx)==="READ COMMITTED";}catch{state.selectionFailures++;return work(tx,...context);}
  return selected?active.run({tx,parent,observer,namespace,records,state},()=>work(tx,...context)):work(tx,...context);
 },...options);};database.withTransaction=wrapped;
 t.after(()=>{if(database.withTransaction===wrapped)database.withTransaction=original;t.diagnostic(JSON.stringify({releaseSqlDiagnostics:true,scope:"Original UPDATE only; observer overhead stays inside20s; program/index/global rowLocks are isolated object/server aggregates, not per-thread; inclusive timings must not be summed",...state,records}));});
 return {records,state};
}
export async function releaseSqlDiagnostics(t,database,parentOf,namespace){
 const base=process.env.DB_NAME,socket=process.env.DB_SOCKET_PATH;assert.match(base??"",/^fulfillment_p0_p1_[a-f0-9]{8}$/u);assert.match(namespace,new RegExp("^"+base+"_sf_[a-f0-9]{12}$","u"));assert.ok(socket?.endsWith("fulfillment-p1-runtime/erp-fulfillment-p0-mysql-r"));
 const observer=await mysql.createConnection({socketPath:socket,user:process.env.DB_ADMIN_USER,password:process.env.DB_ADMIN_PASSWORD,database:namespace,multipleStatements:false,connectTimeout:2000,supportBigNumbers:true,bigNumberStrings:true});
 try{const [[identity]]=await observer.query("SELECT VERSION() AS version,@@server_uuid AS uuid,@@socket AS socket,@@datadir AS datadir,@@skip_networking AS networking,@@performance_schema AS pfs");assert.equal(identity.version,"26.7.0");assert.equal(identity.uuid,process.env.FULFILLMENT_SQL_SERVER_UUID);assert.equal(identity.datadir.replace(/\/$/u,""),socket.slice(0,socket.lastIndexOf("/"))+"/mysql-data");assert.equal(identity.socket,socket);assert.equal(Number(identity.networking),1);assert.equal(Number(identity.pfs),1);}
 catch(error){await observer.end();throw error;}
 t.after(()=>observer.end());return installReleaseSqlDiagnostics(t,database,parentOf,{observer,namespace});
}
