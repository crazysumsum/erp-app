// Explicit test-loader instrumentation only; production modules never import this file normally.
import {AsyncLocalStorage} from "node:async_hooks";
const active=new AsyncLocalStorage();
const tailMarkers=new WeakMap();
const bucket=()=>({entered:0,completed:0,failed:0,inFlight:0,totalMs:0,maxMs:0});
const safeCode=error=>{try{return typeof error?.code==="string"&&/^[A-Z_]{1,80}$/u.test(error.code)?error.code:null;}catch{return null;}};
const safeCodes=error=>{const seen=new Set(),codes=[];try{for(let current=error;current&&seen.size<10&&!seen.has(current);current=current.cause){seen.add(current);const code=safeCode(current);if(code&&!codes.includes(code))codes.push(code);}}catch{/* Diagnostic codes are optional; original error identity remains authoritative. */}return codes;};

const callerSqlChecks=[
  [/^\s*UPDATE fulfillment_allocations\b/iu,"F_RELEASE_PROJECTION"],[/^\s*INSERT INTO fulfillment_allocations\b/iu,"F_NEW_PROJECTION"],
  [/^\s*UPDATE fulfillment_line_reservation_claims\b/iu,"F_CLAIM_CAS"],[/^\s*UPDATE fulfillment_lines\b/iu,"F_LINE_CAS"],
  [/^\s*UPDATE fulfillments\b/iu,"F_HEADER_CAS"],[/^\s*INSERT INTO fulfillment_status_history\b/iu,"F_HISTORY_INSERT"],
  [/^\s*INSERT INTO fulfillment_audit_logs\b/iu,"F_AUDIT_INSERT"],[/^\s*UPDATE fulfillment_operation_requests\b/iu,"F_OPERATION_COMPLETE"],
  [/^\s*INSERT INTO fulfillment_operation_requests\b/iu,"F_OPERATION_CLAIM"]];
export function postingSqlCategory(sql){
 if(typeof sql!=="string")return "OTHER";
 if(/^\s*SELECT\b/iu.test(sql)){
  if(/\bFROM\s+inventory_bin_locks\b/iu.test(sql)&&/\bFOR UPDATE\b/iu.test(sql))return "STOCKTAKE_LOCK_PROBE";
  if(/\bFROM\s+information_schema\.tables\b/iu.test(sql)&&sql.includes("'inventory_stocktakes'")&&sql.includes("'inventory_bin_locks'"))return "STOCKTAKE_SCHEMA_PROOF";
  if(/\bFROM\s+inventory_stock_balances b\b/iu.test(sql)&&/\bJOIN\s+inventory_bins bn\b/iu.test(sql))return "CANDIDATE_SELECT";
  if(/\bFROM\s+inventory_stock_balances\b/iu.test(sql)&&/\bFOR UPDATE\b/iu.test(sql))return "BALANCE_LOCK_SELECT";
  if(/\bFROM\s+inventory_operation_requests\b/iu.test(sql))return "OPERATION_SELECT";
  if(/\bFROM\s+fulfillment_operation_requests\b/iu.test(sql))return "F_OPERATION_SELECT";
  if(/\bFROM\s+fulfillment_status_history\b/iu.test(sql))return "F_HISTORY_SELECT";
  return "OTHER_SELECT";
 }
 for(const [pattern,label]of callerSqlChecks)if(pattern.test(sql))return label;
 if(/^\s*INSERT INTO inventory_stock_balances\b/iu.test(sql))return "BALANCE_UPSERT";
 if(/^\s*INSERT INTO inventory_stock_controls\b/iu.test(sql))return "CONTROL_UPSERT";
 if(/^\s*UPDATE inventory_stock_balances\b/iu.test(sql))return "BALANCE_CAS";
 if(/^\s*UPDATE inventory_reservations\b/iu.test(sql))return "RESERVATION_CAS";
 if(/^\s*INSERT INTO inventory_allocations\b/iu.test(sql))return "ALLOCATION_INSERT";
 if(/^\s*INSERT INTO inventory_audit_logs\b/iu.test(sql))return "AUDIT_INSERT";
 if(/^\s*UPDATE inventory_operation_requests\b/iu.test(sql))return "OPERATION_COMPLETE";
 return "OTHER";
}

