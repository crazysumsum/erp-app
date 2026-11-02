const MINUTE=60000,DAY=86400000;
export const SALES_METRIC_THRESHOLDS=Object.freeze({confirmationAgeMs:5*MINUTE,intakeAgeMs:10*MINUTE,standardImportMs:30*MINUTE,backorderSuccessAgeMs:DAY});
const count=value=>{if(!Number.isSafeInteger(value)||value<0)throw new TypeError("Invalid Sales operational metric");return value;};
const age=value=>value===null?null:count(value);

// Queue signals only. Query latency, engine rows examined and pool waits require their own real observation sources.
export function salesQueueAlerts(metrics){
 const c=metrics.confirmation,i=metrics.intake,b=metrics.backorder,a=metrics.archive,r=metrics.recovery;
 for(const value of [c.pending,c.brokenBindings,i.pending,metrics.imports.overdueStandardBatches,metrics.imports.unobservedStandardBatches,b.open,a.failed,a.providerUnknown,a.hashConflicts])count(value);
 for(const value of [c.oldestAgeMs,i.oldestAgeMs,b.oldestAgeMs,b.lastSuccessAgeMs,r.consecutiveFailures])age(value);
 if(typeof b.historyComplete!=="boolean")throw new TypeError("Invalid Backorder history coverage");
 if(typeof a.enabled!=="boolean"||a.windowOverdue!==null&&typeof a.windowOverdue!=="boolean")throw new TypeError("Invalid Archive operational observation");
 const result=[],add=(event,level,context)=>result.push({event:"sales.alert."+event,level,context});
 if(c.pending&&c.oldestAgeMs===null)add("confirmation_age_unobserved","warn",{pending:c.pending});
 if(c.oldestAgeMs!==null&&c.oldestAgeMs>SALES_METRIC_THRESHOLDS.confirmationAgeMs)add("confirmation_overdue","error",{pending:c.pending,oldestAgeMs:c.oldestAgeMs,thresholdMs:SALES_METRIC_THRESHOLDS.confirmationAgeMs});
 if(c.brokenBindings)add("confirmation_binding_mismatch","error",{count:c.brokenBindings});
 if(r.consecutiveFailures===null)add("recovery_history_unobserved","warn",{});
 else if(r.consecutiveFailures>=2)add("confirmation_recovery_failed","error",{consecutiveFailures:r.consecutiveFailures});
 if(i.pending&&i.oldestAgeMs===null)add("intake_age_unobserved","warn",{pending:i.pending});
 if(i.oldestAgeMs!==null&&i.oldestAgeMs>SALES_METRIC_THRESHOLDS.intakeAgeMs)add("intake_overdue","error",{pending:i.pending,oldestAgeMs:i.oldestAgeMs,thresholdMs:SALES_METRIC_THRESHOLDS.intakeAgeMs});
 if(metrics.imports.unobservedStandardBatches)add("import_batch_time_unobserved","warn",{count:metrics.imports.unobservedStandardBatches});
 if(metrics.imports.overdueStandardBatches)add("import_batch_overdue","error",{count:metrics.imports.overdueStandardBatches,thresholdMs:SALES_METRIC_THRESHOLDS.standardImportMs});
 if(b.historyComplete&&b.noSuccessOver24h===true)add("backorder_job_overdue","error",{lastSuccessAgeMs:b.lastSuccessAgeMs,thresholdMs:SALES_METRIC_THRESHOLDS.backorderSuccessAgeMs,historyComplete:true});
 else if(b.lastSuccessAgeMs===null||!b.historyComplete&&b.lastSuccessAgeMs>SALES_METRIC_THRESHOLDS.backorderSuccessAgeMs)add("backorder_success_unobserved","warn",{});
 else if(b.lastSuccessAgeMs>SALES_METRIC_THRESHOLDS.backorderSuccessAgeMs)add("backorder_job_overdue","error",{lastSuccessAgeMs:b.lastSuccessAgeMs,thresholdMs:SALES_METRIC_THRESHOLDS.backorderSuccessAgeMs});
 if(a.enabled&&a.windowOverdue===null)add("archive_window_unobserved","warn",{});
 else if(a.enabled&&a.windowOverdue)add("archive_window_overdue","error",{graceMs:DAY});
 if(a.failed)add("archive_failed","error",{count:a.failed});
 if(a.hashConflicts)add("archive_hash_conflict","error",{count:a.hashConflicts});
 // This is a current UNKNOWN signal; no claim of persistence from a single sample.
 if(a.providerUnknown)add("archive_provider_unknown","warn",{count:a.providerUnknown});
 return result;
}


