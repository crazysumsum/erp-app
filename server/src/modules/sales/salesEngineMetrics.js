// MySQL26.7 statement LOCK_TIME is table-lock time in ps; Innodb_row_lock_time is instance-wide ms.
// https://dev.mysql.com/doc/refman/26.7/en/performance-schema-events-statements-current-table.html
// https://dev.mysql.com/doc/refman/26.7/en/server-status-variables.html
const decimal=value=>{const text=String(value);if(!/^(0|[1-9][0-9]{0,64})$/u.test(text))throw Error("Invalid engine counter");return text;};
const empty=reason=>({coverage:"UNKNOWN",reason,salesStatements:{scope:"CURRENT_SCHEMA_SALES_TABLE_STATEMENT_DIGESTS",digestCount:null,statements:null,rowsExamined:null,tableLockWaitPs:null},instanceRowLocks:{scope:"MYSQL_INSTANCE",waitTimeMs:null,waits:null},windowDelta:null,resetCoverage:"UNKNOWN"});
export async function collectSalesEngineMetrics({database,signal}={}){
 signal?.throwIfAborted();
 const query=(sql,args=[])=>{signal?.throwIfAborted();return database.query(sql,args,{signal});};
 try{
  const [[meta]]=await query("SELECT @@performance_schema AS enabled,DATABASE() AS schema_name");if(Number(meta.enabled)!==1||typeof meta.schema_name!=="string"||!meta.schema_name) return empty("UNAVAILABLE");
  const [consumers]=await query("SELECT NAME AS name,ENABLED AS enabled FROM performance_schema.setup_consumers WHERE NAME IN ('global_instrumentation','thread_instrumentation','statements_digest')");
  if(consumers.length!==3||new Set(consumers.map(r=>r.name)).size!==3||consumers.some(row=>row.enabled!=="YES"))return empty("INCOMPLETE_INSTRUMENTATION");
  const [instruments]=await query("SELECT NAME AS name,ENABLED AS enabled,TIMED AS timed FROM performance_schema.setup_instruments WHERE NAME IN ('statement/sql/select','statement/sql/insert','statement/sql/update','statement/sql/delete')");
  if(instruments.length!==4||new Set(instruments.map(r=>r.name)).size!==4||instruments.some(row=>row.enabled!=="YES"||row.timed!=="YES"))return empty("INCOMPLETE_INSTRUMENTATION");
  const [status]=await query("SELECT VARIABLE_NAME AS name,VARIABLE_VALUE AS value FROM performance_schema.global_status WHERE VARIABLE_NAME IN ('Uptime','Innodb_row_lock_time','Innodb_row_lock_waits','Performance_schema_digest_lost')");const counters=new Map(status.map(row=>[row.name.toLowerCase(),decimal(row.value)]));
  if(counters.size!==4||!['uptime','innodb_row_lock_time','innodb_row_lock_waits','performance_schema_digest_lost'].every(name=>counters.has(name)))return empty("INCOMPLETE_COUNTERS");if(BigInt(counters.get('performance_schema_digest_lost'))>0n)return empty("DIGEST_OVERFLOW");
  const [[statements]]=await query(`SELECT COUNT(*) AS digest_count,COALESCE(SUM(COUNT_STAR),0) AS statements,COALESCE(SUM(SUM_ROWS_EXAMINED),0) AS rows_examined,COALESCE(SUM(SUM_LOCK_TIME),0) AS table_lock_ps FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME=? AND DIGEST IS NOT NULL AND REGEXP_LIKE(DIGEST_TEXT,?)`,[meta.schema_name,"(^|[[:space:]])(FROM|JOIN|UPDATE|INTO)[[:space:]]+(`?[[:alnum:]_]+`?\\.)?`?sales_[[:alnum:]_]+`?"]);
  signal?.throwIfAborted();return {coverage:"AVAILABLE_CUMULATIVE",salesStatements:{scope:"CURRENT_SCHEMA_SALES_TABLE_STATEMENT_DIGESTS",digestCount:decimal(statements.digest_count),statements:decimal(statements.statements),rowsExamined:decimal(statements.rows_examined),tableLockWaitPs:decimal(statements.table_lock_ps)},instanceRowLocks:{scope:"MYSQL_INSTANCE",waitTimeMs:counters.get('innodb_row_lock_time'),waits:counters.get('innodb_row_lock_waits')},windowDelta:null,resetCoverage:"UNKNOWN",interpretation:"Current cumulative engine counters; no durable-window, per-Order row-lock attribution, or request-P95 claim"};
 }catch{signal?.throwIfAborted();return empty("DEPENDENCY_UNAVAILABLE");}
}
