const classes=Object.freeze({active_list:2000,outstanding_list:2000,active_detail:2000,archive_exact:3000,archive_range:5000,archive_detail:3000});
const bounds=Object.freeze([1,5,10,25,50,100,250,500,1000,2000,3000,5000,null]);
const observations=new WeakMap();
const empty=()=>({started:0,observations:0,inFlight:0,outcomes:{success:0,error:0},durationSumMs:0,aboveThreshold:0,buckets:bounds.map(()=>0)});
function state(database){let value=observations.get(database);if(!value){value=Object.fromEntries(Object.keys(classes).map(name=>[name,empty()]));observations.set(database,value);}return value;}
// Fixed operation elapsed time, including auth/transaction/read-model work; no query text or business labels.
export async function observeSalesQuery(database,operation,work,{clock=()=>performance.now()}={}){
 if(!Object.hasOwn(classes,operation))throw new TypeError("Unknown Sales inquiry operation");
 const metric=state(database)[operation],start=clock();metric.started++;metric.inFlight++;let success=false;
 try{const value=await work();success=true;return value;}finally{const elapsed=clock()-start;metric.inFlight--;metric.observations++;metric.outcomes[success?"success":"error"]++;metric.durationSumMs+=elapsed;if(elapsed>classes[operation])metric.aboveThreshold++;metric.buckets[bounds.findIndex(bound=>bound===null||elapsed<=bound)]++;}
}
export function getSalesQueryObservations(database){return {version:1,boundsMs:[...bounds],operations:Object.entries(state(database)).map(([operation,value])=>({operation,thresholdMs:classes[operation],...value,outcomes:{...value.outcomes},buckets:[...value.buckets]}))};}
const integer=value=>{if(!Number.isSafeInteger(value)||value<0)throw new TypeError("Invalid Sales inquiry observation");return value;};
function validate(sample){
 integer(sample.atMs);const metrics=sample.metrics;if(metrics?.version!==1||!Array.isArray(metrics.boundsMs)||metrics.boundsMs.length!==bounds.length||metrics.boundsMs.some((value,i)=>value!==bounds[i])||!Array.isArray(metrics.operations)||metrics.operations.length!==Object.keys(classes).length)throw new TypeError("Invalid Sales inquiry snapshot");
 for(const [i,key]of Object.keys(classes).entries()){const value=metrics.operations[i];if(value?.operation!==key||value.thresholdMs!==classes[key]||!Array.isArray(value.buckets)||value.buckets.length!==bounds.length||!Number.isFinite(value.durationSumMs)||value.durationSumMs<0)throw new TypeError("Invalid Sales inquiry counters");for(const field of ["started","observations","inFlight","aboveThreshold"])integer(value[field]);if(integer(value.outcomes.success)+integer(value.outcomes.error)!==value.observations||value.buckets.reduce((sum,n)=>integer(sum+integer(n)),0)!==value.observations||value.started!==value.observations+value.inFlight||value.aboveThreshold>value.observations||value.observations===0&&value.durationSumMs!==0)throw new TypeError("Inconsistent Sales inquiry counters");}
 return metrics.operations;
}
export function salesQueryObservationWindow(previous,current){
 const rows=validate(current),base={deliveryCoverage:"UNKNOWN",coverage:"BASELINE",windowStartAtMs:null,windowEndAtMs:current.atMs,elapsedMs:null},baseline=()=>rows.map(row=>({operation:row.operation,thresholdMs:row.thresholdMs,lifetime:{started:row.started,observations:row.observations,inFlight:row.inFlight,outcomes:{...row.outcomes},aboveThreshold:row.aboveThreshold},samples:null,meanMs:null,p95UpperBoundMs:null,p95Censored:false,p95ThresholdExceeded:null,outcomes:null,aboveThreshold:null}));
 if(previous===null)return {...base,operations:baseline()};
 const prior=validate(previous),deltas=rows.map((row,i)=>({samples:row.observations-prior[i].observations,sum:row.durationSumMs-prior[i].durationSumMs,above:row.aboveThreshold-prior[i].aboveThreshold,buckets:row.buckets.map((n,j)=>n-prior[i].buckets[j]),outcomes:{success:row.outcomes.success-prior[i].outcomes.success,error:row.outcomes.error-prior[i].outcomes.error}}));
 if(current.atMs<=previous.atMs||deltas.some(delta=>[delta.samples,delta.sum,delta.above,...delta.buckets,...Object.values(delta.outcomes)].some(value=>value<0)))return {...base,coverage:"RESET",operations:baseline()};
 const operations=baseline().map((row,i)=>{const d=deltas[i];if(d.buckets.reduce((a,b)=>a+b,0)!==d.samples||d.outcomes.success+d.outcomes.error!==d.samples||d.above>d.samples||d.samples===0&&d.sum!==0)throw new TypeError("Inconsistent Sales inquiry interval");let bound=null,censored=false,exceeded=null;if(d.samples){const rank=Number((BigInt(d.samples)*95n+99n)/100n);let count=0;for(let n=0;n<bounds.length;n++){count+=d.buckets[n];if(count>=rank){bound=bounds[n];censored=bound===null;break;}}exceeded=d.samples-d.above<rank;}return {...row,samples:d.samples,meanMs:d.samples?d.sum/d.samples:null,p95UpperBoundMs:bound,p95Censored:censored,p95ThresholdExceeded:exceeded,outcomes:d.outcomes,aboveThreshold:d.above};});
 return {...base,coverage:"WINDOW",windowStartAtMs:previous.atMs,elapsedMs:current.atMs-previous.atMs,operations};
}
export function salesQueryObservationAlerts(window){return window.coverage!=="WINDOW"?[]:window.operations.filter(row=>row.samples>0&&row.p95ThresholdExceeded===true).map(row=>({event:"sales.alert.query_p95_exceeded",level:"warn",context:{operation:row.operation,thresholdMs:row.thresholdMs,samples:row.samples,aboveThreshold:row.aboveThreshold}}));}
