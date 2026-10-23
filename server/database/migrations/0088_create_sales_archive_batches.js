import { createSalesTable, inspectSalesTable } from "./0070_create_sales_quotations.js";
import { inspectSalesChecks } from "./0083_create_sales_import_jobs.js";
const BATCH={table:"sales_archive_batches",columns:{
 id:["bigint unsigned",false,null,null,"auto_increment"],batch_number:["varchar(30)",false,null,"ascii_bin"],period_key:["char(6)",false,null,"ascii_bin"],cutoff_at:["bigint unsigned"],status:["varchar(20)",false,null,"ascii_bin"],
 candidate_count:["bigint unsigned",false,"0"],archived_count:["bigint unsigned",false,"0"],skipped_count:["bigint unsigned",false,"0"],failed_count:["bigint unsigned",false,"0"],last_scanned_order_id:["bigint unsigned",false,"0"],checksum_summary:["json",true],
 lease_owner:["char(36)",true,null,"ascii_bin"],lease_until:["bigint unsigned",true],started_at:["bigint unsigned"],updated_at:["bigint unsigned"],completed_at:["bigint unsigned",true]},
 indexes:{PRIMARY:[0,"id"],uq_sales_archive_batch:[0,"batch_number"],uq_sales_archive_period:[0,"period_key"],idx_sales_archive_status:[1,"status,started_at,id"]},foreignKeys:{},
 checks:{chk_sales_archive_status:"(status IN ('RUNNING','COMPLETED','PARTIAL','FAILED'))",chk_sales_archive_counts:"(((archived_count + skipped_count) + failed_count) <= candidate_count)",
  chk_sales_archive_lease:"(((lease_owner IS NULL) AND (lease_until IS NULL)) OR ((lease_owner IS NOT NULL) AND (lease_until IS NOT NULL)))"}};
const MANIFEST={table:"sales_archive_order_manifests",columns:{id:["bigint unsigned",false,null,null,"auto_increment"],archive_batch_id:["bigint unsigned"],sales_order_id:["bigint unsigned"],sales_order_number:["varchar(20)",false,null,"ascii_bin"],
 sales_table_counts:["json"],sales_hash_summary:["json"],fulfillment_table_counts:["json"],fulfillment_hash_summary:["json"],participant_versions:["json"],archived_at:["bigint unsigned"]},
 indexes:{PRIMARY:[0,"id"],uq_sales_manifest_order:[0,"sales_order_id"],uq_sales_manifest_number:[0,"sales_order_number"],idx_sales_manifest_batch:[1,"archive_batch_id,sales_order_id,id"]},foreignKeys:{archive_batch_id:["sales_archive_batches","id","RESTRICT"]},checks:{}};
export async function inspectSalesArchiveBatchSchemas(connection) {
 const batch=await inspectSalesTable(connection,BATCH),manifest=await inspectSalesTable(connection,MANIFEST);
 if(batch)await inspectSalesChecks(connection,BATCH.table,Object.values(BATCH.checks));
 return batch&&manifest;
}
export async function up(connection) {
 await inspectSalesArchiveBatchSchemas(connection);
 await createSalesTable(connection,BATCH);await createSalesTable(connection,MANIFEST);
 await inspectSalesArchiveBatchSchemas(connection);
}
