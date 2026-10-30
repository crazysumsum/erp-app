import {inspectSalesBackorderSchema} from "./0079_create_sales_backorder_entries.js";

const indexName="idx_sales_backorder_order";
export async function inspectSalesBackorderOrderIndex(connection){
 const [rows]=await connection.query(`SELECT non_unique AS non_unique,column_name AS column_name,seq_in_index AS seq_in_index,sub_part AS sub_part,index_type AS index_type,is_visible AS is_visible,collation AS collation,expression AS expression
  FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='sales_backorder_entries' AND index_name=? ORDER BY seq_in_index`,[indexName]);
 if(!rows.length)return false;
 if(rows.length!==2||rows.some((row,i)=>Number(row.non_unique)!==1||row.column_name!==["sales_order_id","id"][i]||Number(row.seq_in_index)!==i+1||row.sub_part!==null||row.expression!==null||row.index_type!=="BTREE"||row.is_visible!=="YES"||row.collation!=="A"))throw new Error("Incompatible Sales Backorder order index");
 return true;
}
export async function up(connection){
 if(!await inspectSalesBackorderSchema(connection))throw new Error("Sales Backorder schema is required before its order index");
 if(await inspectSalesBackorderOrderIndex(connection))return;
 const settings="SELECT CONNECTION_ID() AS connection_id,@@SESSION.innodb_ddl_threads AS ddl_threads,@@SESSION.innodb_parallel_read_threads AS read_threads,@@SESSION.lock_wait_timeout AS wait_seconds";
 const [[before]]=await connection.query(settings);
 try{
  await connection.query("SET SESSION innodb_ddl_threads=1,innodb_parallel_read_threads=1,lock_wait_timeout=10");
  const [[active]]=await connection.query(settings);
  if(String(active.connection_id)!==String(before.connection_id)||Number(active.ddl_threads)!==1||Number(active.read_threads)!==1||Number(active.wait_seconds)!==10)throw new Error("Sales Backorder index DDL session limits were not established");
  await connection.query({sql:"ALTER TABLE sales_backorder_entries ADD INDEX idx_sales_backorder_order (sales_order_id,id), ALGORITHM=INPLACE, LOCK=NONE",timeout:600000});
  if(!await inspectSalesBackorderOrderIndex(connection))throw new Error("Sales Backorder order index was not created");
  await connection.query("SET SESSION innodb_ddl_threads=?,innodb_parallel_read_threads=?,lock_wait_timeout=?",[before.ddl_threads,before.read_threads,before.wait_seconds]);
 }catch(error){
  // A failed DDL may have committed; discard this session and inspect metadata before retrying.
  connection.destroy();throw error;
 }
}
