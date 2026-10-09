import { createSalesTable, inspectSalesTable } from "./0070_create_sales_quotations.js";

// Preserve grouping for the new checks; the immutable historical inspector flattens parentheses.
export async function inspectSalesChecks(connection,table,expected) {
  const normalize=value=>value.replace(/\\'/gu,"'").split(/('(?:[^']|'')*')/u).map((part,index,parts)=>{
    if(index%2)return part;
    if(index<parts.length-1)part=part.replace(/_[a-z0-9]+$/u,"");
    return part.replace(/[`\s]/gu,"").toLowerCase();
  }).join("");
  const [checks]=await connection.query(`SELECT cc.check_clause AS clause FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc ON cc.constraint_schema=tc.constraint_schema AND cc.constraint_name=tc.constraint_name
    WHERE tc.constraint_schema=DATABASE() AND tc.table_name=? AND tc.constraint_type='CHECK'`,[table]);
  const required=new Set(expected.map(normalize));
  if(checks.length!==required.size||checks.some(row=>!required.delete(normalize(row.clause))))throw new Error(`Incompatible existing Sales schema: ${table} grouped check clause`);
}

const CONTRACT={
  table:"sales_import_jobs",
  columns:{id:["bigint unsigned",false,null,null,"auto_increment"],batch_number:["varchar(30)",false,null,"ascii_bin"],template_version:["varchar(10)",false,null,"ascii_bin"],
    original_file_name:["varchar(255)"],source_file_path:["varchar(500)",false,""],result_file_path:["varchar(500)",false,""],file_sha256:["binary(32)"],file_size_bytes:["bigint unsigned"],status:["varchar(30)",false,null,"ascii_bin"],
    total_row_count:["int unsigned",false,"0"],source_order_count:["int unsigned",false,"0"],valid_count:["int unsigned",false,"0"],invalid_count:["int unsigned",false,"0"],duplicate_count:["int unsigned",false,"0"],
    success_count:["int unsigned",false,"0"],failed_count:["int unsigned",false,"0"],warning_count:["int unsigned",false,"0"],version:["int unsigned",false,"1"],lease_owner:["char(36)",true,null,"ascii_bin"],lease_until:["bigint unsigned",true],
    created_by:["bigint unsigned",true],confirmed_by:["bigint unsigned",true],created_at:["bigint unsigned"],updated_at:["bigint unsigned"],confirmed_at:["bigint unsigned",true],processing_started_at:["bigint unsigned",true],completed_at:["bigint unsigned",true],files_purged_at:["bigint unsigned",true]},
  indexes:{PRIMARY:[0,"id"],uq_sales_import_batch:[0,"batch_number"],idx_sales_import_status:[1,"status,created_at,id"],idx_sales_import_actor:[1,"created_by,created_at,id"],idx_sales_import_hash:[1,"file_sha256,created_at,id"],idx_sales_import_lease:[1,"status,lease_until,id"]},
  foreignKeys:{created_by:["users","id","SET NULL"],confirmed_by:["users","id","SET NULL"]},
  checks:{chk_sales_import_status:"(status IN ('UPLOADED','VALIDATING','READY','QUEUED','PROCESSING','COMPLETED','PARTIAL_SUCCESS','FAILED','CANCELLED'))",
    chk_sales_import_limits:"((file_size_bytes BETWEEN 1 AND 52428800) AND (total_row_count <= 100000) AND (source_order_count <= 10000) AND (version >= 1))",
    chk_sales_import_counts:"((((valid_count + invalid_count) + duplicate_count) <= source_order_count) AND ((success_count + failed_count) <= source_order_count))",
    chk_sales_import_lease:"(((lease_owner IS NULL) AND (lease_until IS NULL)) OR ((lease_owner IS NOT NULL) AND (lease_until IS NOT NULL)))"}
};
export async function inspectSalesImportJobSchema(connection) {
  if(!await inspectSalesTable(connection,CONTRACT))return false;
  await inspectSalesChecks(connection,CONTRACT.table,Object.values(CONTRACT.checks));return true;
}
export async function up(connection) {
  await inspectSalesImportJobSchema(connection);
  await createSalesTable(connection,CONTRACT);
  await inspectSalesImportJobSchema(connection);
}
