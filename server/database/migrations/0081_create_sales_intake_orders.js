import { createSalesTable, inspectSalesTable } from "./0070_create_sales_quotations.js";
import { inspectSalesChecks } from "./0080_create_sales_import_jobs.js";

const CONTRACT={
  table:"sales_intake_orders",
  columns:{id:["bigint unsigned",false,null,null,"auto_increment"],import_job_id:["bigint unsigned",true],source_type:["varchar(20)",false,null,"ascii_bin"],source_order_key:["varchar(190)"],source_order_key_hash:["binary(32)"],
    channel_code:["varchar(50)",false,null,"ascii_bin"],external_order_id:["varchar(190)"],external_order_id_hash:["binary(32)"],schema_version:["varchar(10)",false,null,"ascii_bin"],transport_request_id:["varchar(190)",false,""],transport_idempotency_key_hash:["binary(32)",true],payload_hash:["char(64)",false,null,"ascii_bin"],safe_payload:["json",true],
    first_row_no:["int unsigned"],last_row_no:["int unsigned"],line_count:["int unsigned"],status:["varchar(30)",false,null,"ascii_bin"],processing_event_id:["char(36)",false,null,"ascii_bin"],external_order_key_id:["bigint unsigned",true],sales_order_id:["bigint unsigned",true],sales_order_number:["varchar(20)",false,"","ascii_bin"],result_code:["varchar(80)",false,"","ascii_bin"],
    attempt_count:["int unsigned",false,"0"],next_attempt_at:["bigint unsigned",true],last_attempt_at:["bigint unsigned",true],created_at:["bigint unsigned"],updated_at:["bigint unsigned"],completed_at:["bigint unsigned",true],payload_purged_at:["bigint unsigned",true]},
  indexes:{PRIMARY:[0,"id"],uq_sales_intake_event:[0,"processing_event_id"],uq_sales_intake_job_source:[0,"import_job_id,source_order_key_hash"],uq_sales_intake_transport:[0,"channel_code,transport_idempotency_key_hash"],
    idx_sales_intake_job_status:[1,"import_job_id,status,id"],idx_sales_intake_retry:[1,"status,next_attempt_at,id"],idx_sales_intake_external:[1,"channel_code,external_order_id_hash,id"],idx_sales_intake_order:[1,"sales_order_id,id"]},
  foreignKeys:{import_job_id:["sales_import_jobs","id","CASCADE"]},
  checks:{chk_sales_intake_source:"(((source_type='CSV') AND (import_job_id IS NOT NULL) AND (transport_idempotency_key_hash IS NULL)) OR ((source_type='CHANNEL') AND (import_job_id IS NULL) AND (transport_idempotency_key_hash IS NOT NULL)))",
    chk_sales_intake_status:"(status IN ('RECEIVED','VALIDATING','VALID','INVALID','DUPLICATE','QUEUED','PROCESSING','SUCCEEDED','FAILED'))",
    chk_sales_intake_lines:"((line_count BETWEEN 1 AND 100) AND (first_row_no >= 1) AND (last_row_no >= first_row_no))",
    chk_sales_intake_payload:"((safe_payload IS NULL) OR (LENGTH(CAST(safe_payload AS CHAR CHARSET utf8mb4)) <= 131072))"}
};
export async function inspectSalesIntakeSchema(connection) {
  if(!await inspectSalesTable(connection,CONTRACT))return false;
  await inspectSalesChecks(connection,CONTRACT.table,Object.values(CONTRACT.checks));return true;
}
export async function up(connection) {
  await inspectSalesIntakeSchema(connection);
  await createSalesTable(connection,CONTRACT);
  await inspectSalesIntakeSchema(connection);
}
