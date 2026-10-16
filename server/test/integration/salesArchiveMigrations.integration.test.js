import assert from "node:assert/strict";
import test from "node:test";
import { migrationFixture } from "../sales/phase1/fixtures.js";
import { up as batchesUp, inspectSalesArchiveBatchSchemas } from "../../database/migrations/0088_create_sales_archive_batches.js";
import { up as archiveUp, inspectSalesArchiveSchemas } from "../../database/migrations/0089_create_sales_archive_tables.js";
import { SalesBusinessMasterImpactChecker } from "../../src/modules/sales/SalesBusinessMasterImpactChecker.js";
const integrationTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
const active=["sales_orders","sales_order_lines","sales_order_line_reservations","sales_backorder_entries","sales_order_status_history","sales_audit_logs"];
const archived=active.map(name=>name+"_archive");
async function setup(t,mirrors=true) {
 const f=await migrationFixture(t,["sales_archive_batches","sales_archive_order_manifests",...(mirrors?archived:[])]);
 const original=f.scoped;f.scoped={query(sql,args){for(const [name,short] of [["sales_order_line_reservations_archive","sales_arma"],["sales_order_status_history_archive","sales_arhi"],["sales_archive_order_manifests","sales_armf"],["sales_backorder_entries_archive","sales_arbo"],["sales_order_lines_archive","sales_arln"]])sql=sql.replaceAll("fk_"+name+"_","fk_"+short+"_");return original.query(sql,args);}};
 await batchesUp(f.scoped);if(mirrors)await archiveUp(f.scoped);
 const [batch]=await f.db.query(`INSERT INTO ${f.names.sales_archive_batches} SET ?`,{batch_number:"SA-202610-SYNTHETIC",period_key:"202610",cutoff_at:f.now-730*86400000,status:"RUNNING",started_at:f.now,updated_at:f.now});
 f.batchId=Number(batch.insertId);f.meta={archive_batch_id:f.batchId,archived_at:f.now,row_hash:"a".repeat(64)};
 f.order={id:7001,sales_order_number:"SO-SYNTHETIC-7001",status:"COMPLETED",source_type:"MANUAL",customer_id:f.customerId,customer_code_snapshot:"Historical",customer_name_snapshot:"Historical",currency_code:f.currency,fulfillment_warehouse_id:f.warehouseId,warehouse_code_snapshot:"HIST",warehouse_name_snapshot:"Historical",order_date:"2024-01-01",line_count:1,total_amount:"1.0000",created_at:f.now,updated_at:f.now,last_business_updated_at:f.now,...f.meta};
 f.line={id:8001,sales_order_id:7001,line_no:1,sku_id:f.skuId,item_name_snapshot:"Historical",sku_code_snapshot:"HIST",sku_name_snapshot:"Historical",sku_uom_id:f.skuUomId,uom_code_snapshot:"EA",uom_name_snapshot:"Each",to_base_factor_snapshot:1,tracking_policy_snapshot:"none",ordered_quantity:"1.000000",ordered_base_quantity:1,unit_selling_price:"1.0000",price_source:"MANUAL",line_amount:"1.0000",fulfilled_base_quantity:1,created_at:f.now,updated_at:f.now,...f.meta};
 return f;
}
integrationTest("TC-048 Archive batch and manifest persistence reruns, preserves rows and owns permanent unique routes",async t=>{
 const f=await setup(t,false),table=f.names.sales_archive_order_manifests;
 const manifest={archive_batch_id:f.batchId,sales_order_id:7001,sales_order_number:"SO-SYNTHETIC-7001",sales_table_counts:"{}",sales_hash_summary:"{}",fulfillment_table_counts:"{}",fulfillment_hash_summary:"{}",participant_versions:"{}",archived_at:f.now};
 await f.db.query(`INSERT INTO ${table} SET ?`,manifest);await batchesUp(f.scoped);assert.equal(await inspectSalesArchiveBatchSchemas(f.scoped),true);
 for(const patch of [{sales_order_id:7002},{sales_order_number:"SO-SYNTHETIC-7002"}])await assert.rejects(()=>f.db.query(`INSERT INTO ${table} SET ?`,{...manifest,...patch}),{code:"ER_DUP_ENTRY"});
 await assert.rejects(()=>f.db.query(`INSERT INTO ${f.names.sales_archive_batches} SET ?`,{batch_number:"SA-OTHER",period_key:"202610",cutoff_at:1,status:"RUNNING",started_at:f.now,updated_at:f.now}),{code:"ER_DUP_ENTRY"});
 await assert.rejects(()=>f.db.execute(`DELETE FROM ${f.names.sales_archive_batches} WHERE id=?`,[f.batchId]),{code:"ER_ROW_IS_REFERENCED_2"});
 assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n,1);
});
integrationTest("TC-048 Archive batch rejects invalid states, unpaired leases and impossible counters",async t=>{
 const f=await setup(t,false);
 for(const patch of [{status:"UNKNOWN"},{lease_owner:"a".repeat(36)},{lease_until:f.now},{candidate_count:1,archived_count:2}])await assert.rejects(()=>f.db.query(`UPDATE ${f.names.sales_archive_batches} SET ? WHERE id=?`,[patch,f.batchId]),{code:"ER_CHECK_CONSTRAINT_VIOLATED"});
});
integrationTest("TC-048 all six Archive mirrors preserve every active column type, default and snapshot without AUTO_INCREMENT",async t=>{
 const f=await setup(t);
 for(let i=0;i<active.length;i++)await t.test(active[i],async()=>{
  const columns=async name=>(await f.db.query("SELECT COLUMN_NAME AS name,COLUMN_TYPE AS type,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS default_value,COLLATION_NAME AS collation,EXTRA AS extra FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ORDINAL_POSITION",[name]))[0];
  const original=await columns(active[i]),copy=await columns(f.names[archived[i]]);
  assert.deepEqual(copy.slice(0,original.length),original.map(row=>({...row,extra:row.name==="id"?"":row.extra})));
  assert.deepEqual(copy.slice(original.length).map(row=>row.name),["archive_batch_id","archived_at","row_hash"]);
 });
 assert.equal(await inspectSalesArchiveSchemas(f.scoped),true);await archiveUp(f.scoped);
 const [keys]=await f.db.query("SELECT referenced_table_name AS target FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name IN (?) AND referenced_table_name IS NOT NULL",[archived.map(name=>f.names[name])]);
 assert.ok(keys.length>=10);assert.ok(keys.every(row=>Object.values(f.names).includes(row.target)));
});
integrationTest("TC-048 Archive preserves original IDs and historical master identities, and enforces archive aggregate FKs",async t=>{
 const f=await setup(t),orders=f.names.sales_orders_archive,lines=f.names.sales_order_lines_archive;
 await f.db.query(`INSERT INTO ${orders} SET ?`,{...f.order,customer_id:999999999,currency_code:"ZZZ",payment_term_id:999999999,fulfillment_warehouse_id:999999999});
 await f.db.query(`INSERT INTO ${lines} SET ?`,{...f.line,sku_id:999999999,sku_uom_id:999999999});
 await archiveUp(f.scoped);assert.equal((await f.db.query(`SELECT id FROM ${orders}`))[0][0].id,7001);
 await assert.rejects(()=>f.db.query(`INSERT INTO ${lines} SET ?`,{...f.line,id:8002,sales_order_id:7999}),{code:"ER_NO_REFERENCED_ROW_2"});
 await assert.rejects(()=>f.db.query(`INSERT INTO ${orders} SET ?`,{...f.order,id:7002,sales_order_number:"SO-SYNTHETIC-7002",archive_batch_id:f.batchId+999}),{code:"ER_NO_REFERENCED_ROW_2"});
});
integrationTest("TC-048 Archive Backorder accepts only terminal zero-outstanding rows with composite line ownership",async t=>{
 const f=await setup(t);await f.db.query(`INSERT INTO ${f.names.sales_orders_archive} SET ?`,f.order);await f.db.query(`INSERT INTO ${f.names.sales_orders_archive} SET ?`,{...f.order,id:7002,sales_order_number:"SO-SYNTHETIC-7002"});await f.db.query(`INSERT INTO ${f.names.sales_order_lines_archive} SET ?`,f.line);
 const row={id:9001,sales_order_id:7001,sales_order_line_id:8001,line_no:1,warehouse_id:f.warehouseId,sku_id:f.skuId,outstanding_base_quantity:0,status:"FULFILLED",priority_at:f.now,next_attempt_at:f.now,created_at:f.now,updated_at:f.now,...f.meta},table=f.names.sales_backorder_entries_archive;
 await assert.rejects(()=>f.db.query(`INSERT INTO ${table} SET ?`,{...row,sales_order_id:7002}),{code:"ER_NO_REFERENCED_ROW_2"});
 for(const patch of [{status:"OPEN",outstanding_base_quantity:1},{outstanding_base_quantity:1}])await assert.rejects(()=>f.db.query(`INSERT INTO ${table} SET ?`,{...row,...patch}),{code:"ER_CHECK_CONSTRAINT_VIOLATED"});
 await f.db.query(`INSERT INTO ${table} SET ?`,row);
});
integrationTest("TC-047 native BusinessMaster checker counts Archive history without mutable-master FKs",async t=>{
 const f=await setup(t);await f.db.query(`INSERT INTO ${f.names.sales_orders_archive} SET ?`,f.order);
 const checker=new SalesBusinessMasterImpactChecker({database:{query:async(sql,args)=>{
  if(sql.includes("information_schema.tables"))return [[{present:3,archived:1}]];
  return f.scoped.query(sql,args);
 }}});
 const result=await checker.check({entityType:"CURRENCY",entityKey:f.currency});assert.equal(result.status,"READY");assert.equal(result.historicalCount,1);
});
integrationTest("TC-048 Archive migration rejects column drift while preserving historical rows",async t=>{
 const f=await setup(t);await f.db.query(`INSERT INTO ${f.names.sales_orders_archive} SET ?`,f.order);
 await f.db.query(`ALTER TABLE ${f.names.sales_orders_archive} MODIFY customer_name_snapshot VARCHAR(191) NOT NULL`);
 await assert.rejects(()=>archiveUp(f.scoped),/column customer_name_snapshot/u);
 assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${f.names.sales_orders_archive}`))[0][0].n,1);
});
