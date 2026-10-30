import {recordSalesDomainFault} from './salesDomainObservations.js';
const staged=new WeakMap(),observed=new WeakMap(),kinds=['CONFIRMATION','BACKORDER'],sources=['CSV','CHANNEL'],intakeKinds=['received','accepted','invalid','duplicate','succeeded','failed','retried'];
const bounds=[10,100,1000,5000,30000,60000,300000,600000,1800000,null],zeros=names=>Object.fromEntries(names.map(name=>[name,0n]));
const empty=()=>({reservation:Object.fromEntries(kinds.map(kind=>[kind,{requested:0n,reserved:0n,backordered:0n}])),intake:Object.fromEntries(sources.map(source=>[source,zeros(intakeKinds)])),channel:zeros(['accepted','duplicate','invalid','retry','error']),unknown:0n,allocation:{samples:0n,unobservedClocks:0n,durationSumMs:0,buckets:bounds.map(()=>0n)}});
function state(database){let value=observed.get(database);if(!value){value=empty();observed.set(database,value);}return value;}
function pending(tx){let value=staged.get(tx);if(!value){value={...empty(),allocationPriorityAt:null};staged.set(tx,value);}return value;}
const quantity=value=>{if(!Number.isSafeInteger(value)||value<0)throw new TypeError('Invalid Sales transaction observation');return BigInt(value);};
export function stageSalesReservation(tx,kind,lines){
 if(!kinds.includes(kind)||!Array.isArray(lines)||lines.length<1||lines.length>100)throw new TypeError('Invalid Sales reservation observation');
 const total=pending(tx).reservation[kind];for(const line of lines){const requested=quantity(line.orderedBaseQuantity),reserved=quantity(line.reservedBaseQuantity),backordered=quantity(line.uncoveredBaseQuantity);if(requested!==reserved+backordered)throw new TypeError('Invalid Sales reservation observation');total.requested+=requested;total.reserved+=reserved;total.backordered+=backordered;}
}
export function stageSalesAllocation(tx,priorityAtMs){pending(tx).allocationPriorityAt=Number(priorityAtMs);}
export function stageSalesIntake(tx,source,kind,count=1){if(!sources.includes(source)||!intakeKinds.includes(kind))throw new TypeError('Invalid Sales Intake observation');pending(tx).intake[source][kind]+=quantity(count);}
function commit(database,tx,clock){
 const next=staged.get(tx);if(!next)return;const current=state(database);
 for(const kind of kinds)for(const field of ['requested','reserved','backordered'])current.reservation[kind][field]+=next.reservation[kind][field];
 for(const source of sources)for(const kind of intakeKinds)current.intake[source][kind]+=next.intake[source][kind];
 if(next.allocationPriorityAt!==null){let now;try{now=clock?.();}catch{now=null;}const elapsed=now-next.allocationPriorityAt;
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(next.allocationPriorityAt)||next.allocationPriorityAt<0||elapsed<0)current.allocation.unobservedClocks++;
  else{current.allocation.samples++;current.allocation.durationSumMs+=elapsed;current.allocation.buckets[bounds.findIndex(bound=>bound===null||elapsed<=bound)]++;}
 }
}
// Fixed local counters only: no business SQL/logging, durable-delivery or complete-process-history claim.
export async function runObservedSalesTransaction(database,work,options,{clock,propagatedError}={}){
 let tx;
 try{const result=await database.withTransaction((connection,...args)=>{tx=connection;staged.delete(tx);return work(connection,...args);},options);commit(database,tx,clock);return result;}
 catch(error){if(error!==propagatedError){if(error?.code==='DATABASE_TRANSACTION_INDETERMINATE'){state(database).unknown++;recordSalesDomainFault(database,'transaction_unknown');}if((error?.cause?.code??error?.code)==='ER_LOCK_DEADLOCK')recordSalesDomainFault(database,'deadlock');if(error?.code==='INVENTORY_CONTRACT_MISMATCH')recordSalesDomainFault(database,'provider_mismatch');}throw error;}
 finally{if(tx)staged.delete(tx);}
}
export async function observeSalesChannelSubmission(database,work){
 let outcome='error';try{const result=await work();outcome=({ACCEPTED:'accepted',DUPLICATE:'duplicate',VALIDATION_FAILED:'invalid',TECHNICAL_RETRY:'retry'})[result?.outcome]??'error';return result;}finally{state(database).channel[outcome]++;}
}
export function getSalesTransactionObservations(database){
 const value=state(database),strings=object=>Object.fromEntries(Object.entries(object).map(([key,count])=>[key,String(count)]));
 return {version:'1',coverage:'ACKNOWLEDGED_COMMITS_ONLY',deliveryCoverage:'UNKNOWN',unknownCommitCount:String(value.unknown),reservationAttempts:kinds.map(kind=>({kind,requestedBaseQuantity:String(value.reservation[kind].requested),reservedBaseQuantity:String(value.reservation[kind].reserved),backorderedBaseQuantity:String(value.reservation[kind].backordered)})),intakeRecords:Object.fromEntries(sources.map(source=>[source,strings(value.intake[source])])),channelSubmissionRequests:strings(value.channel),successfulAllocationLatency:{samples:String(value.allocation.samples),unobservedClocks:String(value.allocation.unobservedClocks),durationSumMs:value.allocation.durationSumMs,boundsMs:[...bounds],buckets:value.allocation.buckets.map(String)},interpretation:'Process-lifetime acknowledged fresh transaction attempts; repeated outstanding requests are not unique demand/net backlog. Intake received/validated-accepted/terminal/retried records are distinct from Channel submission requests, including early validation and technical retries. Allocation latency: oldest-demand priority to acknowledged positive allocation commit. Missing/unknown acknowledgements do not contribute successful samples.'};
}
