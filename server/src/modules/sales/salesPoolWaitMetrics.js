const outcomeKeys=["acquired","timeout","aborted","rejected"];
const integer=n=>{if(!Number.isSafeInteger(n)||n<0)throw new TypeError("Invalid pool observation count");return n;};
const duration=n=>{if(!Number.isFinite(n)||n<0)throw new TypeError("Invalid pool observation duration");return n;};
function validate(sample){
 integer(sample.atMs);const m=sample.metrics;integer(m.inFlight);integer(m.observations);integer(m.aboveThreshold);duration(m.durationSumMs);duration(m.maxDurationMs);
 if(m.thresholdMs!==null&&(!Number.isSafeInteger(m.thresholdMs)||m.thresholdMs<=0))throw new TypeError("Invalid pool observation threshold");
 if(!Array.isArray(m.buckets)||!Array.isArray(m.boundsMs)||m.buckets.length!==13||m.boundsMs.length!==13||m.boundsMs[12]!==null)throw new TypeError("Invalid pool observation histogram");
 for(let i=0;i<12;i++)if(!Number.isFinite(m.boundsMs[i])||m.boundsMs[i]<=0||i>0&&m.boundsMs[i]<=m.boundsMs[i-1])throw new TypeError("Invalid pool observation bound");
 if(m.buckets.reduce((sum,n)=>integer(sum+integer(n)),0)!==m.observations||outcomeKeys.reduce((sum,key)=>integer(sum+integer(m.outcomes[key])),0)!==m.observations||m.aboveThreshold>m.observations||m.maxDurationMs>m.durationSumMs||m.observations===0&&m.durationSumMs!==0)throw new TypeError("Inconsistent pool observation");
 return m;
}
// Instance executor only. Completed caller waits include cancellation/failure; histogram estimates are upper bounds.
export function salesPoolWaitWindow(previous,current){
 const m=validate(current),lifetime={observations:m.observations,outcomes:Object.fromEntries(outcomeKeys.map(key=>[key,m.outcomes[key]])),aboveThreshold:m.aboveThreshold},result={deliveryCoverage:"UNKNOWN",lifetime,windowStartAtMs:null,windowEndAtMs:current.atMs,coverage:"BASELINE",elapsedMs:null,samples:null,inFlight:m.inFlight,meanMs:null,p95UpperBoundMs:null,p95Censored:false,outcomes:null,aboveThreshold:null,thresholdMs:m.thresholdMs};
 if(previous===null)return result;
 const p=validate(previous),deltas=m.buckets.map((n,i)=>n-p.buckets[i]),outcomes=Object.fromEntries(outcomeKeys.map(key=>[key,m.outcomes[key]-p.outcomes[key]])),samples=m.observations-p.observations,sum=m.durationSumMs-p.durationSumMs,above=m.aboveThreshold-p.aboveThreshold;
 if(current.atMs<=previous.atMs||m.thresholdMs!==p.thresholdMs||m.boundsMs.some((n,i)=>n!==p.boundsMs[i])||[samples,sum,above,...deltas,...Object.values(outcomes)].some(n=>n<0))return {...result,coverage:"RESET"};
 if(deltas.reduce((a,b)=>a+b,0)!==samples||Object.values(outcomes).reduce((a,b)=>a+b,0)!==samples||above>samples||samples===0&&sum!==0)throw new TypeError("Inconsistent pool observation interval");
 let bound=null,censored=false;
 if(samples){const rank=Number((BigInt(samples)*95n+99n)/100n);let cumulative=0;for(let i=0;i<deltas.length;i++){cumulative+=deltas[i];if(cumulative>=rank){bound=m.boundsMs[i];censored=bound===null;break;}}}
 return {...result,windowStartAtMs:previous.atMs,coverage:"WINDOW",elapsedMs:current.atMs-previous.atMs,samples,meanMs:samples?sum/samples:null,p95UpperBoundMs:bound,p95Censored:censored,outcomes,aboveThreshold:above};
}
export function salesPoolWaitAlerts(window){
 if(window.coverage!=="WINDOW"||window.samples===0)return [{event:"sales.alert.pool_wait_coverage_unobserved",level:"warn",context:{}}];
 const alerts=[],failures=integer(integer(window.outcomes.timeout)+integer(window.outcomes.rejected));integer(window.aboveThreshold);
 if(failures)alerts.push({event:"sales.alert.pool_capacity_failed",level:"error",context:{count:failures,samples:window.samples}});
 if(window.aboveThreshold&&window.thresholdMs!==null)alerts.push({event:"sales.alert.pool_wait_threshold_exceeded",level:"warn",context:{count:window.aboveThreshold,thresholdMs:window.thresholdMs,samples:window.samples}});
 return alerts;
}