const sqlCount=value=>{if(typeof value!=="number"&&!(typeof value==="string"&&/^(0|[1-9][0-9]*)$/u.test(value)))throw new TypeError("Invalid Sales metric reading");return count(Number(value));};
const ageAt=(now,value)=>{if(value===null)return null;const at=sqlCount(value);return at>now?null:now-at;};
function archiveWindowFor(year,month,config){
 const first=new Date(Date.UTC(year,month,1)),y=first.getUTCFullYear(),m=first.getUTCMonth(),day=config.archiveDayOfMonth??2,hour=config.archiveHourHkt??2;
 if(!Number.isSafeInteger(day)||day<1||day>31||!Number.isSafeInteger(hour)||hour<0||hour>23)throw new TypeError("Invalid Archive metric calendar");
 if(day>new Date(Date.UTC(y,m+1,0)).getUTCDate())return null;
 return {periodKey:`${y}${String(m+1).padStart(2,"0")}`,deadline:Date.UTC(y,m,day,hour+1)-28800000+DAY};
}
function archiveDeadline(now,config){
 const hkt=new Date(now+28800000);
 // Include last month's window when its grace crosses a month/year boundary. Do not invent day31 in a shorter month.
 for(let offset=0;offset<4;offset++){const window=archiveWindowFor(hkt.getUTCFullYear(),hkt.getUTCMonth()-offset,config);if(window&&window.deadline<=now)return window;}
 throw new TypeError("Archive observation window unavailable");
}

