import {createFulfillmentTable,appendOnlyTriggers} from "../../src/modules/fulfillment/fulfillmentMigrationSchema.js";
import {FULFILLMENT_DOCUMENT_TABLES} from "./0093_create_fulfillment_documents.js";
import {FULFILLMENT_ALLOCATION_TABLE} from "./0095_create_fulfillment_allocations.js";
import {SHIPMENT_TABLES} from "./0096_create_shipments.js";
import {SHIPMENT_FACT_TABLES} from "./0097_create_shipment_issues_and_reversals.js";
import {FULFILLMENT_AUDIT_EXPORT_TABLES} from "./0098_create_fulfillment_audit_and_exports.js";
const sources=[...FULFILLMENT_DOCUMENT_TABLES,FULFILLMENT_ALLOCATION_TABLE,...SHIPMENT_TABLES,...SHIPMENT_FACT_TABLES,FULFILLMENT_AUDIT_EXPORT_TABLES[0]];
// Historical generated values are retained as ordinary values; active FK targets may be archived or removed later.
export const FULFILLMENT_ARCHIVE_TABLES=Object.freeze(sources.map(c=>{
 const table=c.table+"_archive",columns=Object.fromEntries(Object.entries(c.columns).map(([name,[type,nullable=false,def=null,collation]])=>[name,[type,nullable,def,collation]]));
 return {table,columns:{...columns,archive_batch_id:["bigint unsigned"],archived_at:["bigint unsigned"],row_hash:["char(64)",false,null,"ascii_bin"]},indexes:{...c.indexes,["idx_"+table+"_batch"]:[1,"archive_batch_id,id"],...(c.table==="fulfillments"?{idx_ful_archive_warehouse_date:[1,"warehouse_id,created_at,id"]}:{}),...(c.table==="shipments"?{idx_shipment_archive_warehouse_date:[1,"warehouse_id,shipped_at,id"]}:{})},foreignKeys:{["fk_"+table+"_batch"]:["archive_batch_id","sales_archive_batches","id","RESTRICT"]},checks:{["chk_"+table+"_hash"]:"regexp_like(row_hash,'^[0-9a-f]{64}$','c')"},triggers:appendOnlyTriggers(table)};
}));
export async function up(tx){for(const c of FULFILLMENT_ARCHIVE_TABLES)await createFulfillmentTable(tx,c);}
