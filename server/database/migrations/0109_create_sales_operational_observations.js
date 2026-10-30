import {createSalesTable,inspectSalesTable} from "./0070_create_sales_quotations.js";
import {inspectSalesChecks} from "./0083_create_sales_import_jobs.js";
import {createHash} from "node:crypto";
export const SALES_OBSERVATION_COVERAGE_KEY=createHash("sha256").update("sales.operational.coverage").digest("hex");
export const SALES_OPERATIONAL_SCHEMA=Object.freeze([
 {table:"sales_operational_job_runs",columns:{
  run_id:["char(36)",false,null,"ascii_bin"],job_name:["varchar(50)",false,null,"ascii_bin"],protocol_version:["varchar(10)",false,"1","ascii_bin"],
  baseline_hash:["char(64)",false,null,"ascii_bin"],coverage_epoch:["char(36)",true,null,"ascii_bin"],lease_owner:["varchar(190)"],started_at:["bigint unsigned"],finished_at:["bigint unsigned",true],outcome:["varchar(16)",false,null,"ascii_bin"]},
  indexes:{PRIMARY:[0,"run_id"],idx_sales_obs_job_start:[1,"job_name,started_at,run_id"],idx_sales_obs_epoch_outcome:[1,"coverage_epoch,outcome,finished_at,run_id"],idx_sales_obs_retention:[1,"finished_at,run_id"]},foreignKeys:{},checks:{
   chk_sales_obs_job:"(job_name = 'sales.backorderAllocate')",chk_sales_obs_protocol:"(protocol_version = '1')",
   chk_sales_obs_baseline:"regexp_like(baseline_hash,'^[a-f0-9]{64}$','c')",
   chk_sales_obs_run:"regexp_like(run_id,'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$','c')",
   chk_sales_obs_outcome:"(((outcome = 'RUNNING') and (finished_at is null)) or ((outcome in ('SUCCEEDED','FAILED','TIMED_OUT')) and (finished_at is not null) and (finished_at >= started_at)))"}},
 {table:"sales_operational_alert_state",columns:{
  signal_type:["varchar(32)",false,null,"ascii_bin"],scope_key:["char(64)",false,null,"ascii_bin"],identity_hash:["char(64)",true,null,"ascii_bin"],
  protocol_version:["varchar(10)",false,"1","ascii_bin"],coverage_epoch:["char(36)",true,null,"ascii_bin"],
  first_seen_at:["bigint unsigned",true],last_seen_at:["bigint unsigned"],last_sample_at:["bigint unsigned",true],sample_count:["int unsigned",false,"0"],state:["varchar(16)",false,null,"ascii_bin"],version:["bigint unsigned",false,"1"]},
  indexes:{PRIMARY:[0,"signal_type,scope_key"],idx_sales_obs_state_retention:[1,"signal_type,last_seen_at,scope_key"]},foreignKeys:{},checks:{
   chk_sales_obs_signal:"(signal_type in ('COVERAGE','FIFO_STOCK','ARCHIVE_PROVIDER'))",chk_sales_obs_state_protocol:"(protocol_version = '1')",
   chk_sales_obs_scope:"regexp_like(scope_key,'^[a-f0-9]{64}$','c')",chk_sales_obs_version:"(version >= 1)",
   chk_sales_obs_state:"(((signal_type = 'COVERAGE') and (state in ('INACTIVE','ACTIVE'))) or ((signal_type <> 'COVERAGE') and (state in ('POSITIVE','CLEAR','UNKNOWN'))))",
   chk_sales_obs_sample:"(((sample_count = 0) and (first_seen_at is null) and (last_sample_at is null)) or ((sample_count > 0) and (first_seen_at is not null) and (last_sample_at is not null) and (first_seen_at <= last_sample_at) and (last_sample_at <= last_seen_at)) or ((signal_type = 'COVERAGE') and (state = 'ACTIVE') and (sample_count = 0) and (first_seen_at is not null) and (last_sample_at is not null) and (first_seen_at = last_sample_at) and (last_sample_at <= last_seen_at)))"}}
]);
export async function inspectSalesOperationalObservationSchema(connection){
 let complete=true;for(const contract of SALES_OPERATIONAL_SCHEMA){const found=await inspectSalesTable(connection,contract);if(found)await inspectSalesChecks(connection,contract.table,Object.values(contract.checks));else complete=false;}return complete;
}
export async function up(connection){
 for(const contract of SALES_OPERATIONAL_SCHEMA)await createSalesTable(connection,contract);
 await connection.execute(`INSERT INTO sales_operational_alert_state(signal_type,scope_key,last_seen_at,state) SELECT 'COVERAGE',?,0,'INACTIVE' WHERE NOT EXISTS(SELECT 1 FROM sales_operational_alert_state WHERE signal_type='COVERAGE' AND scope_key=?)`,[SALES_OBSERVATION_COVERAGE_KEY,SALES_OBSERVATION_COVERAGE_KEY]);
 if(!await inspectSalesOperationalObservationSchema(connection))throw new Error("Incomplete Sales operational observation schema");
}
