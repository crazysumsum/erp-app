import { createSalesTable, inspectSalesTable } from "./0070_create_sales_quotations.js";
import { inspectSalesChecks } from "./0083_create_sales_import_jobs.js";

const CONTRACT={
 table:"sales_export_jobs",
 columns:{id:["bigint unsigned",false,null,null,"auto_increment"],scope:["varchar(20)",false,null,"ascii_bin"],filters:["json"],filters_hash:["char(64)",false,null,"ascii_bin"],
  status:["varchar(20)",false,null,"ascii_bin"],row_count:["bigint unsigned",false,"0"],file_path:["varchar(500)",false,""],error_code:["varchar(80)",false,"","ascii_bin"],
  lease_owner:["char(36)",true,null,"ascii_bin"],lease_until:["bigint unsigned",true],created_by:["bigint unsigned",true],created_at:["bigint unsigned"],
  started_at:["bigint unsigned",true],completed_at:["bigint unsigned",true],expires_at:["bigint unsigned",true]},
 indexes:{PRIMARY:[0,"id"],idx_sales_export_status:[1,"status,created_at,id"],idx_sales_export_actor:[1,"created_by,created_at,id"],idx_sales_export_expiry:[1,"expires_at,status,id"],idx_sales_export_lease:[1,"status,lease_until,id"]},
 foreignKeys:{created_by:["users","id","SET NULL"]},
 checks:{chk_sales_export_scope:"(scope IN ('ACTIVE','ARCHIVE','IMPORT_RESULT'))",chk_sales_export_status:"(status IN ('QUEUED','PROCESSING','COMPLETED','FAILED','EXPIRED'))",
  chk_sales_export_filters:"((JSON_TYPE(filters) = 'OBJECT') AND (LENGTH(CAST(filters AS CHAR CHARSET utf8mb4)) <= 16384))",
  chk_sales_export_lease:"(((lease_owner IS NULL) AND (lease_until IS NULL)) OR ((lease_owner IS NOT NULL) AND (lease_until IS NOT NULL)))"}
};
export async function inspectSalesExportJobSchema(connection) {
 if(!await inspectSalesTable(connection,CONTRACT))return false;
 await inspectSalesChecks(connection,CONTRACT.table,Object.values(CONTRACT.checks));return true;
}
export async function up(connection) {
 await inspectSalesExportJobSchema(connection);await createSalesTable(connection,CONTRACT);await inspectSalesExportJobSchema(connection);
}
