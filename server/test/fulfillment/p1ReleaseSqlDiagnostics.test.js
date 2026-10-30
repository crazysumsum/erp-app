import assert from "node:assert/strict";
import test from "node:test";
import {MySqlDatabaseService} from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import {installReleaseSqlDiagnostics,tracePostingAsync,releaseMetricDelta,releaseSnapshotDelta,releasePlanTables,releaseBackgroundThreads} from "./p1ReleaseSqlDiagnostics.js";
const sql="UPDATE fulfillment_allocations SET released_base_quantity=allocated_base_quantity,status='RELEASED',inventory_version="+"?".repeat(2000),parameters=Array(802).fill("private-fixture-input"),namespace="synthetic-owned-child";
const settings=['optimizer_switch','optimizer_prune_level','optimizer_search_depth','eq_range_index_dive_limit','range_optimizer_max_mem_size','sql_mode','collation_connection'];
function fixture({observerFailure=false,ambiguous=false}={}){
 let context={},n=0,calls=0;const after=[],messages=[],events=[],t={after:fn=>after.push(fn),diagnostic:text=>messages.push(JSON.parse(text))};
 const connection={threadId:17,query:async()=>[[]],execute:async function(actual,args){calls++;assert.equal(this,connection);assert.equal(actual.sql,sql);assert.equal(args,parameters);n++;events.push('business');return [{affectedRows:100}];},async beginTransaction(){},async commit(){},async rollback(){},release(){},destroy(){}};
 const database=new MySqlDatabaseService({pool:{query:connection.query,getConnection:async()=>connection},context:{get:()=>context,update:value=>{context={...context,...value};}},config:{acquireTimeoutMs:1000,queryTimeoutMs:1000,transactionTimeoutMs:20000}}),original=database.withTransaction;
 const prepared=()=>({OBJECT_INSTANCE_BEGIN:'23',STATEMENT_ID:'29',SQL_TEXT:sql.slice(0,1024),COUNT_EXECUTE:String(n),SUM_TIMER_EXECUTE:String(n*1000000),COUNT_REPREPARE:'0',SUM_LOCK_TIME:'0',SUM_ERRORS:'0',SUM_WARNINGS:'0',SUM_ROWS_AFFECTED:String(n*100),SUM_ROWS_EXAMINED:String(n*5000),SUM_SELECT_SCAN:'0',SUM_NO_INDEX_USED:'0',SUM_NO_GOOD_INDEX_USED:'0'});
 const observer={async query(options){events.push('observer');const query=options.sql;
  if(observerFailure)throw Error('private observer unavailable');
  if(query.startsWith('SELECT THREAD_ID'))return [[{THREAD_ID:31,PROCESSLIST_DB:namespace,INSTRUMENTED:'YES'}]];
  if(query.startsWith('SELECT @@'))return [[{textLength:1024}]];
  if(query.includes('variables_by_thread'))return [settings.map(name=>({VARIABLE_NAME:name,VARIABLE_VALUE:'fixed'}))];
  if(query.startsWith('SHOW SESSION'))return [settings.map(name=>({Variable_name:name,Value:'fixed'}))];
  if(query.includes('prepared_statements_instances'))return [n?[prepared(),...(ambiguous?[prepared()]:[])]:[]];
  if(query.includes('summary_by_program'))return [[{OBJECT_NAME:'fixed_trigger',COUNT_STAR:String(n*100),SUM_TIMER_WAIT:String(n*300000),COUNT_STATEMENTS:'0',SUM_STATEMENTS_WAIT:'0'}]];
  if(query.includes('summary_by_index_usage'))return [[{OBJECT_NAME:'fulfillment_allocations',INDEX_NAME:'idx_work',COUNT_FETCH:String(n*5000),SUM_TIMER_FETCH:'0',COUNT_UPDATE:String(n*100),SUM_TIMER_UPDATE:'0'}]];
  if(query.includes('events_waits_summary'))return [[]];
  if(query.includes('status_by_thread'))return [[{VARIABLE_NAME:'Handler_read_next',VARIABLE_VALUE:String(n*5000)}]];
  if(query.includes('global_status'))return [[...['innodb_row_lock_waits','innodb_row_lock_time','innodb_row_lock_current_waits','performance_schema_prepared_statements_lost'].map(VARIABLE_NAME=>({VARIABLE_NAME,VARIABLE_VALUE:'0'}))]];
  if(query.includes('FROM performance_schema.threads'))return [[]];
  if(query.includes('COUNT(*)'))return [[{n:0}]];
  if(query.startsWith('EXPLAIN')){events.push('plan');return [[{table:'fulfillment_allocations',select_type:'UPDATE',type:'range',possible_keys:'PRIMARY,idx_work',key:'idx_work',rows:'5000',filtered:2,Extra:'Using where; Using temporary',ref:'private-plan-input'}]];}
  throw Error('Unexpected diagnostic SQL');
 }};
 const capture=installReleaseSqlDiagnostics(t,database,()=>({ordinal:7,phase:'REALLOCATE',timeoutMs:20000}),{observer,namespace});
 return {t,database,connection,capture,messages,events,original,calls:()=>calls,async run(work){return database.withTransaction(work,{isolationLevel:'READ COMMITTED'});},finish(){after.forEach(fn=>fn());}};
}
test('Release observer binds actual RC executor, preserves arguments/results and captures original statements before plans',async()=>{
 const f=fixture();const result=await f.run(tx=>tracePostingAsync('F_RELEASE_PROJECTIONS',async()=>{await tx.execute(sql,parameters);return tx.execute(sql,parameters);}));assert.deepEqual(result,[{affectedRows:100}]);f.finish();assert.equal(f.calls(),2);assert.equal(f.database.withTransaction,f.original);const record=f.capture.records[0];assert.equal(record.invalid,false);assert.equal(record.settled,true);assert.equal(record.samples.length,2);assert.equal(record.samples[0].prepared.COUNT_EXECUTE,'1');assert.equal(record.samples[1].prepared.SUM_ROWS_EXAMINED,'5000');assert.equal(record.plans.length,2);assert.ok(f.events.lastIndexOf('business')<f.events.indexOf('plan'));assert.doesNotMatch(JSON.stringify(f.messages),/private-fixture-input|private-plan-input/u);
});
for(const variant of ['observerFailure','ambiguous'])test('Release observer '+variant+' cannot qualify but preserves business result',async()=>{
 const f=fixture({[variant]:true});assert.deepEqual(await f.run(tx=>tracePostingAsync('F_RELEASE_PROJECTIONS',()=>tx.execute(sql,parameters))),[{affectedRows:100}]);f.finish();assert.equal(f.calls(),1);assert.equal(f.capture.records[0].invalid,true);assert.equal(f.capture.records[0].plans.length,0);
});
test('Release observer preserves original synchronous throw, rejection and non-Promise result identity',async()=>{
 for(const mode of ['sync','reject','value']){
  const f=fixture(),error=new Error('original-only'),value={result:3};
  await f.run(async tx=>{tx.execute=()=>{if(mode==='sync')throw error;if(mode==='reject')return Promise.reject(error);return value;};
   await tracePostingAsync('F_RELEASE_PROJECTIONS',async()=>{if(mode==='sync')assert.throws(()=>tx.execute(sql,parameters),e=>e===error);else if(mode==='reject')await assert.rejects(()=>tx.execute(sql,parameters),e=>e===error);else assert.equal(tx.execute(sql,parameters),value);});
  });f.finish();assert.equal(f.calls(),0);
 }
});
test('Release observer excludes RR callback and survives selector lookup/getter failure',async()=>{
 const f=fixture();await f.database.withTransaction(()=>tracePostingAsync('F_RELEASE_PROJECTIONS',()=>19));assert.equal(f.capture.records.length,0);f.finish();
 for(const lookup of [()=>{throw Error('lookup');},()=>Object.defineProperty({},'phase',{get(){throw Error('getter');}})]){
  const g=fixture(),capture=installReleaseSqlDiagnostics(g.t,g.database,lookup,{observer:{},namespace});assert.equal(await g.run(()=>21),21);g.finish();assert.equal(capture.state.selectionFailures,1);
 }
});
test('Release scalar counter delta is exact beyond Number range and rejects reset/invalid scalars',()=>{
 assert.deepEqual(releaseMetricDelta({n:'9007199254740999'},{n:'9007199254740993'},['n']),{n:'6'});
 for(const n of ['-1','NaN','1.2','undefined'])assert.throws(()=>releaseMetricDelta({n},null,['n']));assert.throws(()=>releaseMetricDelta({n:'2'},{n:'3'},['n']));
});
test('Release TRADITIONAL plans accept actual nullable columns and expose no conditions or constants',()=>{
 const row={table:'fulfillment_allocations',select_type:'UPDATE',type:'range',possible_keys:'PRIMARY,idx_work',key:'idx_work',rows:'1',filtered:100,Extra:'Using where; Using temporary',ref:'private'};
 assert.deepEqual(releasePlanTables([row]),[{table:'fulfillment_allocations',access_type:'range',possible_keys:['PRIMARY','idx_work'],key:'idx_work',estimated_rows:1,filtered:100,using_temporary:true,using_where:true}]);
 assert.deepEqual(releasePlanTables([{...row,type:'ALL',possible_keys:null,key:null,rows:null,filtered:null,Extra:null}]),[{table:'fulfillment_allocations',access_type:'ALL',possible_keys:[],using_temporary:false,using_where:false}]);
 for(const value of [[],[{...row,table:'other'}],[{...row,key:'private data'}],[{...row,rows:'NaN'}],[{...row,select_type:'SELECT'}],{query_plan:{operation:'not executable'}}])assert.throws(()=>releasePlanTables(value));
});
test('Release snapshot rejects missing/reused/ambiguous counters and unexpected affected rows',()=>{
 const before={prepared:null,programs:{},indexes:{},waits:{},status:{},locks:{performance_schema_prepared_statements_lost:'0',innodb_row_lock_waits:'0',innodb_row_lock_time:'0',innodb_row_lock_current_waits:'0'}};
 const row={OBJECT_INSTANCE_BEGIN:'1',STATEMENT_ID:'2',SQL_TEXT:sql.slice(0,1024),COUNT_EXECUTE:'1',SUM_TIMER_EXECUTE:'1',COUNT_REPREPARE:'0',SUM_LOCK_TIME:'0',SUM_ERRORS:'0',SUM_WARNINGS:'0',SUM_ROWS_AFFECTED:'100',SUM_ROWS_EXAMINED:'5000',SUM_SELECT_SCAN:'0',SUM_NO_INDEX_USED:'0',SUM_NO_GOOD_INDEX_USED:'0'},after={...structuredClone(before),prepared:row};assert.equal(releaseSnapshotDelta(after,before,sql,1024).prepared.COUNT_EXECUTE,'1');
 for(const change of [{prepared:null},{prepared:{...row,SUM_ROWS_AFFECTED:'99'}},{prepared:{...row,COUNT_EXECUTE:'2'}},{prepared:{...row,SQL_TEXT:'different'}},{locks:{...before.locks,performance_schema_prepared_statements_lost:'1'}}])assert.throws(()=>releaseSnapshotDelta({...after,...change},before,sql,1024));
 const previous={...before,prepared:{...row,COUNT_EXECUTE:'0',SUM_ROWS_AFFECTED:'0'}};for(const field of ['STATEMENT_ID','OBJECT_INSTANCE_BEGIN'])assert.throws(()=>releaseSnapshotDelta({...after,prepared:{...row,[field]:'999'}},previous,sql,1024));
});

test('Release quiescence permits only exact observed internal daemons and never unknown activity',()=>{
 const scheduler={NAME:'thread/sql/event_scheduler',TYPE:'FOREGROUND',PROCESSLIST_USER:'event_scheduler',PROCESSLIST_COMMAND:'Daemon',PROCESSLIST_DB:null},gtid={...scheduler,NAME:'thread/sql/compress_gtid_table',PROCESSLIST_USER:null};
 assert.equal(releaseBackgroundThreads([scheduler,gtid]),true);assert.equal(releaseBackgroundThreads([gtid]),false);assert.equal(releaseBackgroundThreads([]),false);
 for(const row of [{...scheduler,NAME:'unknown'},{...scheduler,PROCESSLIST_COMMAND:'Query'},{...scheduler,PROCESSLIST_DB:'other'},{...gtid,PROCESSLIST_USER:'root'}])assert.throws(()=>releaseBackgroundThreads([row]));
});
