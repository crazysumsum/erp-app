// Explicit test-loader instrumentation only; production modules never import this file normally.
import {AsyncLocalStorage} from "node:async_hooks";
const active=new AsyncLocalStorage();
const bucket=()=>({entered:0,completed:0,failed:0,inFlight:0,totalMs:0,maxMs:0});
const safeCode=error=>{try{return typeof error?.code==="string"&&/^[A-Z_]{1,80}$/u.test(error.code)?error.code:null;}catch{return null;}};
const safeCodes=error=>{const seen=new Set(),codes=[];try{for(let current=error;current&&seen.size<10&&!seen.has(current);current=current.cause){seen.add(current);const code=safeCode(current);if(code&&!codes.includes(code))codes.push(code);}}catch{/* Diagnostic codes are optional; original error identity remains authoritative. */}return codes;};

export function postingSqlCategory(sql){
 if(typeof sql!=="string")return "OTHER";
 if(/^\s*SELECT\b/iu.test(sql)){
  if(/\bFROM\s+inventory_bin_locks\b/iu.test(sql)&&/\bFOR UPDATE\b/iu.test(sql))return "STOCKTAKE_LOCK_PROBE";
  if(/\bFROM\s+information_schema\.tables\b/iu.test(sql)&&sql.includes("'inventory_stocktakes'")&&sql.includes("'inventory_bin_locks'"))return "STOCKTAKE_SCHEMA_PROOF";
  if(/\bFROM\s+inventory_stock_balances b\b/iu.test(sql)&&/\bJOIN\s+inventory_bins bn\b/iu.test(sql))return "CANDIDATE_SELECT";
  if(/\bFROM\s+inventory_stock_balances\b/iu.test(sql)&&/\bFOR UPDATE\b/iu.test(sql))return "BALANCE_LOCK_SELECT";
  if(/\bFROM\s+inventory_operation_requests\b/iu.test(sql))return "OPERATION_SELECT";
  return "OTHER_SELECT";
 }
 if(/^\s*INSERT INTO inventory_stock_balances\b/iu.test(sql))return "BALANCE_UPSERT";
 if(/^\s*INSERT INTO inventory_stock_controls\b/iu.test(sql))return "CONTROL_UPSERT";
 if(/^\s*UPDATE inventory_stock_balances\b/iu.test(sql))return "BALANCE_CAS";
 if(/^\s*UPDATE inventory_reservations\b/iu.test(sql))return "RESERVATION_CAS";
 if(/^\s*INSERT INTO inventory_allocations\b/iu.test(sql))return "ALLOCATION_INSERT";
 if(/^\s*INSERT INTO inventory_audit_logs\b/iu.test(sql))return "AUDIT_INSERT";
 if(/^\s*UPDATE inventory_operation_requests\b/iu.test(sql))return "OPERATION_COMPLETE";
 return "OTHER";
}

const spanLabels=new Set(["LOCK_SCOPE","CANDIDATE_ASSESS","CANDIDATE_SELECTION","POST_BATCH","CANDIDATE_SORT","CANDIDATE_LOAD","BALANCE_LOCK","LOCK_COMMAND","RECEIPT_COMPLETE","RECEIPT_READ","AUDIT_VALUES","AUDIT_FLUSH","AUDIT_RECORD"]);
const invalid=(record)=>{if(record)record.observerInvalid=true;};
function begin(label){
 const parent=active.getStore();if(!parent)return null;
 try{
  if(!spanLabels.has(label)){invalid(parent.record);return null;}
  const entry=parent.record.spans[label]??= {...bucket(),selfMs:0,sqlCalls:0,sqlMs:0,selfSqlCalls:0,selfSqlMs:0,selfOtherMs:0,unqualifiedSelfSamples:0};
  const frame={record:parent.record,entry,parent:parent.frame,start:performance.now(),childrenMs:0,childrenSqlCalls:0,childrenSqlMs:0,sqlCalls:0,sqlMs:0,activeChildren:0,activeSql:0,overlap:false};
  entry.entered++;entry.inFlight++;
  if(frame.parent){frame.parent.activeChildren++;if(frame.parent.activeChildren>1||frame.parent.activeSql>0)frame.parent.overlap=true;}
  return {record:parent.record,frame};
 }catch{invalid(parent.record);return null;}
}
function end(store,failed){
 if(!store)return;
 const {record,frame}=store;
 try{
  const entry=frame.entry,elapsed=performance.now()-frame.start;
  if(frame.activeChildren>0||frame.activeSql>0){frame.overlap=true;invalid(record);}
  entry[failed?"failed":"completed"]++;entry.inFlight--;entry.totalMs+=elapsed;entry.maxMs=Math.max(entry.maxMs,elapsed);
  entry.sqlCalls+=frame.sqlCalls+frame.childrenSqlCalls;entry.sqlMs+=frame.sqlMs+frame.childrenSqlMs;entry.selfSqlCalls+=frame.sqlCalls;entry.selfSqlMs+=frame.sqlMs;
  if(frame.overlap){entry.unqualifiedSelfSamples++;record.overlapDetected=true;}
  else{entry.selfMs+=elapsed-frame.childrenMs;entry.selfOtherMs+=elapsed-frame.childrenMs-frame.sqlMs;}
  if(frame.parent){frame.parent.activeChildren--;frame.parent.childrenMs+=elapsed;frame.parent.childrenSqlCalls+=frame.sqlCalls+frame.childrenSqlCalls;frame.parent.childrenSqlMs+=frame.sqlMs+frame.childrenSqlMs;}
 }catch{invalid(record);}
}
export function tracePostingSync(label,work){
 const store=begin(label);if(!store)return work();
 return active.run(store,()=>{let failed=false;try{return work();}catch(error){failed=true;throw error;}finally{end(store,failed);}});
}
export function tracePostingAsync(label,work){
 const store=begin(label);if(!store)return work();
 return active.run(store,async()=>{let failed=false;try{return await work();}catch(error){failed=true;throw error;}finally{end(store,failed);}});
}