const spanLabels=new Set(["LOCK_SCOPE","CANDIDATE_ASSESS","CANDIDATE_SELECTION","POST_BATCH","CANDIDATE_SORT","CANDIDATE_LOAD","BALANCE_LOCK","LOCK_COMMAND","RECEIPT_COMPLETE","RECEIPT_READ","AUDIT_VALUES","AUDIT_FLUSH","AUDIT_RECORD","CALLER_TRANSACTION","F_RELEASE_PROJECTIONS","F_SAVE_PROJECTIONS","F_SEQUENCE_AUDITS","F_DECODE_REALLOCATION","F_DECODE_NEW_ROWS","F_ASSERT_OWNER","F_ASSERT_SOURCE","F_OPERATION_COMPLETE_ASYNC","F_RESERVATION_CURRENT","F_OWNER_CURRENT"]);
const invalid=(record)=>{if(record)record.observerInvalid=true;};
function begin(label){
 const parent=active.getStore();if(!parent)return null;
 try{
  if(parent.record.rootLabel==="CALLER_TRANSACTION"&&label!=="CALLER_TRANSACTION"&&!parent.record.tailStarted)return null;
  if(!spanLabels.has(label)){invalid(parent.record);return null;}
  const entry=parent.record.spans[label]??= {...bucket(),selfMs:0,sqlCalls:0,sqlMs:0,selfSqlCalls:0,selfSqlMs:0,selfOtherMs:0,unqualifiedSelfSamples:0,activeStartSum:0};
  const frame={record:parent.record,entry,parent:parent.frame,start:performance.now(),childrenMs:0,childrenSqlCalls:0,childrenSqlMs:0,sqlCalls:0,sqlMs:0,activeChildren:0,activeSql:0,overlap:false};
  entry.entered++;entry.inFlight++;entry.activeStartSum+=frame.start;entry.firstOffsetMs??=frame.start-parent.started;
  if(frame.parent){frame.parent.activeChildren++;if(frame.parent.activeChildren>1||frame.parent.activeSql>0)frame.parent.overlap=true;}
  return {record:parent.record,frame,executor:parent.executor,started:parent.started};
 }catch{invalid(parent.record);return null;}
}
function end(store,failed){
 if(!store)return;
 const {record,frame}=store;
 try{
  const entry=frame.entry,elapsed=performance.now()-frame.start;
  if(frame.activeChildren>0||frame.activeSql>0){frame.overlap=true;invalid(record);}
  entry[failed?"failed":"completed"]++;entry.inFlight--;entry.activeStartSum-=frame.start;entry.lastEndOffsetMs=performance.now()-store.started;entry.totalMs+=elapsed;entry.maxMs=Math.max(entry.maxMs,elapsed);
  entry.sqlCalls+=frame.sqlCalls+frame.childrenSqlCalls;entry.sqlMs+=frame.sqlMs+frame.childrenSqlMs;entry.selfSqlCalls+=frame.sqlCalls;entry.selfSqlMs+=frame.sqlMs;
  if(frame.overlap){entry.unqualifiedSelfSamples++;record.overlapDetected=true;}
  else{entry.selfMs+=elapsed-frame.childrenMs;entry.selfOtherMs+=elapsed-frame.childrenMs-frame.sqlMs;}
  if(!frame.parent&&record.rootLabel==="CALLER_TRANSACTION"){const marker=tailMarkers.get(record);if(marker)marker.ended=performance.now();}
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

const additiveSql=["entered","completed","failed","queries","executes","returnedRows","affectedRows","rowMetricsUnavailable","totalMs"];
export function markPostingTailStart(executor){
 const store=active.getStore();if(!store||store.record.rootLabel!=="CALLER_TRANSACTION")return false;
 try{
  const {record,frame}=store;
  if(store.executor!==executor||!frame||frame.parent||record.tailStarted||frame.activeChildren||record.sqlInFlight){invalid(record);return false;}
  const started=performance.now();
  tailMarkers.set(record,{started,frame,sql:Object.fromEntries(Object.entries(record.sql).map(([key,value])=>[key,Object.fromEntries(additiveSql.map(field=>[field,value[field]??0]))])),childrenMs:frame.childrenMs,sqlMs:frame.sqlMs,sqlCalls:frame.sqlCalls});
  record.tailStarted=true;record.tailStartOffsetMs=started-store.started;return true;
 }catch{invalid(store.record);return false;}
}
function snapshotRecord(record){
 const now=performance.now(),spans=Object.fromEntries(Object.entries(record.spans).map(([key,{activeStartSum,...entry}])=>[key,{...entry,inFlightMs:entry.inFlight*now-(activeStartSum??0)}])),sqlSnapshot=Object.fromEntries(Object.entries(record.sql).map(([key,{activeStartSum,...entry}])=>[key,{...entry,inFlightMs:entry.inFlight*now-(activeStartSum??0)}])),result={...record,spans,sql:sqlSnapshot,instrumentationComplete:record.instrumentationComplete??false,exclusiveTimingQualified:record.exclusiveTimingQualified??false};
 const marker=tailMarkers.get(record);
 if(marker){
  const sql=Object.fromEntries(Object.entries(record.sql).map(([key,value])=>[key,Object.fromEntries(additiveSql.map(field=>[field,(value[field]??0)-(marker.sql[key]?.[field]??0)]))]));
  const elapsedMs=(marker.ended??now)-marker.started,childMs=marker.frame.childrenMs-marker.childrenMs,directSqlMs=marker.frame.sqlMs-marker.sqlMs;
  result.tail={elapsedMs,callbackSpanSettled:marker.ended!==undefined,childMs,directSqlMs,directSqlCalls:marker.frame.sqlCalls-marker.sqlCalls,otherWallMs:elapsedMs-childMs-directSqlMs,sql,qualified:Boolean(record.instrumentationComplete&&!record.observerInvalid&&!record.overlapDetected&&record.sqlInFlight===0&&marker.ended!==undefined)};
 }
 return result;
}
export function postingDiagnostics(t,database,parentOf,{rootLabel="POST_BATCH",scope="One instrumented Inventory owner post only"}={}){
 const records=[],restore=[],registered=new WeakMap();let omitted=0;
 t.after(()=>{
  for(const undo of restore.reverse())undo();
  t.diagnostic(JSON.stringify({postingDiagnostics:true,scope,timing:"Client wall time, not server execution time; span totals include children, selfOtherMs excludes child spans and directly awaited SQL; overlap makes exclusive timings unqualified; non-SQL wall time is not pure CPU",statementScope:"No transaction-control SQL, trigger internals, SQL text, parameters or business identities",records:records.map(snapshotRecord),omitted}));
 });
 return {provider(owner,method){
  const methods=registered.get(owner)??new Set();if(methods.has(method))throw new Error("Duplicate posting diagnostic provider");methods.add(method);registered.set(owner,methods);
  const original=owner[method];
  owner[method]=function(...args){
   if(records.length===16){omitted++;return original.apply(this,args);}
   const tx=args[0],record={...(rootLabel==="POST_BATCH"?{}:{rootLabel}),ordinal:records.length+1,timeoutMs:database.config?.transactionTimeoutMs,spans:{},sql:{},sqlInFlight:0,maxSqlInFlight:0,overlapDetected:false,observerInvalid:false,settled:false};records.push(record);
   if(parentOf)try{record.parent=parentOf(tx);if(!record.parent)invalid(record);if(rootLabel==="CALLER_TRANSACTION")record.timeoutMs=record.parent?.timeoutMs;}catch{invalid(record);}
   const methods=["query","execute"].map(name=>[name,tx[name]]),started=performance.now(),store={record,frame:null,executor:tx,started};
   for(const [name,call]of methods)tx[name]=function(...values){
    let entry,span,start;
    try{const category=postingSqlCategory(values[0]),current=active.getStore();entry=record.sql[category]??= {...bucket(),queries:0,executes:0,returnedRows:0,affectedRows:0,rowMetricsUnavailable:0,activeStartSum:0};span=current?.record===record?current.frame:null;start=performance.now();if(current&&current.record!==record)invalid(record);}
    catch{invalid(record);return call.apply(this,values);}
    entry.entered++;entry.inFlight++;entry.activeStartSum+=start;entry[name==="query"?"queries":"executes"]++;record.sqlInFlight++;record.maxSqlInFlight=Math.max(record.maxSqlInFlight,record.sqlInFlight);
    if(span){span.activeSql++;if(span.activeSql>1||span.activeChildren>0)span.overlap=true;}
    const finish=(result,error)=>{try{
     const elapsed=performance.now()-start;entry.inFlight--;entry.activeStartSum-=start;record.sqlInFlight--;entry.totalMs+=elapsed;entry.maxMs=Math.max(entry.maxMs,elapsed);
     if(span){span.activeSql--;span.sqlCalls++;span.sqlMs+=elapsed;}
     if(error){entry.failed++;entry.errorCode=safeCode(error);entry.errorCodes=[...new Set([...(entry.errorCodes??[]),...safeCodes(error)])];}
     else{entry.completed++;const rows=result?.[0];if(Array.isArray(rows))entry.returnedRows+=rows.length;else if(Number.isSafeInteger(rows?.affectedRows))entry.affectedRows+=rows.affectedRows;else entry.rowMetricsUnavailable++;}
    }catch{invalid(record);}};
    let result;try{result=call.apply(this,values);}catch(error){finish(undefined,error);throw error;}
    return Promise.resolve(result).then(value=>{finish(value,null);return value;},error=>{finish(undefined,error);throw error;});
   };
   const reset=()=>{for(const [name,call]of methods)tx[name]=call;};restore.push(reset);
   const finish=()=>{try{reset();record.settled=true;record.elapsedMs=performance.now()-started;record.instrumentationComplete=Boolean(record.spans[rootLabel]);record.exclusiveTimingQualified=!record.observerInvalid&&!record.overlapDetected&&record.maxSqlInFlight<=1;}catch{invalid(record);}};
   let result;try{result=active.run(store,()=>original.apply(this,args));}catch(error){record.errorCode=safeCode(error);finish();throw error;}
   return Promise.resolve(result).then(value=>{finish();return value;},error=>{record.errorCode=safeCode(error);finish();throw error;});
  };
  restore.push(()=>{owner[method]=original;});
 }};
}
