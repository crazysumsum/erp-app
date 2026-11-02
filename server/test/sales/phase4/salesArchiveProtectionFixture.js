import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
import {archiveFactsFixture} from "../../fulfillment/archiveFactsFixture.js";
import {SALES_ARCHIVE_COLUMNS,hashSalesArchiveRow} from "../../../src/modules/sales/salesArchiveHash.js";
// Physical SQL-protection projection, not a registered Archive movement or elapsed-age drill.
export async function salesArchiveProtectionFixture(t,{archivedAt=Date.UTC(2027,0,1),legacyMirrorsOnly=false}={}){
 const f=await archiveFactsFixture(t,{shipmentDate:"2023-11-14"});
 if(legacyMirrorsOnly)await (await import("../../../database/migrations/0089_create_sales_archive_tables.js")).up(f.db);
 else await promisify(execFile)(process.execPath,[fileURLToPath(new URL("../../../scripts/migrate.js",import.meta.url))],{env:{...process.env,DB_NAME:f.f.name,DB_USER:f.f.connectionOptions.user,DB_PASSWORD:f.f.connectionOptions.password},timeout:180000,maxBuffer:1024*1024});
 const [[line]]=await f.db.query("SELECT * FROM sales_order_lines WHERE sales_order_id=?",[f.s.orderId]);await f.s.insert("sales_backorder_entries",{sales_order_id:f.s.orderId,sales_order_line_id:line.id,line_no:1,warehouse_id:f.s.warehouseId,sku_id:line.sku_id,outstanding_base_quantity:0,status:"CANCELLED",priority_at:f.s.now,next_attempt_at:f.s.now,created_at:f.s.now,updated_at:f.s.now});
 const batch=await f.s.insert("sales_archive_batches",{batch_number:"IMMUTABLE-PROJECTION",period_key:`${new Date(archivedAt).getUTCFullYear()}${String(new Date(archivedAt).getUTCMonth()+1).padStart(2,"0")}`,cutoff_at:Date.UTC(2025,0,1),status:"COMPLETED",started_at:archivedAt,updated_at:archivedAt,completed_at:archivedAt});
 const rows={};for(const [table,columns]of Object.entries(SALES_ARCHIVE_COLUMNS)){
  const where=table==="sales_orders"?"id=?":table==="sales_audit_logs"?"target_type='ORDER' AND target_id=?":table==="sales_order_line_reservations"?"sales_order_line_id IN (SELECT id FROM sales_order_lines WHERE sales_order_id=?)":"sales_order_id=?";
  const projection=columns.map(name=>["order_date","requested_delivery_date"].includes(name)?`DATE_FORMAT(${name},'%Y-%m-%d') AS ${name}`:name).join(","),[source]=await f.db.query(`SELECT ${projection} FROM ${table} WHERE ${where} ORDER BY id`,[f.s.orderId]);
  if(!source.length)throw Error("Nonempty Sales protection source required");
  for(const row of source)await f.db.execute(`INSERT INTO ${table}_archive (${columns.join(",")},archive_batch_id,archived_at,row_hash) VALUES (${columns.map(()=>"?").join(",")},?,?,?)`,[...columns.map(name=>row[name]!==null&&typeof row[name]==="object"&&!Buffer.isBuffer(row[name])?JSON.stringify(row[name]):row[name]),batch,archivedAt,hashSalesArchiveRow(table,row)]);
  rows[table+"_archive"]=(await f.db.query(`SELECT * FROM ${table}_archive ORDER BY id`))[0];
 }
 return {...f,batch,archiveRows:rows};
}
