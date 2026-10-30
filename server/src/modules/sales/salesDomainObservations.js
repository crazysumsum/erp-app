const operations=['create_order','create_quotation','convert_quotation','confirm_order','archive_order'];
const bounds=[1,5,10,25,50,100,250,500,1000,2000,3000,5000,10000,30000,60000,300000,null];
const faults=new WeakMap(),faultNames=["transaction_unknown","deadlock","provider_mismatch"];
export function recordSalesDomainFault(database,fault){if(!faultNames.includes(fault))throw new TypeError("Unknown Sales domain fault");let counters=faults.get(database);if(!counters){counters=Object.fromEntries(faultNames.map(name=>[name,0]));faults.set(database,counters);}counters[fault]++;}
const outcomes=['success','error','unknown','archived','skipped','failed'],observations=new WeakMap();
function state(database){let value=observations.get(database);if(!value){value=Object.fromEntries(operations.map(operation=>[operation,{observations:0,durationSumMs:0,deadlocks:0,outcomes:Object.fromEntries(outcomes.map(outcome=>[outcome,0])),buckets:bounds.map(()=>0)}]));observations.set(database,value);}return value;}
// Process-lifetime observations only. Fixed labels and storage; no SQL, payloads, IDs or delivery/window claims.
export function recordSalesDomainDuration(database,operation,outcome,elapsedMs,{deadlock=false}={}){
 if(!operations.includes(operation)||!outcomes.includes(outcome))throw new TypeError('Unknown Sales domain observation');
 if(!Number.isFinite(elapsedMs)||elapsedMs<0)return false;
 const row=state(database)[operation];row.observations++;row.durationSumMs+=elapsedMs;row.outcomes[outcome]++;if(deadlock)row.deadlocks++;row.buckets[bounds.findIndex(bound=>bound===null||elapsedMs<=bound)]++;return true;
}
export async function observeSalesDomain(database,operation,work,{clock=()=>performance.now()}={}){
 if(!operations.includes(operation))throw new TypeError('Unknown Sales domain observation');
 const start=clock();let outcome='error',deadlock=false;
 try{const result=await work();outcome=operation==='archive_order'&&['ARCHIVED','SKIPPED','FAILED'].includes(result?.outcome)?result.outcome.toLowerCase():'success';return result;}
 catch(error){if(['DATABASE_TRANSACTION_INDETERMINATE','TRANSACTION_OUTCOME_UNKNOWN'].includes(error?.code))outcome='unknown';deadlock=(error?.cause?.code??error?.code)==='ER_LOCK_DEADLOCK';throw error;}
 finally{recordSalesDomainDuration(database,operation,outcome,clock()-start,{deadlock});}
}
export function getSalesDomainObservations(database){return {version:'1',coverage:'PROCESS_LIFETIME',deliveryCoverage:'UNKNOWN',faults:{...Object.fromEntries(faultNames.map(name=>[name,0])),...faults.get(database)},boundsMs:[...bounds],operations:Object.entries(state(database)).map(([operation,row])=>({operation,...row,outcomes:{...row.outcomes},buckets:[...row.buckets]}))};}