// Internal readonly operational snapshot, not a business repair/provider or public API.
export async function collectSalesQueueMetrics({database,nowMs,archiveEnabled,config={},statsFreshnessMs,signal}={}){
 count(nowMs);if(typeof archiveEnabled!=="boolean")throw new TypeError("Explicit Archive enabled state required");
 signal?.throwIfAborted();if(database.context?.get()?.databaseTransaction)throw new TypeError("Sales metrics require their own readonly snapshot");
 const calendar=archiveDeadline(nowMs,config);
 const freshness=statsFreshnessMs===undefined?null:count(statsFreshnessMs);if(freshness===0)throw new TypeError("Invalid scheduler metric freshness");
 return database.withTransaction(async tx=>{
  const one=async(sql,parameters=[])=>{signal?.throwIfAborted();const [[row]]=await tx.query(sql,parameters,{signal});if(!row)throw new TypeError("Missing Sales metric reading");return row;};
  const confirmation=await one(`SELECT COUNT(*) AS pending,MIN(r.created_at) AS oldest_at,
   COALESCE(SUM(r.id IS NULL OR r.command_type<>'CONFIRM_ORDER' OR r.target_type<>'SALES_ORDER' OR NOT(r.target_id<=>s.id) OR r.status<>'IN_PROGRESS'),0) AS broken
   FROM sales_orders s LEFT JOIN sales_operation_requests r ON r.event_id=s.confirmation_event_id WHERE s.status='CONFIRMING'`);
  const intake=await one(`SELECT COUNT(*) AS pending,
   MIN(CASE WHEN i.source_type='CSV' THEN j.confirmed_at ELSE i.created_at END) AS oldest_at,
   COALESCE(SUM(i.source_type='CSV' AND j.confirmed_at IS NULL),0) AS unknown_count
   FROM sales_intake_orders i LEFT JOIN sales_import_jobs j ON j.id=i.import_job_id WHERE i.status IN ('QUEUED','PROCESSING')`);
  const imports=await one(`SELECT COALESCE(SUM(started_at<=? AND CAST(? AS DECIMAL(20,0))-CAST(started_at AS DECIMAL(20,0))>?),0) AS overdue,
   COALESCE(SUM(started_at IS NULL OR started_at>?),0) AS unobserved
   FROM (SELECT COALESCE(processing_started_at,confirmed_at) AS started_at FROM sales_import_jobs
   WHERE status IN ('QUEUED','PROCESSING') AND source_order_count=10000) j`,[nowMs,nowMs,SALES_METRIC_THRESHOLDS.standardImportMs,nowMs]);
  const backorder=await one("SELECT COUNT(*) AS open_count,MIN(priority_at) AS oldest_at FROM sales_backorder_entries WHERE status='OPEN'");
  const exports=await one("SELECT COUNT(*) AS pending,MIN(created_at) AS oldest_at FROM sales_export_jobs WHERE status IN ('QUEUED','PROCESSING')");
  const success=await one("SELECT MAX(last_success_at) AS observed_success_at FROM fr_job_stats WHERE job_name='sales.backorderAllocate'");
  // Publisher freshness is DB-clock seconds; completion ages are instance-clock milliseconds.
  const [recovery]=freshness===null?[[]]:await tx.query("SELECT consecutive_failures FROM fr_job_stats WHERE job_name='sales.confirmationRecovery' AND last_finished_at IS NOT NULL AND updated_at>UNIX_TIMESTAMP()-? AND updated_at<=UNIX_TIMESTAMP() AND last_finished_at<=? ORDER BY last_finished_at DESC LIMIT 1",[Math.max(1,Math.ceil(freshness/1000)),nowMs],{signal});
  const [batches]=await tx.query("SELECT status,period_key,failed_count,checksum_summary FROM sales_archive_batches WHERE status IN ('RUNNING','PARTIAL','FAILED') OR period_key=?",[calendar.periodKey],{signal});
  let failed=0,providerUnknown=0,hashConflicts=0,complete=false,olderOverdue=false,unknownWindow=false;
  for(const batch of batches){
   if(batch.period_key===calendar.periodKey&&batch.status==="COMPLETED")complete=true;
   if(batch.status==="COMPLETED")continue;
   if(typeof batch.period_key!=="string"||!/^\d{4}(0[1-9]|1[0-2])$/u.test(batch.period_key))throw new TypeError("Invalid Archive metric period");
   const window=archiveWindowFor(Number(batch.period_key.slice(0,4)),Number(batch.period_key.slice(4))-1,config);
   if(window===null)unknownWindow=true;else if(nowMs>window.deadline)olderOverdue=true;
   failed=count(failed+sqlCount(batch.failed_count));
   const summary=typeof batch.checksum_summary==="string"?JSON.parse(batch.checksum_summary):batch.checksum_summary;
   if(summary!==null&&(!Array.isArray(summary?.pending)||summary.pending.length>500))throw new TypeError("Invalid Archive operational summary");
   for(const item of summary?.pending??[]){if(item.code==="OPEN_MATTER_UNKNOWN")providerUnknown++;if(item.code==="ARCHIVE_DATA_CONFLICT")hashConflicts++;}
  }
  signal?.throwIfAborted();
  return {confirmation:{pending:sqlCount(confirmation.pending),oldestAgeMs:ageAt(nowMs,confirmation.oldest_at),brokenBindings:sqlCount(confirmation.broken)},
   intake:{pending:sqlCount(intake.pending),oldestAgeMs:sqlCount(intake.unknown_count)>0?null:ageAt(nowMs,intake.oldest_at)},
   imports:{overdueStandardBatches:sqlCount(imports.overdue),unobservedStandardBatches:sqlCount(imports.unobserved)},
   backorder:{open:sqlCount(backorder.open_count),oldestAgeMs:ageAt(nowMs,backorder.oldest_at),lastSuccessAgeMs:ageAt(nowMs,success.observed_success_at),historyComplete:false},
   exports:{pending:sqlCount(exports.pending),oldestAgeMs:ageAt(nowMs,exports.oldest_at)},
   recovery:{consecutiveFailures:recovery.length?sqlCount(recovery[0].consecutive_failures):null},
   archive:{enabled:archiveEnabled,observedPeriodKey:calendar.periodKey,windowOverdue:olderOverdue||!complete&&nowMs>calendar.deadline?true:unknownWindow?null:false,failed,providerUnknown,hashConflicts}};
 },{isolationLevel:"REPEATABLE READ",signal});
}