export function postingDiagnostics(t,database,parentOf){
 const records=[],restore=[],registered=new WeakMap();let omitted=0;
 t.after(()=>{
  for(const undo of restore.reverse())undo();
  t.diagnostic(JSON.stringify({postingDiagnostics:true,scope:"One instrumented Inventory owner post only",timing:"Client wall time, not server execution time; span totals include children, selfOtherMs excludes child spans and directly awaited SQL; overlap makes exclusive timings unqualified; non-SQL wall time is not pure CPU",statementScope:"No transaction-control SQL, trigger internals, SQL text, parameters or business identities",records,omitted}));
 });
 return {provider(owner,method){
  const methods=registered.get(owner)??new Set();if(methods.has(method))throw new Error("Duplicate posting diagnostic provider");methods.add(method);registered.set(owner,methods);
  const original=owner[method];
  owner[method]=function(...args){
   if(records.length===16){omitted++;return original.apply(this,args);}
   const tx=args[0],record={ordinal:records.length+1,timeoutMs:database.config?.transactionTimeoutMs,spans:{},sql:{},sqlInFlight:0,maxSqlInFlight:0,overlapDetected:false,observerInvalid:false,settled:false};records.push(record);
   if(parentOf)try{record.parent=parentOf(tx);if(!record.parent)invalid(record);}catch{invalid(record);}
   const methods=["query","execute"].map(name=>[name,tx[name]]),store={record,frame:null},started=performance.now();
   for(const [name,call]of methods)tx[name]=function(...values){
    let entry,span,start;
    try{const category=postingSqlCategory(values[0]),current=active.getStore();entry=record.sql[category]??= {...bucket(),queries:0,executes:0,returnedRows:0,affectedRows:0,rowMetricsUnavailable:0};span=current?.record===record?current.frame:null;start=performance.now();if(current&&current.record!==record)invalid(record);}
    catch{invalid(record);return call.apply(this,values);}
    entry.entered++;entry.inFlight++;entry[name==="query"?"queries":"executes"]++;record.sqlInFlight++;record.maxSqlInFlight=Math.max(record.maxSqlInFlight,record.sqlInFlight);
    if(span){span.activeSql++;if(span.activeSql>1||span.activeChildren>0)span.overlap=true;}
    const finish=(result,error)=>{try{
     const elapsed=performance.now()-start;entry.inFlight--;record.sqlInFlight--;entry.totalMs+=elapsed;entry.maxMs=Math.max(entry.maxMs,elapsed);
     if(span){span.activeSql--;span.sqlCalls++;span.sqlMs+=elapsed;}
     if(error){entry.failed++;entry.errorCode=safeCode(error);entry.errorCodes=[...new Set([...(entry.errorCodes??[]),...safeCodes(error)])];}
     else{entry.completed++;const rows=result?.[0];if(Array.isArray(rows))entry.returnedRows+=rows.length;else if(Number.isSafeInteger(rows?.affectedRows))entry.affectedRows+=rows.affectedRows;else entry.rowMetricsUnavailable++;}
    }catch{invalid(record);}};
    let result;try{result=call.apply(this,values);}catch(error){finish(undefined,error);throw error;}
    return Promise.resolve(result).then(value=>{finish(value,null);return value;},error=>{finish(undefined,error);throw error;});
   };
   const reset=()=>{for(const [name,call]of methods)tx[name]=call;};restore.push(reset);
   const finish=()=>{try{reset();record.settled=true;record.elapsedMs=performance.now()-started;record.instrumentationComplete=Boolean(record.spans.POST_BATCH);record.exclusiveTimingQualified=!record.observerInvalid&&!record.overlapDetected&&record.maxSqlInFlight<=1;}catch{invalid(record);}};
   let result;try{result=active.run(store,()=>original.apply(this,args));}catch(error){record.errorCode=safeCode(error);finish();throw error;}
   return Promise.resolve(result).then(value=>{finish();return value;},error=>{record.errorCode=safeCode(error);finish();throw error;});
  };
  restore.push(()=>{owner[method]=original;});
 }};
}
