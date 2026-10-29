// Test-only, bounded client-statement diagnostics; no SQL text or parameters are retained.
const code=error=>typeof error?.code==="string"&&/^[A-Z_]{1,80}$/u.test(error.code)?error.code:null;
const errorCodes=error=>{const seen=new Set(),codes=[];for(let current=error;current&&seen.size<10&&!seen.has(current);current=current.cause){seen.add(current);const value=code(current);if(value&&!codes.includes(value))codes.push(value);}return codes;};
const httpRoutes=[
 {method:"POST",path:"/api/v1/fulfillments/:id/allocate",handler:"allocateFulfillment",phase:"HTTP_ALLOCATE"},
 {method:"POST",path:"/api/v1/fulfillments/:id/reallocate",handler:"reallocateFulfillment",phase:"HTTP_REALLOCATE"},
 {method:"POST",path:"/api/v1/fulfillments/:id/pick-confirm",handler:"pickConfirmFulfillment",phase:"HTTP_PICK"}
];
const bucket=()=>({entered:0,completed:0,failed:0,inFlight:0,totalMs:0,activeStartSum:0});
export function capacityDiagnostics(t,database,scope="FIXTURE_DATABASE"){
 const transactions=[],phases={},providers={},restore=[],records=new WeakMap(),registered=new WeakMap(),original=database.withTransaction;let activePhase="UNLABELLED",omittedTransactions=0;
 const timed=async(collection,label,work)=>{const entry=collection[label]??=bucket(),start=performance.now();entry.entered++;entry.inFlight++;entry.activeStartSum+=start;try{const value=await work();entry.completed++;return value;}catch(error){entry.failed++;throw error;}finally{entry.inFlight--;entry.activeStartSum-=start;entry.totalMs+=performance.now()-start;}};
 database.withTransaction=function(work,...options){
  const registered=scope==="HTTP_APPLICATION_DATABASE"?database.context?.get()?.apiRoute:null,route=registered?httpRoutes.find(row=>row.method===registered.method&&row.path===registered.path&&row.handler===registered.handler):null;
  const start=performance.now(),record={phase:scope==="HTTP_APPLICATION_DATABASE"?(route?.phase??"BACKGROUND_OR_UNBOUND"):activePhase,windowPhase:activePhase,...(route?{requestRoute:{method:route.method,path:route.path,handler:route.handler}}:{}),ordinal:transactions.length+omittedTransactions+1,timeoutMs:options[0]?.timeoutMs??database.config?.transactionTimeoutMs,queries:0,executes:0,families:{},callbackStarted:false,callbackSettled:false,promiseSettled:false};
  if(transactions.length<128)transactions.push(record);else omittedTransactions++;
  const callback=async(transaction,...context)=>{
   record.callbackStarted=true;records.set(transaction,record);const methods=[];
   for(const method of ["query","execute"]){const call=transaction[method];methods.push([method,call]);transaction[method]=function(...args){record[method==="query"?"queries":"executes"]++;const verb=typeof args[0]==="string"?/^\s*(SELECT|INSERT|UPDATE|DELETE|SHOW|WITH)\b/iu.exec(args[0])?.[1]?.toUpperCase():null,family=verb??"OTHER";record.families[family]=(record.families[family]??0)+1;return call.apply(this,args);};}
   try{return await work(transaction,...context);}finally{record.callbackSettled=true;record.callbackMs=performance.now()-start;for(const [method,call]of methods)transaction[method]=call;}
  };
  let result;try{result=original.call(this,callback,...options);}catch(error){record.promiseSettled=true;record.elapsedMs=performance.now()-start;record.errorCode=code(error);record.errorCodes=errorCodes(error);throw error;}
  return Promise.resolve(result).then(value=>{record.promiseSettled=true;record.elapsedMs=performance.now()-start;return value;},error=>{record.promiseSettled=true;record.elapsedMs=performance.now()-start;record.errorCode=code(error);record.errorCodes=errorCodes(error);throw error;});
 };
 restore.push(()=>{database.withTransaction=original;});
 const snapshot=collection=>Object.fromEntries(Object.entries(collection).map(([label,{activeStartSum,...entry}])=>[label,{...entry,inFlightMs:entry.inFlight*performance.now()-activeStartSum}]));
 t.after(()=>{for(const undo of restore.reverse())undo();t.diagnostic(JSON.stringify({capacityDiagnostics:true,scope,statementScope:"Instrumented actual executor client calls only; excludes framework transaction control, trigger internals and other database instances",providerTiming:"Inclusive nested timings; do not sum",transactions,omittedTransactions,phases:snapshot(phases),providers:snapshot(providers)}));});
 return{
  transactionInfo(transaction){const record=records.get(transaction);return record?{ordinal:record.ordinal,phase:record.phase,timeoutMs:record.timeoutMs}:null;},
  async phase(label,work){const previous=activePhase;activePhase=label;try{return await timed(phases,label,work);}finally{activePhase=previous;}},
  provider(object,method,label){const methods=registered.get(object)??new Set();if(methods.has(method))throw new Error("Duplicate capacity provider diagnostic");methods.add(method);registered.set(object,methods);const call=object[method];object[method]=function(...args){const key=`${activePhase}:${label}`,record=records.get(args[0]),queries=record?.queries??0,executes=record?.executes??0;return timed(providers,key,async()=>{try{return await call.apply(this,args);}finally{const entry=providers[key];entry.queries=(entry.queries??0)+(record?record.queries-queries:0);entry.executes=(entry.executes??0)+(record?record.executes-executes:0);}});};restore.push(()=>{object[method]=call;});}
 };
}
export function isInjectedCapacityFailure(error,marker){
 const chain=[];for(let current=error;current&&chain.length<10&&!chain.includes(current);current=current.cause)chain.push(current);
 if(chain.some(entry=>entry.code==="DATABASE_TRANSACTION_TIMEOUT"))return false;
 return chain.some(entry=>entry.sqlState==="45000"&&entry.code==="ER_SIGNAL_EXCEPTION"&&entry.errno===1644&&entry.sqlMessage===marker);
}
